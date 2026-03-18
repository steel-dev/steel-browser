import { WebSocketHandler, WebSocketHandlerRegistry } from "../types/websocket.js";

export interface MatchResult {
  handler: WebSocketHandler;
  sessionId?: string;
}

export class WebSocketRegistryService implements WebSocketHandlerRegistry {
  public handlers = new Map<string, WebSocketHandler>();

  registerHandler(handler: WebSocketHandler): void {
    this.handlers.set(handler.path, handler);
  }

  getHandler(path: string): WebSocketHandler | undefined {
    return this.handlers.get(path);
  }

  matchHandler(url: string): WebSocketHandler | undefined {
    for (const [path, handler] of this.handlers.entries()) {
      if (url.startsWith(path)) {
        return handler;
      }
    }
    return undefined;
  }

  matchHandlerWithSession(url: string): MatchResult | undefined {
    const sessionCastMatch = url.match(/\/v1\/sessions\/([^/?]+)\/cast/);
    if (sessionCastMatch) {
      const castHandler = this.handlers.get("/v1/sessions/cast");
      if (castHandler) {
        return { handler: castHandler, sessionId: sessionCastMatch[1] };
      }
    }

    const sessionCdpMatch = url.match(/\/v1\/sessions\/([^/?]+)\/cdp/);
    if (sessionCdpMatch) {
      return { handler: undefined as any, sessionId: sessionCdpMatch[1] };
    }

    const handler = this.matchHandler(url);
    if (handler) {
      return { handler };
    }

    return undefined;
  }
}
