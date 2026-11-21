import { IncomingMessage } from "http";
import { Duplex } from "stream";
import { WebSocketHandler, WebSocketHandlerContext } from "../../../types/websocket.js";
import { handleCastSession } from "../casting.handler.js";

export const castHandler: WebSocketHandler = {
  // Match /v1/sessions/<sessionId>/cast. Static routes such as
  // /v1/sessions/logs are longer prefixes and take precedence.
  path: "/v1/sessions/",
  handler: async (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    context: WebSocketHandlerContext,
  ) => {
    context.fastify.log.info("Connecting to cast...");
    await handleCastSession(
      request,
      socket,
      head,
      context.wss,
      context.fastify.sessionService,
      context.params,
    );
  },
};
