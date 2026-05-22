import type { CDPSession, Page, TargetType } from "puppeteer-core";
import { BrowserEventType } from "../../../types/index.js";
import type { BrowserLogger } from "./browser-logger.js";
import { createBrowserInteractionScript } from "./browser-interaction-script.js";
import {
  BROWSER_INTERACTION_SOURCE,
  sanitizeInteractionPayload,
  toRecord,
} from "./browser-interaction-sanitize.js";

export const BROWSER_INTERACTION_BINDING = "__steelBrowserInteractionLog";
export const BROWSER_INTERACTION_WORLD = "__steel_browser_interactions__";

export async function attachBrowserInteractionEvents(
  session: CDPSession,
  page: Page,
  logger: BrowserLogger,
  targetType: TargetType,
  pageId: string,
): Promise<void> {
  const emitNavigate = (url: string) => {
    logger.record({
      type: BrowserEventType.BrowserInteraction,
      timestamp: new Date().toISOString(),
      pageId,
      targetType,
      interaction: {
        action: "navigate",
        eventType: "framenavigated",
        navigation: { url },
        page: { url },
      },
    });
  };

  page.on("framenavigated", (frame) => {
    if (frame.parentFrame()) return;
    emitNavigate(frame.url());
  });

  emitNavigate(page.url());

  session.on("Runtime.bindingCalled", (event: any) => {
    if (event?.name !== BROWSER_INTERACTION_BINDING || typeof event.payload !== "string") return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(event.payload);
    } catch {
      return;
    }

    const payload = toRecord(parsed);
    if (payload?.source !== BROWSER_INTERACTION_SOURCE) return;

    const interaction = sanitizeInteractionPayload(payload);
    if (!interaction) return;

    logger.record({
      type: BrowserEventType.BrowserInteraction,
      timestamp:
        typeof payload.timestamp === "string" ? payload.timestamp : new Date().toISOString(),
      pageId,
      targetType,
      interaction,
    });
  });

  try {
    await session.send("Runtime.addBinding" as any, {
      name: BROWSER_INTERACTION_BINDING,
      executionContextName: BROWSER_INTERACTION_WORLD,
    });
  } catch {
    // Interaction logging is best-effort and should not block target instrumentation.
    return;
  }

  const source = createBrowserInteractionScript(BROWSER_INTERACTION_BINDING);
  try {
    await session.send("Page.addScriptToEvaluateOnNewDocument" as any, {
      source,
      worldName: BROWSER_INTERACTION_WORLD,
      runImmediately: true,
    });
  } catch {
    try {
      await session.send("Page.addScriptToEvaluateOnNewDocument" as any, {
        source,
        worldName: BROWSER_INTERACTION_WORLD,
      });
    } catch {
      // Older browsers may not support isolated-world script injection.
    }
  }
}
