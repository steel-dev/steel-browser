import { type FastifyInstance, type FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { WebSocketServer } from "ws";
import { WebSocketRegistryService } from "../../services/websocket-registry.service.js";
import { WebSocketHandler, WebSocketHandlerContext } from "../../types/websocket.js";
import { defaultHandlers } from "./handlers/index.js";

export interface BrowserSocketOptions {
  customHandlers?: WebSocketHandler[];
}

// WebSocket server instance
const wss = new WebSocketServer({ noServer: true });

const browserWebSocket: FastifyPluginAsync<BrowserSocketOptions> = async (
  fastify: FastifyInstance,
  options: BrowserSocketOptions,
) => {
  if (!fastify.cdpService.isRunning()) {
    fastify.log.info("Launching browser...");
    await fastify.cdpService.launch();
    fastify.log.info("Browser launched successfully");
  }

  const registry = new WebSocketRegistryService();

  defaultHandlers.forEach((handler) => {
    registry.registerHandler(handler);
  });

  if (options.customHandlers) {
    options.customHandlers.forEach((handler) => {
      registry.registerHandler(handler);
    });
  }

  fastify.decorate("webSocketRegistry", registry);

  fastify.server.on("upgrade", async (request, socket, head) => {
    fastify.log.info("Upgrading browser socket...");
    const url = request.url ?? "";
    const params = Object.fromEntries(
      new URL(url || "", `http://${request.headers.host}`).searchParams.entries(),
    );

    const context: WebSocketHandlerContext = {
      fastify,
      wss,
      params,
    };

    const handler = registry.matchHandler(url);

    if (handler) {
      try {
        await handler.handler(request, socket, head, context);
      } catch (err) {
        fastify.log.error({ err }, `WebSocket handler error for ${url}`);
        socket.destroy();
      }
    } else {
      fastify.log.info("Connecting to CDP...");
      try {
        await fastify.cdpService.proxyWebSocket(request, socket, head);
      } catch (err) {
        fastify.log.error({ err }, "CDP WebSocket error");
        socket.destroy();
      }
    }
  });
};

export default fp(browserWebSocket, { name: "browser-websocket" });
