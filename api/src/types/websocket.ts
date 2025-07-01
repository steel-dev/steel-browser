import { IncomingMessage } from "http";
import { Duplex } from "stream";
import { WebSocketServer } from "ws";
import { FastifyInstance } from "fastify";

export interface WebSocketHandlerContext {
  fastify: FastifyInstance;
  wss: WebSocketServer;
  params: Record<string, string>;
}

export interface WebSocketHandler {
  path: string;
  handler: (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    context: WebSocketHandlerContext,
  ) => Promise<void> | void;
}

export interface WebSocketHandlerRegistry {
  handlers: Map<string, WebSocketHandler>;
  registerHandler: (handler: WebSocketHandler) => void;
  getHandler: (path: string) => WebSocketHandler | undefined;
  matchHandler: (url: string) => WebSocketHandler | undefined;
}
