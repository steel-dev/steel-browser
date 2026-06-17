import type { Target, Protocol, TargetType, CDPSession } from "puppeteer-core";
import { BrowserEventType } from "../../../types/index.js";
import { BrowserLogger } from "./browser-logger.js";
import { extractTargetId, formatLocation, serializeRemoteObject } from "./utils.js";
import type { AttachPageEventsOptions } from "./page-events.js";

const MAX_BODY_SIZE = 1_048_576; // 1 MB
const TEXT_MIME_PREFIXES = ["text/", "application/json", "application/xml", "application/xhtml"];

function isTextMime(mime: string | undefined): boolean {
  if (!mime) return false;
  const lower = mime.toLowerCase();
  return TEXT_MIME_PREFIXES.some((p) => lower.startsWith(p));
}

export function attachWorkerEvents(
  target: Target,
  session: CDPSession,
  logger: BrowserLogger,
  targetType: TargetType,
  options?: AttachPageEventsOptions,
): void {
  const targetId = extractTargetId(target);
  const logBodies = options?.dangerouslyLogRequestDetails === true;

  const requestMeta = new Map<string, { url: string; mimeType?: string }>();

  session.on("Network.requestWillBeSent", (event: Protocol.Network.RequestWillBeSentEvent) => {
    requestMeta.set(event.requestId, { url: event.request.url });

    logger.record({
      type: BrowserEventType.Request,
      timestamp: new Date().toISOString(),
      pageId: targetId,
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
      pageId: targetId,
      targetType,
      response: responseData,
    });
  });

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
            pageId: targetId,
            targetType,
            responseBody: {
              requestId: event.requestId,
              body: result.body,
              base64Encoded: result.base64Encoded,
            },
          });
        }
      })
      .catch(() => {});
  });

  session.on("Network.loadingFailed", (event: Protocol.Network.LoadingFailedEvent) => {
    const url = requestMeta.get(event.requestId)?.url;
    requestMeta.delete(event.requestId);

    logger.record({
      type: BrowserEventType.RequestFailed,
      timestamp: new Date().toISOString(),
      pageId: targetId,
      targetType,
      error: { message: event.errorText, url },
    });
  });

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
