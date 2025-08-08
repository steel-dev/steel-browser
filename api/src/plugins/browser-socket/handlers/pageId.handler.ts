import { IncomingMessage } from "http";
import { Duplex } from "stream";
import { WebSocket } from "ws";
import { WebSocketHandler, WebSocketHandlerContext } from "../../../types/websocket.js";

function handlePageIdWebSocket(context: WebSocketHandlerContext, ws: WebSocket) {
  const { fastify } = context;

  const messageHandler = (payload: { pageId: string }) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  };

  fastify.cdpService.on("pageId", messageHandler);

  ws.on("error", (err: any) => {
    fastify.log.error("PageId WebSocket error:", err);
  });

  ws.on("close", () => {
    fastify.log.info("PageId WebSocket connection closed");
    fastify.cdpService.removeListener("pageId", messageHandler);
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
