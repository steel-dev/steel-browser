import type { Target, Protocol, TargetType, CDPSession } from "puppeteer-core";
import { BrowserEventType } from "../../../types/index.js";
import { BrowserLogger } from "./browser-logger.js";
import { attachNetworkEvents } from "./network-events.js";
import type { AttachNetworkEventsOptions } from "./network-events.js";
import { extractTargetId, formatLocation, serializeRemoteObject } from "./utils.js";

export interface AttachWorkerEventsOptions extends AttachNetworkEventsOptions {
  captureNetwork?: boolean;
}

export function attachWorkerEvents(
  target: Target,
  session: CDPSession,
  logger: BrowserLogger,
  targetType: TargetType,
  options?: AttachWorkerEventsOptions,
): void {
  const targetId = extractTargetId(target);

  if (options?.captureNetwork === true) {
    attachNetworkEvents(session, logger, targetId, targetType, options);
  }

  session.on("Runtime.consoleAPICalled", (event: Protocol.Runtime.ConsoleAPICalledEvent) => {
    const text = event.args.map(serializeRemoteObject).join(" ");
    const loc = formatLocation(event.stackTrace);

    logger.record({
      type: BrowserEventType.Console,
      timestamp: new Date().toISOString(),
      pageId: targetId,
      targetType,
      console: { level: event.type, text, loc },
    });
  });

  session.on("Runtime.exceptionThrown", (event: Protocol.Runtime.ExceptionThrownEvent) => {
    const desc = event.exceptionDetails.exception?.description ?? event.exceptionDetails.text;
    logger.record({
      type: BrowserEventType.PageError,
      timestamp: new Date().toISOString(),
      pageId: targetId,
      targetType,
      error: { message: desc },
    });
  });
}
