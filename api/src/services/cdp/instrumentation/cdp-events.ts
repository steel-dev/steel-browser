import type { CDPSession } from "puppeteer-core";
import { BrowserEventType } from "../../../types/index.js";
import { BrowserLogger } from "./browser-logger.js";

/**
 * Attaches protocol tracing to a CDP session.
 * Logs only protocol commands / notifications so you can diff automation flow between runs.
 */
export function attachCdpEvents(session: CDPSession, logger: BrowserLogger): void {
  const sessionId = session.id?.() ?? "unknown";
  const ts = () => new Date().toISOString();
  const originalSend = session.send.bind(session);
  type Method = Parameters<typeof session.send>[0];

  session.send = async function (method: Method, params?: object) {
    const start = performance.now();

    logger.record({
      type: BrowserEventType.CdpCommand,
      timestamp: ts(),
      cdp: { command: method, params, sessionId },
    });

    try {
      const result = await originalSend(method, params);
      logger.record({
        type: BrowserEventType.CdpCommandResult,
        timestamp: ts(),
        cdp: {
          command: method,
          duration: performance.now() - start,
          sessionId,
          success: true,
        },
      });
      return result;
    } catch (err) {
      logger.record({
        type: BrowserEventType.CdpCommandResult,
        timestamp: ts(),
        cdp: {
          command: method,
          duration: performance.now() - start,
          sessionId,
          success: false,
          error: (err as Error).message,
        },
      });
      throw err;
    }
  } as typeof session.send;

  const ignore = new Set(["Runtime.consoleAPICalled", "Log.entryAdded"]);
  session.on("event", (event: any) => {
    const { method, params } = event;
    if (ignore.has(method)) return;
    logger.record({
      type: BrowserEventType.CdpEvent,
      timestamp: ts(),
      cdp: { name: method, params },
    });
  });
}
