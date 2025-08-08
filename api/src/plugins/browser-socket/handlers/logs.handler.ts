import { IncomingMessage } from "http";
import { Duplex } from "stream";
import { WebSocket } from "ws";
import { EmitEvent } from "../../../types/enums.js";
import { WebSocketHandler, WebSocketHandlerContext } from "../../../types/websocket.js";

function handleLogsWebSocket(context: WebSocketHandlerContext, ws: WebSocket) {
  const { fastify } = context;

  const messageHandler = (payload: { pageId: string }) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify([payload]));
    }
  };

  fastify.cdpService.on(EmitEvent.Log, messageHandler);

  ws.on("error", (err: any) => {
    fastify.log.error("Logs WebSocket error:", err);
  });

  ws.on("close", () => {
    fastify.log.info("Logs WebSocket connection closed");
    fastify.cdpService.removeListener("log", messageHandler);
  });
}

export const logsHandler: WebSocketHandler = {
  path: "/v1/sessions/logs",
  handler: (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    context: WebSocketHandlerContext,
  ) => {
    context.fastify.log.info("Connecting to logs...");
    context.wss.handleUpgrade(request, socket, head, (ws) => handleLogsWebSocket(context, ws));
  },
};
