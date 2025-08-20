import { IncomingMessage } from "http";
import { Duplex } from "stream";
import { WebSocket } from "ws";
import { EmitEvent } from "../../../types/enums.js";
import { WebSocketHandler, WebSocketHandlerContext } from "../../../types/websocket.js";

function handleRecordingWebSocket(context: WebSocketHandlerContext, ws: WebSocket) {
  const { fastify } = context;

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
    fastify.log.error({ err }, "Recording WebSocket error");
  });
}

export const recordingHandler: WebSocketHandler = {
  path: "/v1/sessions/recording",
  handler: (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    context: WebSocketHandlerContext,
  ) => {
    context.fastify.log.info("Connecting to recording events...");
    context.wss.handleUpgrade(request, socket, head, (ws) => handleRecordingWebSocket(context, ws));
  },
};
