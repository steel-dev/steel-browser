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

// The Host header and request-target are client-controlled, so never let them throw here.
export function parseUpgradeParams(url: string): Record<string, string> | null {
  try {
    return Object.fromEntries(new URL(url || "", "http://localhost").searchParams.entries());
  } catch {
    return null;
  }
}

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
    socket.on("error", (err) => fastify.log.debug({ err }, "Upgrade socket error"));
    try {
      fastify.log.info("Upgrading browser socket...");
      const url = request.url ?? "";
      const params = parseUpgradeParams(url);
      if (!params) {
        socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
        return;
      }

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
    } catch (err) {
      fastify.log.error({ err }, "Unexpected upgrade handler error");
      try {
        socket.destroy();
      } catch {}
    }
  });
};

export default fp(browserWebSocket, { name: "browser-websocket" });
