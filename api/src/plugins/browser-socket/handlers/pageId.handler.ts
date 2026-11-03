import { IncomingMessage } from "http";
import { Duplex } from "stream";
import { WebSocket } from "ws";
import { WebSocketHandler, WebSocketHandlerContext } from "../../../types/websocket.js";
import { sessionCDPService } from "./session-context.js";

function handlePageIdWebSocket(context: WebSocketHandlerContext, ws: WebSocket) {
  const { fastify } = context;
  const cdpService = sessionCDPService(context);
  if (!cdpService) {
    ws.close(1008, "No active browser session");
    return;
  }

  const messageHandler = (payload: { pageId: string }) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  };

  cdpService.on("pageId", messageHandler);

  ws.on("error", (err) => {
    fastify.log.error({ err }, "PageId WebSocket error");
  });

  ws.on("close", () => {
    fastify.log.info("PageId WebSocket connection closed");
    cdpService.removeListener("pageId", messageHandler);
  });
}

export const pageIdHandler: WebSocketHandler = {
  path: "/v1/sessions/pageId",
  handler: (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    context: WebSocketHandlerContext,
  ) => {
    context.fastify.log.info("Connecting to pageId...");
    context.wss.handleUpgrade(request, socket, head, (ws) => handlePageIdWebSocket(context, ws));
  },
};
