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
    // Prefer the longest matching prefix so static routes (for example
    // /v1/sessions/logs) win over the generic /v1/sessions/ cast route.
    let matched: WebSocketHandler | undefined;
    let matchedLength = -1;

    for (const [path, handler] of this.handlers.entries()) {
      if (url.startsWith(path) && path.length > matchedLength) {
        matched = handler;
        matchedLength = path.length;
      }
    }

    return matched;
  }
}
