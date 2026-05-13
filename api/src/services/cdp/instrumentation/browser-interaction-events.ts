import type { CDPSession, Page, TargetType } from "puppeteer-core";
import { BrowserEventType } from "../../../types/index.js";
import type { BrowserLogger } from "./browser-logger.js";
import type { BrowserInteractionEvent } from "./types.js";

export const BROWSER_INTERACTION_BINDING = "__steelBrowserInteractionLog";
export const BROWSER_INTERACTION_WORLD = "__steel_browser_interactions__";

const MAX_TEXT_LENGTH = 256;
const ALLOWED_ACTIONS = new Set([
  "click",
  "doubleClick",
  "keyPress",
  "input",
  "change",
  "submit",
  "scroll",
]);

function truncate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.length > MAX_TEXT_LENGTH
    ? `${normalized.slice(0, MAX_TEXT_LENGTH - 1)}...`
    : normalized;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return truncate(value);
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function sanitizeTarget(value: unknown): BrowserInteractionEvent["interaction"]["target"] {
  const target = toRecord(value);
  if (!target) return undefined;

  const attributes = toRecord(target.attributes);
  const selector = toRecord(target.selector);
  const boundingBox = toRecord(target.boundingBox);

  const x = optionalNumber(boundingBox?.x);
  const y = optionalNumber(boundingBox?.y);
  const width = optionalNumber(boundingBox?.width);
  const height = optionalNumber(boundingBox?.height);

  return {
    tagName: optionalString(target.tagName),
    role: optionalString(target.role),
    accessibleName: optionalString(target.accessibleName),
    text: optionalString(target.text),
    attributes: attributes
      ? {
          id: optionalString(attributes.id),
          name: optionalString(attributes.name),
          type: optionalString(attributes.type),
          href: optionalString(attributes.href),
          ariaLabel: optionalString(attributes.ariaLabel),
          placeholder: optionalString(attributes.placeholder),
          title: optionalString(attributes.title),
          testId: optionalString(attributes.testId),
        }
      : undefined,
    selector: selector
      ? {
          css: optionalString(selector.css),
          id: optionalString(selector.id),
          testId: optionalString(selector.testId),
          name: optionalString(selector.name),
          aria: optionalString(selector.aria),
        }
      : undefined,
    boundingBox:
      x !== undefined && y !== undefined && width !== undefined && height !== undefined
        ? { x, y, width, height }
        : undefined,
  };
}

function sanitizeInteractionPayload(
  payload: unknown,
): BrowserInteractionEvent["interaction"] | null {
  const parsed = toRecord(payload);
  const interaction = toRecord(parsed?.interaction);
  if (!interaction) return null;

  const action = interaction?.action;
  const eventType = interaction?.eventType;

  if (typeof action !== "string" || !ALLOWED_ACTIONS.has(action)) return null;
  if (typeof eventType !== "string") return null;

  const pointer = toRecord(interaction.pointer);
  const keyboard = toRecord(interaction.keyboard);
  const value = toRecord(interaction.value);
  const page = toRecord(interaction.page);

  const x = optionalNumber(pointer?.x);
  const y = optionalNumber(pointer?.y);

  return {
    action: action as BrowserInteractionEvent["interaction"]["action"],
    eventType,
    target: sanitizeTarget(interaction.target),
    pointer:
      x !== undefined && y !== undefined
        ? {
            x,
            y,
            button: optionalNumber(pointer?.button),
            clickCount: optionalNumber(pointer?.clickCount),
          }
        : undefined,
    keyboard: keyboard
      ? {
          key: optionalString(keyboard.key),
          code: optionalString(keyboard.code),
        }
      : undefined,
    value: value
      ? {
          inputType: optionalString(value.inputType),
          valueLength: optionalNumber(value.valueLength),
          checked: typeof value.checked === "boolean" ? value.checked : undefined,
        }
      : undefined,
    page: page
      ? {
          url: optionalString(page.url),
          title: optionalString(page.title),
        }
      : undefined,
  };
}

function createBrowserInteractionScript(bindingName: string): string {
  return `
(() => {
  const bindingName = ${JSON.stringify(bindingName)};
  const source = "steel-browser-interaction";
  const maxTextLength = ${MAX_TEXT_LENGTH};

  if (window.__steelBrowserInteractionInstalled) return;
  Object.defineProperty(window, "__steelBrowserInteractionInstalled", {
    value: true,
    configurable: false,
    enumerable: false,
  });

  const compact = (value) => {
    if (typeof value !== "string") return undefined;
    const normalized = value.replace(/\\s+/g, " ").trim();
    if (!normalized) return undefined;
    return normalized.length > maxTextLength
      ? normalized.slice(0, maxTextLength - 1) + "..."
      : normalized;
  };

  const directText = (element) => {
    if (!(element instanceof Element)) return undefined;

    let value = "";
    for (const node of element.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const text = node.textContent || "";
      if (!/\\S/.test(text)) continue;

      const remaining = maxTextLength - value.length;
      if (remaining <= 0) break;

      value += " " + text.slice(0, remaining);
    }

    return compact(value);
  };

  const attr = (element, name) => {
    if (!element || !element.getAttribute) return undefined;
    return compact(element.getAttribute(name) || undefined);
  };

  const cssEscape = (value) => {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\\\$&");
  };

  const implicitRole = (element) => {
    const tagName = element.tagName?.toLowerCase();
    if (tagName === "button") return "button";
    if (tagName === "a" && element.hasAttribute("href")) return "link";
    if (tagName === "input") {
      const type = (element.getAttribute("type") || "text").toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "button" || type === "submit" || type === "reset") return "button";
      return "textbox";
    }
    if (tagName === "textarea") return "textbox";
    if (tagName === "select") return "combobox";
    if (tagName === "summary") return "button";
    return undefined;
  };

  const associatedLabel = (element) => {
    if (!element) return undefined;
    if (element.labels && element.labels.length > 0) {
      return compact(Array.from(element.labels).map((label) => label.textContent || "").join(" "));
    }
    const id = element.id;
    if (!id) return undefined;
    try {
      const label = document.querySelector('label[for="' + cssEscape(id) + '"]');
      return compact(label?.textContent || undefined);
    } catch {
      return undefined;
    }
  };

  const labelledByText = (element) => {
    const ids = attr(element, "aria-labelledby");
    if (!ids) return undefined;
    return compact(
      ids
        .split(/\\s+/)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" "),
    );
  };

  const accessibleName = (element) =>
    attr(element, "aria-label") ||
    labelledByText(element) ||
    associatedLabel(element) ||
    attr(element, "alt") ||
    attr(element, "title") ||
    attr(element, "placeholder") ||
    directText(element);

  const isMeaningfulElement = (element) => {
    if (!(element instanceof Element)) return false;
    const tagName = element.tagName.toLowerCase();
    return (
      ["button", "a", "input", "textarea", "select", "summary", "label"].includes(tagName) ||
      element.hasAttribute("role") ||
      element.hasAttribute("aria-label") ||
      element.hasAttribute("data-testid") ||
      element.hasAttribute("data-test") ||
      element.hasAttribute("data-cy") ||
      element.hasAttribute("contenteditable")
    );
  };

  const meaningfulElementFromPath = (event) => {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const item of path) {
      if (isMeaningfulElement(item)) return item;
    }
    return event.target instanceof Element ? event.target : undefined;
  };

  const cssPath = (element) => {
    if (!(element instanceof Element)) return undefined;
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
      const tagName = current.tagName.toLowerCase();
      const id = current.getAttribute("id");
      if (id) {
        parts.unshift(tagName + "#" + cssEscape(id));
        break;
      }
      let part = tagName;
      const testId =
        current.getAttribute("data-testid") ||
        current.getAttribute("data-test") ||
        current.getAttribute("data-cy");
      if (testId) {
        part += '[data-testid="' + cssEscape(testId) + '"]';
      } else {
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
          if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")";
        }
      }
      parts.unshift(part);
      current = current.parentElement;
    }
    return compact(parts.join(" > "));
  };

  const selectorCandidates = (element) => {
    const id = attr(element, "id");
    const testId = attr(element, "data-testid") || attr(element, "data-test") || attr(element, "data-cy");
    const name = attr(element, "name");
    const ariaLabel = attr(element, "aria-label");
    return {
      id: id ? "#" + cssEscape(id) : undefined,
      testId: testId ? '[data-testid="' + cssEscape(testId) + '"]' : undefined,
      name: name ? '[name="' + cssEscape(name) + '"]' : undefined,
      aria: ariaLabel ? '[aria-label="' + cssEscape(ariaLabel) + '"]' : undefined,
      css: cssPath(element),
    };
  };

  const targetSnapshot = (event) => {
    const element = meaningfulElementFromPath(event);
    if (!(element instanceof Element)) return undefined;
    const rect = element.getBoundingClientRect();
    const testId = attr(element, "data-testid") || attr(element, "data-test") || attr(element, "data-cy");
    return {
      tagName: compact(element.tagName.toLowerCase()),
      role: attr(element, "role") || implicitRole(element),
      accessibleName: accessibleName(element),
      text: directText(element),
      attributes: {
        id: attr(element, "id"),
        name: attr(element, "name"),
        type: attr(element, "type"),
        href: attr(element, "href"),
        ariaLabel: attr(element, "aria-label"),
        placeholder: attr(element, "placeholder"),
        title: attr(element, "title"),
        testId,
      },
      selector: selectorCandidates(element),
      boundingBox: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
    };
  };

  const valueSnapshot = (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) {
      return undefined;
    }
    const inputType = target instanceof HTMLInputElement ? target.type : target.tagName.toLowerCase();
    return {
      inputType,
      valueLength: typeof target.value === "string" ? target.value.length : undefined,
      checked: target instanceof HTMLInputElement && ["checkbox", "radio"].includes(target.type) ? target.checked : undefined,
    };
  };

  const send = (event, interaction) => {
    const binding = window[bindingName];
    if (typeof binding !== "function") return;
    try {
      binding(
        JSON.stringify({
          source,
          timestamp: new Date().toISOString(),
          interaction: {
            ...interaction,
            target: targetSnapshot(event),
            page: {
              url: location.href,
              title: document.title,
            },
          },
        }),
      );
    } catch {
      // Logging must never affect the page.
    }
  };

  document.addEventListener(
    "click",
    (event) => {
      send(event, {
        action: event.detail > 1 ? "doubleClick" : "click",
        eventType: event.type,
        pointer: {
          x: event.clientX,
          y: event.clientY,
          button: event.button,
          clickCount: event.detail,
        },
      });
    },
    { capture: true, passive: true },
  );

  const modifierKeys = new Set([
    "Shift",
    "Control",
    "Alt",
    "Meta",
    "CapsLock",
    "NumLock",
    "ScrollLock",
  ]);

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.repeat) return;
      if (modifierKeys.has(event.key)) return;

      const target = event.target;
      const isPrintable = typeof event.key === "string" && event.key.length === 1;
      const hasModifier = event.ctrlKey || event.metaKey || event.altKey;
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      if (isPrintable && !hasModifier && isEditable) return;

      send(event, {
        action: "keyPress",
        eventType: event.type,
        keyboard: {
          key: event.key,
          code: event.code,
        },
      });
    },
    { capture: true, passive: true },
  );

  // Per-event emission. Sink-side collapse (logging.utils:collapseActivities)
  // merges consecutive input/change events on the same target into the latest
  // value, so source-level debouncing is unnecessary and only loses precision.
  document.addEventListener(
    "input",
    (event) => {
      send(event, {
        action: "input",
        eventType: "input",
        value: valueSnapshot(event),
      });
    },
    { capture: true, passive: true },
  );

  document.addEventListener(
    "change",
    (event) => {
      send(event, {
        action: "change",
        eventType: "change",
        value: valueSnapshot(event),
      });
    },
    { capture: true, passive: true },
  );

  document.addEventListener(
    "submit",
    (event) => {
      send(event, {
        action: "submit",
        eventType: event.type,
      });
    },
    { capture: true, passive: true },
  );

  // Scroll: throttle to one emission per gesture (trailing edge) since the sink
  // does not currently coalesce scrolls, and raw scroll events fire at frame rate.
  // capture: false → only main-page scroll (scroll does not bubble on elements).
  let scrollTimer = null;
  const scrollDebounceMs = 200;

  document.addEventListener(
    "scroll",
    () => {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        scrollTimer = null;
        const binding = window[bindingName];
        if (typeof binding !== "function") return;
        try {
          binding(
            JSON.stringify({
              source,
              timestamp: new Date().toISOString(),
              interaction: {
                action: "scroll",
                eventType: "scroll",
                pointer: { x: window.scrollX, y: window.scrollY },
                page: { url: location.href, title: document.title },
              },
            }),
          );
        } catch {
          // Logging must never affect the page.
        }
      }, scrollDebounceMs);
    },
    { capture: false, passive: true },
  );
})();
`;
}

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
    if (payload?.source !== "steel-browser-interaction") return;

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
