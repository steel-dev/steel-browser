import { IncomingMessage } from "http";
import puppeteer, { Browser, CDPSession, Page } from "puppeteer-core";
import { Duplex } from "stream";
import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";

import { SessionService } from "../../services/session.service.js";
import { env } from "../../env.js";
import {
  PageInfo,
  MouseEvent,
  NavigationEvent,
  KeyEvent,
  CloseTabEvent,
  GetSelectedTextEvent,
} from "../../types/casting.js";
import { getPageFavicon, getPageTitle, navigatePage } from "../../utils/casting.js";
import webRTCServer from "../webrtc/webrtc-server.js";
import streamCapture from "../webrtc/stream-capture.js";

// Enhanced logging utility
class WebRTCCastingLogger {
  private prefix: string;

  constructor(prefix: string = "WebRTCCasting") {
    this.prefix = prefix;
  }

  private timestamp(): string {
    return new Date().toISOString();
  }

  info(message: string, data?: any): void {
    const logMessage = `[${this.timestamp()}] [${this.prefix}] INFO: ${message}`;
    if (data) {
      console.log(logMessage, JSON.stringify(data, null, 2));
    } else {
      console.log(logMessage);
    }
  }

  warn(message: string, data?: any): void {
    const logMessage = `[${this.timestamp()}] [${this.prefix}] WARN: ${message}`;
    if (data) {
      console.warn(logMessage, JSON.stringify(data, null, 2));
    } else {
      console.warn(logMessage);
    }
  }

  error(message: string, error?: any): void {
    const logMessage = `[${this.timestamp()}] [${this.prefix}] ERROR: ${message}`;
    if (error) {
      console.error(logMessage, error);
      if (error.stack) {
        console.error("Stack trace:", error.stack);
      }
    } else {
      console.error(logMessage);
    }
  }

  debug(message: string, data?: any): void {
    const logMessage = `[${this.timestamp()}] [${this.prefix}] DEBUG: ${message}`;
    if (data) {
      console.debug(logMessage, JSON.stringify(data, null, 2));
    } else {
      console.debug(logMessage);
    }
  }
}

// Session connection tracking
interface ConnectionInfo {
  clientId: string;
  connectedAt: Date;
  lastActivity: Date;
  messagesReceived: number;
  messagesSent: number;
  errors: number;
  browser?: Browser;
  targetPage?: Page;
  targetClient?: CDPSession;
}

export async function handleWebRTCSession(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  wss: WebSocket.Server,
  sessionService: SessionService,
  params: Record<string, string> | undefined,
): Promise<void> {
  const logger = new WebRTCCastingLogger("WebRTCSession");

  logger.info("New WebRTC session request received", {
    url: request.url,
    headers: {
      host: request.headers.host,
      origin: request.headers.origin,
      userAgent: request.headers["user-agent"],
      upgrade: request.headers.upgrade,
      connection: request.headers.connection,
    },
  });

  // Extract session ID from URL
  const id = request.url?.split("/sessions/")[1].split("/cast")[0];

  if (!id) {
    logger.error("WebRTC Session ID not found in URL", { url: request.url });
    socket.destroy();
    return;
  }

  logger.debug(`Extracted session ID: ${id}`);

  // Get active session
  const session = await sessionService.activeSession;
  if (!session) {
    logger.error(`WebRTC Session ${id} not found in session service`);
    socket.destroy();
    return;
  }

  logger.info(`WebRTC session ${id} found`, {
    sessionInfo: {
      id: session.id,
      // Add any other relevant session properties
    },
  });

  // Parse query parameters
  const queryParams = new URLSearchParams(request.url?.split("?")[1] || "");
  const requestedPageId = params?.pageId || queryParams.get("pageId") || null;
  const requestedPageIndex = params?.pageIndex || queryParams.get("pageIndex") || null;

  logger.debug("Request parameters", {
    requestedPageId,
    requestedPageIndex,
    allParams: Object.fromEntries(queryParams.entries()),
  });

  // Initialize WebRTC components
  logger.info("Initializing WebRTC components...");

  try {
    const initSuccess = await streamCapture.init();
    if (!initSuccess) {
      throw new Error("Stream capture initialization failed");
    }
    logger.info("Stream capture initialized successfully");
  } catch (err) {
    logger.error("Error initializing stream capture", err);
    socket.destroy();
    return;
  }

  // Handle WebSocket upgrade
  wss.handleUpgrade(request, socket, head, async (ws) => {
    const clientId = uuidv4();

    logger.info(`WebSocket connection established for client ${clientId}`, {
      //@ts-ignore
      remoteAddress: socket.remoteAddress,
      //@ts-ignore
      remotePort: socket.remotePort,
    });

    // Initialize connection tracking
    const connectionInfo: ConnectionInfo = {
      clientId,
      connectedAt: new Date(),
      lastActivity: new Date(),
      messagesReceived: 0,
      messagesSent: 0,
      errors: 0,
    };

    let heartbeatInterval: NodeJS.Timeout | null = null;
    let statsInterval: NodeJS.Timeout | null = null;

    // Enhanced cleanup handler
    const handleSessionCleanup = async (reason: string = "unknown") => {
      logger.info(`Starting cleanup for client ${clientId}`, { reason });

      const sessionDuration = Date.now() - connectionInfo.connectedAt.getTime();

      logger.info(`Session summary for client ${clientId}`, {
        duration: Math.round(sessionDuration / 1000) + "s",
        messagesReceived: connectionInfo.messagesReceived,
        messagesSent: connectionInfo.messagesSent,
        errors: connectionInfo.errors,
        reason,
      });

      // Clear intervals
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }

      if (statsInterval) {
        clearInterval(statsInterval);
        statsInterval = null;
      }

      // Clean up WebRTC resources
      try {
        logger.debug(`Closing WebRTC resources for client ${clientId}`);
        await webRTCServer.closePeerConnection(clientId);
        streamCapture.removeClient(clientId);
        logger.debug(`WebRTC resources cleaned up for client ${clientId}`);
      } catch (err) {
        logger.error(`Error cleaning up WebRTC resources for client ${clientId}`, err);
        connectionInfo.errors++;
      }

      // Clean up browser resources
      try {
        if (connectionInfo.targetClient) {
          logger.debug(`Detaching CDP session for client ${clientId}`);
          connectionInfo.targetClient.detach().catch((err) => {
            logger.warn("Error detaching CDP session", err);
          });
          connectionInfo.targetClient = undefined;
        }

        if (connectionInfo.browser) {
          logger.debug(`Disconnecting browser for client ${clientId}`);
          connectionInfo.browser.disconnect().catch((err) => {
            logger.warn("Error disconnecting browser", err);
          });
          connectionInfo.browser = undefined;
        }
      } catch (err) {
        logger.error(`Error during browser cleanup for client ${clientId}`, err);
        connectionInfo.errors++;
      }

      logger.info(`Cleanup completed for client ${clientId}`);
    };

    try {
      // Connect to the browser
      logger.info(`Connecting to browser for client ${clientId}`, {
        endpoint: `ws://${env.HOST}:${env.PORT}`,
      });

      connectionInfo.browser = await puppeteer.connect({
        browserWSEndpoint: `ws://${env.HOST}:${env.PORT}`,
      });

      logger.info(`Browser connected successfully for client ${clientId}`);

      // Get browser pages
      const pages = await connectionInfo.browser.pages();
      logger.debug(`Found ${pages.length} browser pages for client ${clientId}`);

      // Find target page if requested (currently commented out but enhanced for debugging)
      if (requestedPageId || requestedPageIndex) {
        logger.debug(`Looking for specific page for client ${clientId}`, {
          requestedPageId,
          requestedPageIndex,
          availablePages: pages.length,
        });

        // Note: The page targeting logic is currently commented out in the original code
        // When re-enabling, this would be the place to add comprehensive logging
        // for page selection and targeting
      }

      // Set up WebRTC connection
      logger.info(`Creating WebRTC peer connection for client ${clientId}`);
      const pc = await webRTCServer.createPeerConnection(clientId, ws);

      // Add client to stream capture
      logger.info(`Adding client ${clientId} to stream capture`);
      await streamCapture.addClient(clientId);

      // Create and send offer to client
      logger.info(`Creating and sending offer to client ${clientId}`);
      await webRTCServer.createOffer(clientId);

      logger.info(`WebRTC setup completed successfully for client ${clientId}`);

      // Set up periodic stats reporting
      statsInterval = setInterval(() => {
        const webrtcStats = webRTCServer.getConnectionStats(clientId);
        const webrtcState = webRTCServer.getConnectionState(clientId);
        const streamStats = streamCapture.getStats();

        logger.debug(`Periodic stats for client ${clientId}`, {
          connection: connectionInfo,
          webrtc: {
            stats: webrtcStats,
            state: webrtcState,
          },
          stream: {
            healthy: streamCapture.isHealthy(),
            clients: streamStats.clients,
            packetsReceived: streamStats.rtpStats.packetsReceived,
          },
        });
      }, 30000); // Every 30 seconds

      // Handle WebSocket messages
      ws.on("message", async (message) => {
        connectionInfo.messagesReceived++;
        connectionInfo.lastActivity = new Date();

        try {
          const data = JSON.parse(message.toString());

          logger.debug(`Message received from client ${clientId}`, {
            type: data.type,
            //@ts-ignore
            messageSize: message.length,
            totalMessages: connectionInfo.messagesReceived,
          });

          switch (data.type) {
            case "answer":
              logger.info(`Processing SDP answer from client ${clientId}`);
              await webRTCServer.processAnswer(clientId, data.sdp);
              logger.debug(`SDP answer processed successfully for client ${clientId}`);
              break;

            case "ice":
              logger.debug(`Processing ICE candidate from client ${clientId}`, {
                hasCandidate: !!data.candidate,
              });

              if (data.candidate) {
                await webRTCServer.addIceCandidate(clientId, data.candidate);
                logger.debug(`ICE candidate processed for client ${clientId}`);
              } else {
                logger.debug(`Received ICE candidate end-of-candidates for client ${clientId}`);
              }
              break;

            case "mouseEvent":
              logger.debug(`Mouse event from client ${clientId}`, {
                eventType: data.event?.type,
                coordinates: data.event ? `${data.event.x},${data.event.y}` : "unknown",
              });

              if (connectionInfo.targetClient && connectionInfo.targetPage) {
                const { event } = data as MouseEvent;
                await connectionInfo.targetClient.send("Input.dispatchMouseEvent", {
                  type: event.type,
                  x: event.x,
                  y: event.y,
                  button: event.button,
                  buttons: event.button === "none" ? 0 : 1,
                  clickCount: event.clickCount || 1,
                  modifiers: event.modifiers || 0,
                  deltaX: event.deltaX,
                  deltaY: event.deltaY,
                });
                logger.debug(`Mouse event dispatched for client ${clientId}`);
              } else {
                logger.warn(`Mouse event ignored - no target page for client ${clientId}`);
              }
              break;

            case "keyEvent":
              logger.debug(`Key event from client ${clientId}`, {
                eventType: data.event?.type,
                key: data.event?.key,
                code: data.event?.code,
              });

              if (connectionInfo.targetClient && connectionInfo.targetPage) {
                const { event } = data as KeyEvent;
                await connectionInfo.targetClient.send("Input.dispatchKeyEvent", {
                  type: event.type,
                  text: event.text,
                  unmodifiedText: event.text ? event.text.toLowerCase() : undefined,
                  code: event.code,
                  key: event.key,
                  windowsVirtualKeyCode: event.keyCode,
                  nativeVirtualKeyCode: event.keyCode,
                  modifiers: event.modifiers || 0,
                  autoRepeat: false,
                  isKeypad: false,
                  isSystemKey: false,
                });
                logger.debug(`Key event dispatched for client ${clientId}`);
              } else {
                logger.warn(`Key event ignored - no target page for client ${clientId}`);
              }
              break;

            case "navigation":
              logger.info(`Navigation event from client ${clientId}`, {
                url: data.event?.url,
              });

              if (connectionInfo.targetPage) {
                const { event } = data as NavigationEvent;
                await navigatePage(event, connectionInfo.targetPage);
                logger.info(`Navigation completed for client ${clientId}`);
              } else {
                logger.warn(`Navigation event ignored - no target page for client ${clientId}`);
              }
              break;

            case "ping":
              // Respond to ping with pong
              try {
                ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
                connectionInfo.messagesSent++;
                logger.debug(`Pong sent to client ${clientId}`);
              } catch (err) {
                logger.error(`Error sending pong to client ${clientId}`, err);
              }
              break;

            default:
              logger.warn(`Unknown message type from client ${clientId}`, {
                type: data.type,
                keys: Object.keys(data),
              });
          }
        } catch (err) {
          connectionInfo.errors++;
          logger.error(`Error handling message from client ${clientId}`, err);

          // Send error response to client if possible
          try {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: "error",
                  message: "Failed to process message",
                  timestamp: Date.now(),
                }),
              );
              connectionInfo.messagesSent++;
            }
          } catch (sendErr) {
            logger.error(`Error sending error response to client ${clientId}`, sendErr);
          }
        }
      });

      // Set up heartbeat to detect dead connections
      heartbeatInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.ping();
            logger.debug(`Heartbeat ping sent to client ${clientId}`);
          } catch (err) {
            logger.error(`Error sending heartbeat ping to client ${clientId}`, err);
            handleSessionCleanup("heartbeat_error");
          }
        } else {
          logger.warn(`WebSocket not open for heartbeat, cleaning up client ${clientId}`, {
            readyState: ws.readyState,
          });
          handleSessionCleanup("websocket_not_open");
        }
      }, 30000); // Every 30 seconds

      // Handle WebSocket pong responses
      ws.on("pong", () => {
        connectionInfo.lastActivity = new Date();
        logger.debug(`Heartbeat pong received from client ${clientId}`);
      });

      // Handle WebSocket closure
      ws.on("close", (code, reason) => {
        logger.info(`WebSocket closed for client ${clientId}`, {
          code,
          reason: reason?.toString() || "no reason provided",
        });
        handleSessionCleanup(`websocket_close_${code}`);
      });

      // Handle WebSocket errors
      ws.on("error", (err) => {
        connectionInfo.errors++;
        logger.error(`WebSocket error for client ${clientId}`, err);
        handleSessionCleanup("websocket_error");
      });

      // Send initial connection confirmation
      try {
        const confirmationMessage = {
          type: "connection_established",
          clientId,
          timestamp: Date.now(),
          serverInfo: {
            version: "1.0.0", // Could be extracted from package.json
            capabilities: ["webrtc", "input_events", "navigation"],
          },
        };

        ws.send(JSON.stringify(confirmationMessage));
        connectionInfo.messagesSent++;
        logger.info(`Connection confirmation sent to client ${clientId}`);
      } catch (err) {
        logger.error(`Error sending connection confirmation to client ${clientId}`, err);
      }
    } catch (err) {
      connectionInfo.errors++;
      logger.error(`Error setting up WebRTC session for client ${clientId}`, err);

      // Send error message to client if WebSocket is available
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: "setup_error",
              message: "Failed to initialize session",
              timestamp: Date.now(),
            }),
          );
        }
      } catch (sendErr) {
        logger.error(`Error sending setup error to client ${clientId}`, sendErr);
      }

      handleSessionCleanup("setup_error");
      socket.destroy();
    }
  });
}
