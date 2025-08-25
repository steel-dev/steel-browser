import { IncomingMessage } from "http";
import { Duplex } from "stream";
import { WebSocketHandler, WebSocketHandlerContext } from "../../../types/websocket.js";
import { handleWebRTCCastSession } from "../webrtc.handler.js";

export const webRTCHandler: WebSocketHandler = {
  path: "/v1/sessions/webrtc",
  handler: async (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    context: WebSocketHandlerContext,
  ) => {
    context.fastify.log.info("Connecting to cast...");
    await handleWebRTCCastSession(request, socket, context.fastify.sessionService, context.params);
  },
};
