import type { CDPSession } from "puppeteer-core";
import { BrowserEventType } from "../../../types/index.js";
import { BrowserLogger } from "./browser-logger.js";
import type { ActionType, ElementContext } from "./types.js";

const CAPTURED_ATTRIBUTES = [
  "id",
  "class",
  "name",
  "type",
  "placeholder",
  "role",
  "aria-label",
  "data-testid",
  "href",
];

/** Timeout for element resolution to prevent blocking automation on heavy pages */
const ELEMENT_RESOLVE_TIMEOUT_MS = 50;

function classifyAction(method: string): ActionType | null {
  if (method === "Input.dispatchMouseEvent") return "mouse";
  if (method === "Input.dispatchKeyEvent") return "keyboard";
  if (method === "Page.navigate") return "navigate";
  return null;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// Shared JS snippet for extracting element info in page context.
// Uses innerText (limited to 200 chars) instead of textContent to avoid
// serializing entire DOM subtrees for elements like <body>.
const ELEMENT_EXTRACT_JS = `
  var tag = el.tagName.toLowerCase();
  if (tag === "html" || tag === "body") return null;
  var rect = el.getBoundingClientRect();
  var attrs = {};
  var names = ${JSON.stringify(CAPTURED_ATTRIBUTES)};
  for (var i = 0; i < names.length; i++) {
    var v = el.getAttribute(names[i]);
    if (v) attrs[names[i]] = v.length > 200 ? v.slice(0, 200) : v;
  }
  var text = (el.innerText || "").slice(0, 200).trim() || undefined;
  return {
    tagName: tag,
    text: text,
    attributes: Object.keys(attrs).length > 0 ? attrs : undefined,
    boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  };
`;

async function resolveElementAtPoint(
  send: CDPSession["send"],
  x: number,
  y: number,
): Promise<ElementContext | undefined> {
  try {
    const safeX = Number(x) || 0;
    const safeY = Number(y) || 0;
    const result: any = await withTimeout(
      send("Runtime.evaluate" as any, {
        expression: `(function(){
          var el = document.elementFromPoint(${safeX}, ${safeY});
          if (!el) return null;
          ${ELEMENT_EXTRACT_JS}
        })()`,
        returnByValue: true,
      }),
      ELEMENT_RESOLVE_TIMEOUT_MS,
    );
    return result?.result?.value || undefined;
  } catch {
    return undefined;
  }
}

async function resolveActiveElement(send: CDPSession["send"]): Promise<ElementContext | undefined> {
  try {
    const result: any = await withTimeout(
      send("Runtime.evaluate" as any, {
        expression: `(function(){
          var el = document.activeElement;
          if (!el || el === document.body || el === document.documentElement) return null;
          ${ELEMENT_EXTRACT_JS}
        })()`,
        returnByValue: true,
      }),
      ELEMENT_RESOLVE_TIMEOUT_MS,
    );
    return result?.result?.value || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Attaches protocol tracing to a CDP session.
 * Logs only protocol commands / notifications so you can diff automation flow between runs.
 */
export function attachCDPEvents(session: CDPSession, logger: BrowserLogger): void {
  const sessionId = session.id?.() ?? "unknown";
  const ts = () => new Date().toISOString();
  const originalSend = session.send.bind(session);
  type Method = Parameters<typeof session.send>[0];

  // Typing sequence optimization: resolve active element only on the first
  // keyDown of a burst. mousePressed (can change focus) invalidates the cache;
  // other commands like mouseMoved do NOT, to avoid wasteful re-resolution.
  let lastKeyDownTime = 0;
  let cachedActiveElement: ElementContext | undefined;
  const KEY_SEQUENCE_GAP = 500;

  session.send = async function (method: Method, params?: object) {
    const start = performance.now();
    const actionType = classifyAction(method);
    const p = params as any;

    // Resolve element context BEFORE dispatching the command. Capture into a
    // local (never read from the shared cache after an await) so concurrent
    // send() invocations cannot clobber this call's element.
    let element: ElementContext | undefined;
    if (method === "Input.dispatchMouseEvent" && p?.type === "mousePressed") {
      element = await resolveElementAtPoint(originalSend, p.x, p.y);
      // A click may move focus, so the cached active element is no longer valid
      lastKeyDownTime = 0;
      cachedActiveElement = undefined;
    } else if (method === "Input.dispatchKeyEvent" && p?.type === "keyDown") {
      const now = Date.now();
      if (now - lastKeyDownTime > KEY_SEQUENCE_GAP) {
        const resolved = await resolveActiveElement(originalSend);
        cachedActiveElement = resolved;
        element = resolved;
      } else {
        element = cachedActiveElement;
      }
      lastKeyDownTime = now;
    }

    logger.record({
      type: BrowserEventType.CDPCommand,
      timestamp: ts(),
      actionType,
      element,
      cdp: { command: method, params, sessionId },
    });

    try {
      const result = await originalSend(method, params);
      logger.record({
        type: BrowserEventType.CDPCommandResult,
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
        type: BrowserEventType.CDPCommandResult,
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

  const ignore = new Set([
    "Runtime.consoleAPICalled",
    "Log.entryAdded",
    // Network events are handled by page-events.ts via typed Request/Response events.
    // Suppress here to avoid duplicate logging.
    "Network.requestWillBeSent",
    "Network.responseReceived",
    "Network.dataReceived",
    "Network.loadingFinished",
    "Network.loadingFailed",
    "Network.requestServedFromCache",
    "Network.requestWillBeSentExtraInfo",
    "Network.responseReceivedExtraInfo",
  ]);
  session.on("event", (event: any) => {
    const { method, params } = event;
    if (ignore.has(method)) return;

    const actionType: ActionType | null =
      method === "Page.frameNavigated" && params?.frame?.url && !params?.frame?.parentId
        ? "navigate"
        : null;

    logger.record({
      type: BrowserEventType.CDPEvent,
      timestamp: ts(),
      actionType,
      cdp: { name: method, params },
    });
  });
}
