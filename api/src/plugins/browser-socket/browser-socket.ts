import { type FastifyInstance, type FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { WebSocketServer } from "ws";
import { WebSocketRegistryService } from "../../services/websocket-registry.service.js";
import { SessionServiceError } from "../../services/session.service.js";
import { WebSocketHandler, WebSocketHandlerContext } from "../../types/websocket.js";
import { defaultHandlers } from "./handlers/index.js";

export interface BrowserSocketOptions {
  customHandlers?: WebSocketHandler[];
}

const wss = new WebSocketServer({ noServer: true });

export function parseUpgradeParams(url: string): Record<string, string> | null {
  try {
    return Object.fromEntries(new URL(url || "", "http://localhost").searchParams.entries());
  } catch {
    return null;
  }
}

function rejectSocket(socket: import("stream").Duplex, status: number, reason: string) {
  const message =
    status === 400
      ? "Bad Request"
      : status === 404
      ? "Not Found"
      : status === 409
      ? "Conflict"
      : status === 410
      ? "Gone"
      : status === 503
      ? "Service Unavailable"
      : "Internal Server Error";
  socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n${reason}`);
}

const browserWebSocket: FastifyPluginAsync<BrowserSocketOptions> = async (
  fastify: FastifyInstance,
  options: BrowserSocketOptions,
) => {
  const registry = new WebSocketRegistryService();
  for (const handler of defaultHandlers) registry.registerHandler(handler);
  for (const handler of options.customHandlers ?? []) registry.registerHandler(handler);
  fastify.decorate("webSocketRegistry", registry);

  fastify.server.on("upgrade", async (request, socket, head) => {
    const url = request.url ?? "";
    const params = parseUpgradeParams(url);
    if (!params) {
      rejectSocket(socket, 400, "Invalid request URL");
      return;
    }

    const match = registry.matchHandlerWithSession(url);
    if (match?.handler) {
      const sessionScoped = match.handler.path.startsWith("/v1/sessions/");
      let sessionId = match.sessionId;
      if (sessionScoped) {
        try {
          const session = sessionId
            ? fastify.sessionService.resolveLiveSession(sessionId)
            : fastify.sessionService.getOnlyActiveSession();
          if (!session) {
            rejectSocket(socket, 404, "Session not found");
            return;
          }
          sessionId = session.id;
        } catch (error) {
          const status = error instanceof SessionServiceError ? error.statusCode : 500;
          rejectSocket(socket, status, error instanceof Error ? error.message : String(error));
          return;
        }
      }

      const context: WebSocketHandlerContext = { fastify, wss, params, sessionId };
      try {
        await match.handler.handler(request, socket, head, context);
      } catch (error) {
        fastify.log.error({ err: error }, `WebSocket handler error for ${url}`);
        socket.destroy();
      }
      return;
    }

    let cdpService: import("../../services/cdp/cdp.service.js").CDPService;
    let cdpTarget: string | undefined;
    try {
      if (match?.cdp && match.sessionId) {
        const session = fastify.sessionService.resolveLiveSession(match.sessionId);
        if (session.isSelenium) {
          rejectSocket(socket, 409, "Session does not expose CDP");
          return;
        }
        cdpService = session.cdpService;
        if (match.cdpPath) {
          const pagePath = match.cdpPath.match(/^devtools\/page\/([^/]+)$/);
          if (!pagePath) {
            rejectSocket(socket, 404, "CDP endpoint not found");
            return;
          }
          try {
            cdpTarget = cdpService.getPageWsEndpoint(decodeURIComponent(pagePath[1])) ?? undefined;
          } catch {
            cdpTarget = undefined;
          }
          if (!cdpTarget) {
            rejectSocket(socket, 404, "Browser page not found");
            return;
          }
        }
      } else {
        const session = fastify.sessionService.getOnlyActiveSession();
        if (session?.isSelenium) {
          rejectSocket(socket, 409, "Session does not expose CDP");
          return;
        }
        cdpService = session?.cdpService ?? fastify.cdpService;
      }
    } catch (error) {
      const status = error instanceof SessionServiceError ? error.statusCode : 500;
      rejectSocket(socket, status, error instanceof Error ? error.message : String(error));
      return;
    }

    if (!cdpService.isRunning()) {
      rejectSocket(socket, 503, "Browser is not running");
      return;
    }

    try {
      fastify.log.info({ sessionId: match?.sessionId }, "Proxying CDP WebSocket");
      await cdpService.proxyWebSocket(request, socket, head, cdpTarget);
    } catch (error) {
      fastify.log.error({ err: error }, "CDP WebSocket proxy error");
      socket.destroy();
    }
  });
};

export default fp(browserWebSocket, { name: "browser-websocket" });
