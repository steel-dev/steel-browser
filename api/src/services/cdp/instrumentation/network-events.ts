import type { CDPSession, Protocol, TargetType } from "puppeteer-core";
import { BrowserEventType } from "../../../types/index.js";
import { BrowserLogger } from "./browser-logger.js";

export interface AttachNetworkEventsOptions {
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
 * Network request logging via CDP Network domain.
 * The caller must enable Network on the target session before attaching this.
 */
export function attachNetworkEvents(
  session: CDPSession,
  logger: BrowserLogger,
  pageId: string,
  targetType: TargetType,
  options?: AttachNetworkEventsOptions,
): void {
  const logBodies = options?.dangerouslyLogRequestDetails === true;

  // Track request metadata by requestId for use in loadingFailed (url) and loadingFinished (mimeType)
  const requestMeta = new Map<string, { url: string; mimeType?: string }>();

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
}
