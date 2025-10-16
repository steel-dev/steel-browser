import type { Target, Protocol, TargetType } from "puppeteer-core";
import { BrowserEventType } from "../../../types/index.js";
import { BrowserLogger } from "./browser-logger.js";
import { extractTargetId, formatLocation, serializeRemoteObject } from "./utils.js";

export async function attachWorkerEvents(
  target: Target,
  logger: BrowserLogger,
  targetType: TargetType,
): Promise<void> {
  const targetId = extractTargetId(target);
  const session = await target.createCDPSession();

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
