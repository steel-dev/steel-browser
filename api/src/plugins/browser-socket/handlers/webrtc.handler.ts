import { IncomingMessage } from "http";
import { Duplex } from "stream";
import { WebSocketHandler, WebSocketHandlerContext } from "../../../types/websocket.js";
import { handleWebRTCSession } from "../webrtc-casting.handler.js";

export const webRTCHandler: WebSocketHandler = {
  path: "/v1/sessions/cast",
  handler: async (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    context: WebSocketHandlerContext,
  ) => {
    context.fastify.log.info("Connecting to WebRTC...");
    await handleWebRTCSession(
      request,
      socket,
      head,
      context.wss,
      context.fastify.sessionService,
      context.params,
    );
  },
};
