import wrtc from "@roamhq/wrtc";
import { WebSocket } from "ws";

// Enhanced logging utility
class WebRTCLogger {
  private prefix: string;

  constructor(prefix: string = "WebRTCServer") {
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

// Connection state tracking interface
interface ConnectionState {
  connectionState: RTCPeerConnectionState;
  iceConnectionState: RTCIceConnectionState;
  iceGatheringState: RTCIceGatheringState;
  signalingState: RTCSignalingState;
  connectedAt?: Date;
  lastStateChange: Date;
}

// Connection statistics interface
interface ConnectionStats {
  bytesReceived: number;
  bytesSent: number;
  packetsReceived: number;
  packetsSent: number;
  packetsLost: number;
  jitter: number;
  rtt: number;
}

// Singleton class to manage WebRTC connections
export class WebRTCServer {
  private peerConnections = new Map<string, wrtc.RTCPeerConnection>();
  private websockets = new Map<string, WebSocket>();
  private connectionStates = new Map<string, ConnectionState>();
  private connectionStats = new Map<string, ConnectionStats>();
  private statsInterval: NodeJS.Timeout | null = null;
  private logger = new WebRTCLogger("WebRTCServer");

  constructor() {
    this.logger.info("WebRTC server initializing...");
    this.startStatsMonitoring();
    this.logger.info("WebRTC server initialized successfully");
  }

  /**
   * Start monitoring connection statistics
   */
  private startStatsMonitoring(): void {
    this.logger.debug("Starting connection statistics monitoring");

    // Monitor stats every 5 seconds
    this.statsInterval = setInterval(async () => {
      await this.updateConnectionStats();
    }, 5000);
  }

  /**
   * Update connection statistics for all active connections
   */
  private async updateConnectionStats(): Promise<void> {
    if (this.peerConnections.size === 0) {
      return;
    }

    this.logger.debug(`Updating stats for ${this.peerConnections.size} connections`);

    for (const [clientId, pc] of this.peerConnections) {
      try {
        const stats = await pc.getStats();
        const connectionStats = this.parseRTCStats(stats);
        this.connectionStats.set(clientId, connectionStats);

        // Log connection health if there are issues
        const state = this.connectionStates.get(clientId);
        if (state && (connectionStats.packetsLost > 0 || connectionStats.rtt > 200)) {
          this.logger.warn(`Connection quality issues for client ${clientId}`, {
            packetsLost: connectionStats.packetsLost,
            rtt: connectionStats.rtt,
            jitter: connectionStats.jitter,
          });
        }
      } catch (error) {
        this.logger.error(`Error getting stats for client ${clientId}`, error);
      }
    }
  }

  /**
   * Parse RTCStats into our simplified format
   */
  private parseRTCStats(stats: RTCStatsReport): ConnectionStats {
    const connectionStats: ConnectionStats = {
      bytesReceived: 0,
      bytesSent: 0,
      packetsReceived: 0,
      packetsSent: 0,
      packetsLost: 0,
      jitter: 0,
      rtt: 0,
    };

    stats.forEach((stat) => {
      if (stat.type === "outbound-rtp" && stat.mediaType === "video") {
        connectionStats.bytesSent += stat.bytesSent || 0;
        connectionStats.packetsSent += stat.packetsSent || 0;
      } else if (stat.type === "inbound-rtp" && stat.mediaType === "video") {
        connectionStats.bytesReceived += stat.bytesReceived || 0;
        connectionStats.packetsReceived += stat.packetsReceived || 0;
        connectionStats.packetsLost += stat.packetsLost || 0;
        connectionStats.jitter = stat.jitter || 0;
      } else if (stat.type === "candidate-pair" && stat.state === "succeeded") {
        connectionStats.rtt = stat.currentRoundTripTime ? stat.currentRoundTripTime * 1000 : 0;
      }
    });

    return connectionStats;
  }

  /**
   * Create a new peer connection for a client
   * @param clientId Unique identifier for the client
   * @param ws WebSocket connection for signaling
   * @returns The created RTCPeerConnection
   */
  async createPeerConnection(clientId: string, ws: WebSocket): Promise<wrtc.RTCPeerConnection> {
    this.logger.info(`Creating peer connection for client ${clientId}`);

    // Close any existing connection for this client
    if (this.peerConnections.has(clientId)) {
      this.logger.warn(`Existing connection found for client ${clientId}, closing it first`);
      await this.closePeerConnection(clientId);
    }

    // Create a new RTCPeerConnection with STUN server
    const configuration = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
      iceCandidatePoolSize: 10,
    };

    this.logger.debug(`Creating RTCPeerConnection with configuration`, configuration);
    const pc = new wrtc.RTCPeerConnection(configuration);

    // Store the peer connection and websocket
    this.peerConnections.set(clientId, pc);
    this.websockets.set(clientId, ws);

    // Initialize connection state tracking
    const initialState: ConnectionState = {
      connectionState: pc.connectionState,
      iceConnectionState: pc.iceConnectionState,
      iceGatheringState: pc.iceGatheringState,
      signalingState: pc.signalingState,
      lastStateChange: new Date(),
    };
    this.connectionStates.set(clientId, initialState);

    this.logger.debug(`Initial connection state for client ${clientId}`, initialState);

    // Set up event handlers
    this.setupPeerConnectionEventHandlers(clientId, pc, ws);

    this.logger.info(`Peer connection created successfully for client ${clientId}`);
    return pc;
  }

  /**
   * Set up event handlers for a peer connection
   */
  private setupPeerConnectionEventHandlers(
    clientId: string,
    pc: wrtc.RTCPeerConnection,
    ws: WebSocket,
  ): void {
    this.logger.debug(`Setting up event handlers for client ${clientId}`);

    // ICE candidate event handler
    pc.onicecandidate = (event) => {
      this.logger.debug(`ICE candidate event for client ${clientId}`, {
        hasCandidate: !!event.candidate,
        candidate: event.candidate
          ? {
              candidate: event.candidate.candidate,
              sdpMid: event.candidate.sdpMid,
              sdpMLineIndex: event.candidate.sdpMLineIndex,
            }
          : null,
      });

      if (event.candidate) {
        try {
          const message = {
            type: "ice",
            candidate: event.candidate,
          };

          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
            this.logger.debug(`ICE candidate sent to client ${clientId}`);
          } else {
            this.logger.warn(
              `Cannot send ICE candidate, WebSocket not open for client ${clientId}`,
              {
                readyState: ws.readyState,
              },
            );
          }
        } catch (err) {
          this.logger.error(`Error sending ICE candidate to client ${clientId}`, err);
        }
      } else {
        this.logger.debug(`ICE gathering completed for client ${clientId}`);
      }
    };

    // Connection state change handler
    pc.onconnectionstatechange = () => {
      const state = this.connectionStates.get(clientId);
      if (state) {
        const oldConnectionState = state.connectionState;
        state.connectionState = pc.connectionState;
        state.lastStateChange = new Date();

        if (pc.connectionState === "connected" && !state.connectedAt) {
          state.connectedAt = new Date();
        }

        this.logger.info(`Connection state changed for client ${clientId}`, {
          from: oldConnectionState,
          to: pc.connectionState,
          timestamp: state.lastStateChange.toISOString(),
        });

        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          this.logger.warn(`Connection ${pc.connectionState} for client ${clientId}, cleaning up`);
          this.closePeerConnection(clientId).catch((err) => {
            this.logger.error(`Error closing peer connection for ${clientId}`, err);
          });
        }
      }
    };

    // ICE connection state change handler
    pc.oniceconnectionstatechange = () => {
      const state = this.connectionStates.get(clientId);
      if (state) {
        const oldIceState = state.iceConnectionState;
        state.iceConnectionState = pc.iceConnectionState;
        state.lastStateChange = new Date();

        this.logger.info(`ICE connection state changed for client ${clientId}`, {
          from: oldIceState,
          to: pc.iceConnectionState,
          timestamp: state.lastStateChange.toISOString(),
        });

        if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") {
          this.logger.warn(`ICE connection ${pc.iceConnectionState} for client ${clientId}`);
        }
      }
    };

    // ICE gathering state change handler
    pc.onicegatheringstatechange = () => {
      const state = this.connectionStates.get(clientId);
      if (state) {
        const oldGatheringState = state.iceGatheringState;
        state.iceGatheringState = pc.iceGatheringState;
        state.lastStateChange = new Date();

        this.logger.debug(`ICE gathering state changed for client ${clientId}`, {
          from: oldGatheringState,
          to: pc.iceGatheringState,
        });
      }
    };

    // Signaling state change handler
    pc.onsignalingstatechange = () => {
      const state = this.connectionStates.get(clientId);
      if (state) {
        const oldSignalingState = state.signalingState;
        state.signalingState = pc.signalingState;
        state.lastStateChange = new Date();

        this.logger.debug(`Signaling state changed for client ${clientId}`, {
          from: oldSignalingState,
          to: pc.signalingState,
        });
      }
    };

    // Data channel handler (if needed in the future)
    pc.ondatachannel = (event) => {
      this.logger.info(`Data channel received for client ${clientId}`, {
        label: event.channel.label,
        protocol: event.channel.protocol,
      });
    };

    this.logger.debug(`Event handlers set up successfully for client ${clientId}`);
  }

  /**
   * Create
 and send an offer to the client
   * @param clientId Unique identifier for the client
   */
  async createOffer(clientId: string): Promise<void> {
    this.logger.info(`Creating offer for client ${clientId}`);

    const pc = this.peerConnections.get(clientId);
    const ws = this.websockets.get(clientId);

    if (!pc || !ws) {
      const error = new Error(`No peer connection or websocket found for client ${clientId}`);
      this.logger.error("Cannot create offer", error);
      throw error;
    }

    try {
      // Create an offer with specific constraints
      const offerOptions: RTCOfferOptions = {
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
      };

      this.logger.debug(`Creating offer with options for client ${clientId}`, offerOptions);
      const offer = await pc.createOffer(offerOptions);

      this.logger.debug(`Offer created for client ${clientId}`, {
        type: offer.type,
        sdpLength: offer.sdp ? offer.sdp.length : 0,
      });

      // Set local description
      await pc.setLocalDescription(offer);
      this.logger.debug(`Local description set for client ${clientId}`);

      // Send the offer to the client
      const message = {
        type: "offer",
        sdp: pc.localDescription,
      };

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
        this.logger.info(`Offer sent successfully to client ${clientId}`);
      } else {
        const error = new Error(
          `WebSocket not open when trying to send offer to client ${clientId}`,
        );
        this.logger.error("Cannot send offer", error);
        throw error;
      }
    } catch (error) {
      this.logger.error(`Error creating/sending offer for client ${clientId}`, error);
      throw error;
    }
  }

  /**
   * Process an answer from the client
   * @param clientId Unique identifier for the client
   * @param sdp SDP from the client's answer
   */
  async processAnswer(clientId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    this.logger.info(`Processing answer from client ${clientId}`);

    const pc = this.peerConnections.get(clientId);

    if (!pc) {
      const error = new Error(`No peer connection found for client ${clientId}`);
      this.logger.error("Cannot process answer", error);
      throw error;
    }

    try {
      this.logger.debug(`Answer SDP for client ${clientId}`, {
        type: sdp.type,
        sdpLength: sdp.sdp ? sdp.sdp.length : 0,
      });

      await pc.setRemoteDescription(sdp);
      this.logger.info(`Remote description set successfully for client ${clientId}`);

      // Log current signaling state after setting remote description
      this.logger.debug(`Current signaling state for client ${clientId}: ${pc.signalingState}`);
    } catch (error) {
      this.logger.error(`Error setting remote description for client ${clientId}`, error);
      throw error;
    }
  }

  /**
   * Add an ICE candidate from the client
   * @param clientId Unique identifier for the client
   * @param candidate ICE candidate from the client
   */
  async addIceCandidate(clientId: string, candidate: RTCIceCandidateInit): Promise<void> {
    this.logger.debug(`Adding ICE candidate for client ${clientId}`, {
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid,
      sdpMLineIndex: candidate.sdpMLineIndex,
    });

    const pc = this.peerConnections.get(clientId);

    if (!pc) {
      const error = new Error(`No peer connection found for client ${clientId}`);
      this.logger.error("Cannot add ICE candidate", error);
      throw error;
    }

    try {
      await pc.addIceCandidate(candidate);
      this.logger.debug(`ICE candidate added successfully for client ${clientId}`);
    } catch (error) {
      this.logger.error(`Error adding ICE candidate for client ${clientId}`, error);
      // Don't throw here as some ICE candidate failures are normal
      this.logger.warn(`Continuing despite ICE candidate error for client ${clientId}`);
    }
  }

  /**
   * Add a track to a peer connection
   * @param clientId Unique identifier for the client
   * @param track MediaStreamTrack to add
   * @param stream MediaStream that the track belongs to
   */
  addTrack(clientId: string, track: MediaStreamTrack, stream: MediaStream): void {
    this.logger.info(`Adding track to peer connection for client ${clientId}`, {
      trackKind: track.kind,
      trackId: track.id,
      streamId: stream.id,
      trackEnabled: track.enabled,
      trackReadyState: track.readyState,
    });

    const pc = this.peerConnections.get(clientId);

    if (!pc) {
      const error = new Error(`No peer connection found for client ${clientId}`);
      this.logger.error("Cannot add track", error);
      throw error;
    }

    try {
      const sender = pc.addTrack(track, stream);
      this.logger.info(`Track added successfully for client ${clientId}`, {
        senderId: sender ? "generated" : "none",
      });
    } catch (error) {
      this.logger.error(`Error adding track for client ${clientId}`, error);
      throw error;
    }
  }

  /**
   * Get connection statistics for a client
   * @param clientId Unique identifier for the client
   * @returns Connection statistics or null if not found
   */
  getConnectionStats(clientId: string): ConnectionStats | null {
    return this.connectionStats.get(clientId) || null;
  }

  /**
   * Get connection state for a client
   * @param clientId Unique identifier for the client
   * @returns Connection state or null if not found
   */
  getConnectionState(clientId: string): ConnectionState | null {
    return this.connectionStates.get(clientId) || null;
  }

  /**
   * Get all active client IDs
   * @returns Array of active client IDs
   */
  getActiveClients(): string[] {
    return Array.from(this.peerConnections.keys());
  }

  /**
   * Close a peer connection
   * @param clientId Unique identifier for the client
   */
  async closePeerConnection(clientId: string): Promise<void> {
    this.logger.info(`Closing peer connection for client ${clientId}`);

    const pc = this.peerConnections.get(clientId);

    if (pc) {
      try {
        // Log final stats before closing
        const stats = this.connectionStats.get(clientId);
        const state = this.connectionStates.get(clientId);

        if (stats && state) {
          const connectionDuration = state.connectedAt
            ? Date.now() - state.connectedAt.getTime()
            : 0;

          this.logger.info(`Final stats for client ${clientId}`, {
            connectionDuration: Math.round(connectionDuration / 1000) + "s",
            bytesReceived: stats.bytesReceived,
            bytesSent: stats.bytesSent,
            packetsLost: stats.packetsLost,
            finalState: state.connectionState,
          });
        }

        pc.close();
        this.logger.debug(`Peer connection closed for client ${clientId}`);
      } catch (err) {
        this.logger.error(`Error closing peer connection for ${clientId}`, err);
      }

      this.peerConnections.delete(clientId);
    }

    // Clean up associated data
    this.websockets.delete(clientId);
    this.connectionStates.delete(clientId);
    this.connectionStats.delete(clientId);

    this.logger.info(`All resources cleaned up for client ${clientId}`);
  }

  /**
   * Close all peer connections
   */
  async closeAll(): Promise<void> {
    this.logger.info(`Closing all peer connections (${this.peerConnections.size} active)`);

    const clientIds = Array.from(this.peerConnections.keys());

    for (const clientId of clientIds) {
      await this.closePeerConnection(clientId);
    }

    // Stop stats monitoring
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
      this.logger.debug("Stats monitoring stopped");
    }

    this.logger.info("All peer connections closed successfully");
  }

  /**
   * Get server summary statistics
   */
  getServerStats(): {
    activeConnections: number;
    totalBytesReceived: number;
    totalBytesSent: number;
    connections: Array<{
      clientId: string;
      state: string;
      connectedDuration?: number;
      stats: ConnectionStats;
    }>;
  } {
    let totalBytesReceived = 0;
    let totalBytesSent = 0;
    const connections: Array<any> = [];

    for (const [clientId, stats] of this.connectionStats) {
      totalBytesReceived += stats.bytesReceived;
      totalBytesSent += stats.bytesSent;

      const state = this.connectionStates.get(clientId);
      const connectedDuration = state?.connectedAt
        ? Date.now() - state.connectedAt.getTime()
        : undefined;

      connections.push({
        clientId,
        state: state?.connectionState || "unknown",
        connectedDuration,
        stats,
      });
    }

    return {
      activeConnections: this.peerConnections.size,
      totalBytesReceived,
      totalBytesSent,
      connections,
    };
  }
}

// Create a singleton instance
const webRTCServer = new WebRTCServer();
export default webRTCServer;
