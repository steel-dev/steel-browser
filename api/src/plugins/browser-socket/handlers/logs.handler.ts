import { IncomingMessage } from "http";
import { Duplex } from "stream";
import { WebSocket } from "ws";
import { EmitEvent } from "../../../types/enums.js";
import { WebSocketHandler, WebSocketHandlerContext } from "../../../types/websocket.js";
import { sessionCDPService } from "./session-context.js";

function handleLogsWebSocket(context: WebSocketHandlerContext, ws: WebSocket) {
  const { fastify } = context;
  const cdpService = sessionCDPService(context);
  if (!cdpService) {
    ws.close(1008, "No active browser session");
    return;
  }

  const messageHandler = (payload: { pageId: string }) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify([payload]));
    }
  };

  cdpService.on(EmitEvent.Log, messageHandler);

  ws.on("error", (err) => {
    fastify.log.error({ err }, "Logs WebSocket error");
  });

  ws.on("close", () => {
    fastify.log.info("Logs WebSocket connection closed");
    cdpService.removeListener(EmitEvent.Log, messageHandler);
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
