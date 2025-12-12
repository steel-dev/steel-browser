import type { Page, TargetType, Protocol } from "puppeteer-core";
import { BrowserEventType } from "../../../types/index.js";
import { BrowserLogger } from "./browser-logger.js";
import { formatLocation, serializeRemoteObject } from "./utils.js";

export async function attachPageEvents(
  page: Page,
  logger: BrowserLogger,
  targetType: TargetType,
): Promise<void> {
  const pageId = (page.target() as any)._targetId as string;

  // network requests
  page.on("request", (req) => {
    logger.record({
      type: BrowserEventType.Request,
      timestamp: new Date().toISOString(),
      pageId,
      targetType,
      request: { method: req.method(), url: req.url() },
    });
  });

  page.on("response", (res) => {
    logger.record({
      type: BrowserEventType.Response,
      timestamp: new Date().toISOString(),
      pageId,
      targetType,
      response: { status: res.status(), url: res.url() },
    });
  });

  page.on("requestfailed", (req) => {
    const failure = req.failure();
    logger.record({
      type: BrowserEventType.RequestFailed,
      timestamp: new Date().toISOString(),
      pageId,
      targetType,
      error: { message: failure?.errorText ?? "unknown", url: req.url() },
    });
  });

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

  const session = await page.createCDPSession();

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
