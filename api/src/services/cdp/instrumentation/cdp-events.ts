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

function classifyAction(method: string): ActionType | null {
  if (method === "Input.dispatchMouseEvent") return "mouse";
  if (method === "Input.dispatchKeyEvent") return "keyboard";
  if (method === "Page.navigate") return "navigate";
  return null;
}

async function resolveElementAtPoint(
  send: CDPSession["send"],
  x: number,
  y: number,
): Promise<ElementContext | undefined> {
  try {
    const attrList = JSON.stringify(CAPTURED_ATTRIBUTES);
    const result: any = await send("Runtime.evaluate" as any, {
      expression: `(function(){
        var el = document.elementFromPoint(${x}, ${y});
        if (!el) return null;
        var rect = el.getBoundingClientRect();
        var attrs = {};
        var names = ${attrList};
        for (var i = 0; i < names.length; i++) {
          var v = el.getAttribute(names[i]);
          if (v) attrs[names[i]] = v;
        }
        return {
          tagName: el.tagName.toLowerCase(),
          text: (el.textContent || "").trim().slice(0, 200) || undefined,
          attributes: Object.keys(attrs).length > 0 ? attrs : undefined,
          boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        };
      })()`,
      returnByValue: true,
    });
    return result?.result?.value || undefined;
  } catch {
    return undefined;
  }
}

async function resolveActiveElement(send: CDPSession["send"]): Promise<ElementContext | undefined> {
  try {
    const attrList = JSON.stringify(CAPTURED_ATTRIBUTES);
    const result: any = await send("Runtime.evaluate" as any, {
      expression: `(function(){
        var el = document.activeElement;
        if (!el || el === document.body || el === document.documentElement) return null;
        var rect = el.getBoundingClientRect();
        var attrs = {};
        var names = ${attrList};
        for (var i = 0; i < names.length; i++) {
          var v = el.getAttribute(names[i]);
          if (v) attrs[names[i]] = v;
        }
        return {
          tagName: el.tagName.toLowerCase(),
          text: (el.textContent || "").trim().slice(0, 200) || undefined,
          attributes: Object.keys(attrs).length > 0 ? attrs : undefined,
          boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        };
      })()`,
      returnByValue: true,
    });
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

  // Typing sequence optimization: only resolve active element on first keyDown
  let lastKeyDownTime = 0;
  let cachedActiveElement: ElementContext | undefined;
  const KEY_SEQUENCE_GAP = 500;

  session.send = async function (method: Method, params?: object) {
    const start = performance.now();
    const actionType = classifyAction(method);
    const p = params as any;

    // Resolve element context BEFORE dispatching the command
    let element: ElementContext | undefined;
    if (method === "Input.dispatchMouseEvent" && p?.type === "mousePressed") {
      element = await resolveElementAtPoint(originalSend, p.x, p.y);
      // Reset key sequence state on non-key action
      lastKeyDownTime = 0;
      cachedActiveElement = undefined;
    } else if (method === "Input.dispatchKeyEvent" && p?.type === "keyDown") {
      const now = Date.now();
      if (now - lastKeyDownTime > KEY_SEQUENCE_GAP) {
        cachedActiveElement = await resolveActiveElement(originalSend);
      }
      lastKeyDownTime = now;
      element = cachedActiveElement;
    } else if (method !== "Input.dispatchKeyEvent") {
      // Any non-key command breaks the key sequence
      lastKeyDownTime = 0;
      cachedActiveElement = undefined;
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
