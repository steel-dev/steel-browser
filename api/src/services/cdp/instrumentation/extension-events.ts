import { Protocol, Target, TargetType } from "puppeteer-core";
import type { BrowserLogger } from "./browser-logger.js";
import { ExtensionEvent } from "./types.js";
import { BrowserEventType } from "../../../types/enums.js";
import { formatLocation, serializeRemoteObject } from "./utils.js";
import type { FastifyBaseLogger } from "fastify";

export async function attachExtensionEvents(
  target: Target,
  logger: BrowserLogger,
  internalExtensions: Set<string>,
  appLogger: FastifyBaseLogger,
): Promise<void> {
  const url = target.url();
  if (!url.startsWith("chrome-extension://")) return;

  const extensionId = url.split("/")[2];
  const isInternal = internalExtensions.has(extensionId);
  const serviceWorkerId = (target as any)._targetId as string;
  const targetType = target.type() as TargetType;

  const session = await target.createCDPSession();

  const emitExtensionEvent = (
    partial: Pick<ExtensionEvent, "logLevel" | "message" | "type" | "loc" | "executionContextId">,
  ) => {
    const event: ExtensionEvent = {
      type: partial.type,
      logLevel: partial.logLevel,
      message: partial.message,
      extensionId,
      serviceWorkerId,
      timestamp: new Date().toISOString(),
      targetType,
      loc: partial.loc,
      executionContextId: partial.executionContextId,
    };

    if (isInternal) {
      const prefix = `[INTERNAL EXT ${extensionId}] ${event.type}`;
      const locSuffix = event.loc ? ` (${event.loc})` : "";
      appLogger.info(`${prefix} (${event.logLevel}) ${event.message + locSuffix}`);
      return;
    }

    logger.record(event);
  };

  session.on("Runtime.consoleAPICalled", (ev: Protocol.Runtime.ConsoleAPICalledEvent) => {
    const text = ev.args.map(serializeRemoteObject).join(" ");
    const loc = formatLocation(ev.stackTrace);

    emitExtensionEvent({
      type: BrowserEventType.Console,
      logLevel: ev.type === "error" ? "error" : ev.type === "warning" ? "warn" : "log",
      message: text,
      loc,
      executionContextId: ev.executionContextId,
    });
  });

  session.on("Runtime.exceptionThrown", (ev: Protocol.Runtime.ExceptionThrownEvent) => {
    const desc = ev.exceptionDetails.exception?.description ?? ev.exceptionDetails.text;
    emitExtensionEvent({
      type: BrowserEventType.PageError,
      logLevel: "error",
      message: desc,
      loc: ev.exceptionDetails.url
        ? `${ev.exceptionDetails.url}:${ev.exceptionDetails.lineNumber}:${ev.exceptionDetails.columnNumber}`
        : undefined,
      executionContextId: ev.exceptionDetails.executionContextId,
    });
  });

  session.on("Network.loadingFailed", (ev: Protocol.Network.LoadingFailedEvent) => {
    emitExtensionEvent({
      type: BrowserEventType.RequestFailed,
      logLevel: "error",
      message: ev.errorText,
    });
  });
}
