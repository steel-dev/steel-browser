import { type FastifyInstance, type FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { WebSocketServer } from "ws";
import { WebSocketRegistryService } from "../../services/websocket-registry.service.js";
import { WebSocketHandler, WebSocketHandlerContext } from "../../types/websocket.js";
import { defaultHandlers } from "./handlers/index.js";

export interface BrowserSocketOptions {
  customHandlers?: WebSocketHandler[];
}

const wss = new WebSocketServer({ noServer: true });

const browserWebSocket: FastifyPluginAsync<BrowserSocketOptions> = async (
  fastify: FastifyInstance,
  options: BrowserSocketOptions,
) => {
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

    const matchResult = registry.matchHandlerWithSession(url);

    if (matchResult?.handler) {
      const context: WebSocketHandlerContext = {
        fastify,
        wss,
        params,
        sessionId: matchResult.sessionId,
      };

      try {
        await matchResult.handler.handler(request, socket, head, context);
      } catch (err) {
        fastify.log.error({ err }, `WebSocket handler error for ${url}`);
        socket.destroy();
      }
    } else if (matchResult?.sessionId) {
      const session = fastify.sessionService.getSession(matchResult.sessionId);
      if (session) {
        fastify.log.info(`Proxying CDP WebSocket for session ${matchResult.sessionId}`);
        try {
          await session.cdpService.proxyWebSocket(request, socket, head);
        } catch (err) {
          fastify.log.error({ err }, "Session CDP WebSocket proxy error");
          socket.destroy();
        }
      } else {
        fastify.log.warn(`Session ${matchResult.sessionId} not found for CDP WebSocket`);
        socket.destroy();
      }
    } else {
      const sessions = fastify.sessionService.listSessions();
      if (sessions.length > 0) {
        fastify.log.info("Proxying CDP WebSocket to first active session (legacy fallback)");
        try {
          await sessions[0].cdpService.proxyWebSocket(request, socket, head);
        } catch (err) {
          fastify.log.error({ err }, "CDP WebSocket error");
          socket.destroy();
        }
      } else {
        fastify.log.warn("No active sessions for CDP WebSocket proxy");
        socket.destroy();
      }
    }
  });
};

export default fp(browserWebSocket, { name: "browser-websocket" });
