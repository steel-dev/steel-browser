import { WebSocketHandler, WebSocketHandlerRegistry } from "../types/websocket.js";

export class WebSocketRegistryService implements WebSocketHandlerRegistry {
  public handlers = new Map<string, WebSocketHandler>();

  registerHandler(handler: WebSocketHandler): void {
    this.handlers.set(handler.path, handler);
  }

  getHandler(path: string): WebSocketHandler | undefined {
    return this.handlers.get(path);
  }

  matchHandler(url: string): WebSocketHandler | undefined {
    // TODO: use path-to-regexp or find-my-way to match the path
    // Find the first handler whose path matches the start of the URL
    for (const [path, handler] of this.handlers.entries()) {
      if (url.startsWith(path)) {
        return handler;
      }
    }
    return undefined;
  }
}
