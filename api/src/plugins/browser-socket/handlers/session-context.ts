import type { CDPService } from "../../../services/cdp/cdp.service.js";
import type { WebSocketHandlerContext } from "../../../types/websocket.js";

export function sessionCDPService(context: WebSocketHandlerContext): CDPService | null {
  try {
    const session = context.sessionId
      ? context.fastify.sessionService.getLiveSession(context.sessionId)
      : context.fastify.sessionService.getOnlyActiveSession();
    return session && !session.isSelenium ? session.cdpService : null;
  } catch {
    return null;
  }
}
