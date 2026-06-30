import type { Page, CDPSession, TargetType, Protocol } from "puppeteer-core";
import { BrowserEventType } from "../../../types/index.js";
import { BrowserLogger } from "./browser-logger.js";
import { attachNetworkEvents } from "./network-events.js";
import type { AttachNetworkEventsOptions } from "./network-events.js";
import { formatLocation, serializeRemoteObject } from "./utils.js";

export interface AttachPageEventsOptions extends AttachNetworkEventsOptions {}

/**
 * Attach page-level event listeners. The caller must pass an already-enabled
 * CDP session (with Network, Runtime, Log domains enabled) so that all
 * listeners share a single session per target.
 */
export async function attachPageEvents(
  page: Page,
  session: CDPSession,
  logger: BrowserLogger,
  targetType: TargetType,
  options?: AttachPageEventsOptions,
): Promise<void> {
  const pageId = (page.target() as any)._targetId as string;

  // navigation
  page.on("framenavigated", (frame) => {
    if (frame.parentFrame()) return;
    logger.record({
      type: BrowserEventType.Navigation,
      timestamp: new Date().toISOString(),
      pageId,
      targetType,
      navigation: { url: frame.url() },
    });
  });

  // initial page
  logger.record({
    type: BrowserEventType.Navigation,
    timestamp: new Date().toISOString(),
    pageId,
    targetType,
    navigation: { url: page.url() },
  });

  // This fires for ALL page-target requests including form POST navigations,
  // unlike Puppeteer's page.on("request") which depends on Fetch interception.
  attachNetworkEvents(session, logger, pageId, targetType, options);

  session.on("Runtime.consoleAPICalled", (event: Protocol.Runtime.ConsoleAPICalledEvent) => {
    const text = event.args.map(serializeRemoteObject).join(" ");
    const loc = formatLocation(event.stackTrace);
    const prefix = targetType === "background_page" ? "[BG] " : "";

    logger.record({
      type: BrowserEventType.Console,
      timestamp: new Date().toISOString(),
      pageId,
      targetType,
      console: { level: event.type, text: prefix + text, loc },
    });
  });

  session.on("Runtime.exceptionThrown", (event: Protocol.Runtime.ExceptionThrownEvent) => {
    const desc = event.exceptionDetails.exception?.description ?? event.exceptionDetails.text;
    logger.record({
      type: BrowserEventType.PageError,
      timestamp: new Date().toISOString(),
      pageId,
      targetType,
      error: { message: desc },
    });
  });

  page.on("error", (err) => {
    logger.record({
      type: BrowserEventType.Error,
      timestamp: new Date().toISOString(),
      pageId,
      targetType,
      error: { message: err?.message, stack: err?.stack },
    });
  });

  page.on("pageerror", (err) => {
    logger.record({
      type: BrowserEventType.PageError,
      timestamp: new Date().toISOString(),
      pageId,
      targetType,
      error: { message: err?.message, stack: err?.stack },
    });
  });
}
