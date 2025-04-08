import { type FastifyInstance, type FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import WebSocket from "ws";
import { EmitEvent } from "../../types/enums";
import { handleCastSession } from "./casting.handler";

// WebSocket server instance
const wss = new WebSocket.Server({ noServer: true });

// WebSocket handlers
function handleLogsWebSocket(fastify: FastifyInstance, ws: WebSocket) {
  const messageHandler = (payload: { pageId: string }) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify([payload]));
    }
  };

  fastify.cdpService.on(EmitEvent.Log, messageHandler);

  ws.on("error", (err) => {
    fastify.log.error("PageId WebSocket error:", err);
  });

  ws.on("close", () => {
    fastify.log.info("PageId WebSocket connection closed");
    fastify.cdpService.removeListener(`log`, messageHandler);
  });
}

const browserWebSocket: FastifyPluginAsync = async (fastify: FastifyInstance, options: any) => {
  if (!fastify.cdpService.isRunning()) {
    fastify.log.info("Launching browser...");
    await fastify.cdpService.launch();
    fastify.log.info("Browser launched successfully");
  }

  fastify.server.on("upgrade", async (request, socket, head) => {
    fastify.log.info("Upgrading browser socket...");
    const url = request.url ?? "";
    const params = Object.fromEntries(new URL(url || "", `http://${request.headers.host}`).searchParams.entries());

    switch (true) {
      case url.startsWith("/v1/sessions/logs"):
        fastify.log.info("Connecting to logs...");
        wss.handleUpgrade(request, socket, head, (ws) => handleLogsWebSocket(fastify, ws));
        break;

      case url.startsWith("/v1/sessions/cast"):
        fastify.log.info("Connecting to cast...");
        await handleCastSession(request, socket, head, wss, fastify.sessionService, params);
        break;

      case url.startsWith("/v1/sessions/pageId"):
        fastify.log.info("Connecting to pageId...");
        wss.handleUpgrade(request, socket, head, (ws) => {
          const messageHandler = (payload: { pageId: string }) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(payload));
            }
          };

          fastify.cdpService.on(`pageId`, messageHandler);

          ws.on("error", (err) => {
            fastify.log.error("PageId WebSocket error:", err);
          });

          ws.on("close", () => {
            fastify.log.info("PageId WebSocket connection closed");
            fastify.cdpService.removeListener(`pageId`, messageHandler);
          });
        });
        break;

      // Handle recording endpoint
      case url.startsWith("/v1/sessions/recording"):
        fastify.log.info("Connecting to recording events...");
        wss.handleUpgrade(request, socket, head, (ws) => {
          const messageHandler = (payload: { events: Record<string, any>[] }) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify(payload.events));
            }
          };

          fastify.cdpService.on(EmitEvent.Recording, messageHandler);

          // TODO: handle inputs to browser from client
          ws.on("message", async (message) => {});

          ws.on("close", () => {
            fastify.log.info("Recording WebSocket connection closed");
            fastify.cdpService.removeListener(EmitEvent.Recording, messageHandler);
          });

          ws.on("error", (err) => {
            fastify.log.error("Recording WebSocket error:", err);
          });
        });
        break;

      // Default route to CDP Service
      default:
        fastify.log.info("Connecting to CDP...");
        try {
          await fastify.cdpService.proxyWebSocket(request, socket, head);
        } catch (err) {
          fastify.log.error("CDP WebSocket error:", err);
          socket.destroy();
        }
        break;
    }
  });
};

export default fp(browserWebSocket, { name: "browser-websocket" });
