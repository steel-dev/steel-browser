import type { Page, CDPSession, TargetType, Protocol } from "puppeteer-core";
import { BrowserEventType } from "../../../types/index.js";
import { BrowserLogger } from "./browser-logger.js";
import { formatLocation, serializeRemoteObject } from "./utils.js";

export interface AttachPageEventsOptions {
  dangerouslyLogRequestDetails?: boolean;
}

const MAX_BODY_SIZE = 1_048_576; // 1 MB
const TEXT_MIME_PREFIXES = ["text/", "application/json", "application/xml", "application/xhtml"];

function isTextMime(mime: string | undefined): boolean {
  if (!mime) return false;
  const lower = mime.toLowerCase();
  return TEXT_MIME_PREFIXES.some((p) => lower.startsWith(p));
}

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
  const logBodies = options?.dangerouslyLogRequestDetails === true;

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

  // Track request metadata by requestId for use in loadingFailed (url) and loadingFinished (mimeType)
  const requestMeta = new Map<string, { url: string; mimeType?: string }>();

  // Network request logging via CDP Network domain.
  // This fires for ALL requests including form POST navigations, unlike
  // Puppeteer's page.on("request") which depends on Fetch interception
  // and can miss requests during same-tab navigations.
  session.on("Network.requestWillBeSent", (event: Protocol.Network.RequestWillBeSentEvent) => {
    requestMeta.set(event.requestId, { url: event.request.url });

    logger.record({
      type: BrowserEventType.Request,
      timestamp: new Date().toISOString(),
      pageId,
      targetType,
      request: {
        method: event.request.method,
        url: event.request.url,
        resourceType: event.type,
        ...(logBodies && event.request.postData ? { postData: event.request.postData } : {}),
        ...(logBodies && event.request.headers
          ? { headers: event.request.headers as Record<string, string> }
          : {}),
      },
    });
  });

  session.on("Network.responseReceived", (event: Protocol.Network.ResponseReceivedEvent) => {
    const meta = requestMeta.get(event.requestId);
    if (meta) {
      meta.mimeType = event.response.mimeType;
    }

    const responseData: {
      status: number;
      url: string;
      mimeType?: string;
      headers?: Record<string, string>;
    } = {
      status: event.response.status,
      url: event.response.url,
      mimeType: event.response.mimeType,
    };

    if (logBodies && event.response.headers) {
      responseData.headers = event.response.headers as Record<string, string>;
    }

    logger.record({
      type: BrowserEventType.Response,
      timestamp: new Date().toISOString(),
      pageId,
      targetType,
      response: responseData,
    });
  });

  // Always listen for loadingFinished to clean up requestMeta entries.
  // When dangerouslyLogRequestDetails is enabled, also capture response bodies
  // (size-capped, text-only MIME types).
  session.on("Network.loadingFinished", (event: Protocol.Network.LoadingFinishedEvent) => {
    const meta = requestMeta.get(event.requestId);
    requestMeta.delete(event.requestId);

    if (!logBodies) return;
    if (event.encodedDataLength > MAX_BODY_SIZE) return;
    if (!isTextMime(meta?.mimeType)) return;

    session
      .send("Network.getResponseBody", { requestId: event.requestId })
      .then((result) => {
        if (result?.body) {
          logger.record({
            type: BrowserEventType.ResponseBody,
            timestamp: new Date().toISOString(),
            pageId,
            targetType,
            responseBody: {
              requestId: event.requestId,
              body: result.body,
              base64Encoded: result.base64Encoded,
            },
          });
        }
      })
      .catch(() => {
        // Response body not available (redirects, evicted, etc.) — ignore
      });
  });

  session.on("Network.loadingFailed", (event: Protocol.Network.LoadingFailedEvent) => {
    const url = requestMeta.get(event.requestId)?.url;
    requestMeta.delete(event.requestId);

    logger.record({
      type: BrowserEventType.RequestFailed,
      timestamp: new Date().toISOString(),
      pageId,
      targetType,
      error: { message: event.errorText, url },
    });
  });

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
