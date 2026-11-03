import { WebSocketHandler, WebSocketHandlerRegistry } from "../types/websocket.js";

export interface SessionWebSocketMatch {
  handler?: WebSocketHandler;
  sessionId?: string;
  cdp?: boolean;
  cdpPath?: string;
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
    let pathname: string;
    try {
      pathname = new URL(url, "http://localhost").pathname;
    } catch {
      return undefined;
    }
    for (const [path, handler] of this.handlers.entries()) {
      if (pathname === path || pathname.startsWith(`${path}/`)) {
        return handler;
      }
    }
    return undefined;
  }

  matchHandlerWithSession(url: string): SessionWebSocketMatch | undefined {
    let pathname: string;
    try {
      pathname = new URL(url, "http://localhost").pathname;
    } catch {
      return undefined;
    }

    const parts = pathname.split("/").filter(Boolean);
    if (parts.length >= 4 && parts[0] === "v1" && parts[1] === "sessions") {
      let sessionId: string;
      try {
        sessionId = decodeURIComponent(parts[2]);
      } catch {
        return undefined;
      }
      if (parts[3] === "cdp") {
        return { sessionId, cdp: true, cdpPath: parts.slice(4).join("/") };
      }
      if (parts.length !== 4) return undefined;
      const handler = this.handlers.get(`/v1/sessions/${parts[3]}`);
      if (handler) return { handler, sessionId };
    }

    const handler = this.matchHandler(pathname);
    return handler ? { handler } : undefined;
  }
}
