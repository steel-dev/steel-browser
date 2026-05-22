import {
  BROWSER_INTERACTION_SOURCE,
  MAX_BROWSER_INTERACTION_TEXT_LENGTH,
} from "./browser-interaction-sanitize.js";

export interface BrowserInteractionLoggerOptions {
  bindingName: string;
  source: string;
  maxTextLength: number;
}

export function installBrowserInteractionLogger(options: BrowserInteractionLoggerOptions): void {
  const { bindingName, source, maxTextLength } = options;
  const steelWindow = window as unknown as Window & {
    __steelBrowserInteractionInstalled?: boolean;
    [key: string]: unknown;
  };

  if (steelWindow.__steelBrowserInteractionInstalled) return;
  Object.defineProperty(steelWindow, "__steelBrowserInteractionInstalled", {
    value: true,
    configurable: false,
    enumerable: false,
  });

  const compact = (value: unknown) => {
    if (typeof value !== "string") return undefined;
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) return undefined;
    return normalized.length > maxTextLength
      ? normalized.slice(0, maxTextLength - 3) + "..."
      : normalized;
  };

  const directText = (element: unknown) => {
    if (!(element instanceof Element)) return undefined;

    let value = "";
    for (const node of element.childNodes) {
      if (node.nodeType !== Node.TEXT_NODE) continue;
      const text = node.textContent || "";
      if (!/\S/.test(text)) continue;

      const remaining = maxTextLength - value.length;
      if (remaining <= 0) break;

      value += " " + text.slice(0, remaining);
    }

    return compact(value);
  };

  const attr = (element: unknown, name: string) => {
    if (!(element instanceof Element)) return undefined;
    return compact(element.getAttribute(name) || undefined);
  };

  const cssEscape = (value: string) => {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  };

  const testAttributeNames = ["data-testid", "data-test", "data-cy"];

  const testAttribute = (element: Element) => {
    for (const name of testAttributeNames) {
      const value = attr(element, name);
      if (value) return { name, value };
    }
    return undefined;
  };

  const testAttributeSelector = (testAttr: { name: string; value: string }) =>
    "[" + testAttr.name + '="' + cssEscape(testAttr.value) + '"]';

  const implicitRole = (element: Element) => {
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

  const associatedLabel = (element: Element) => {
    if (element instanceof HTMLInputElement && element.labels && element.labels.length > 0) {
      return compact(
        Array.from(element.labels)
          .map((label) => label.textContent || "")
          .join(" "),
      );
    }
    const id = (element as HTMLElement).id;
    if (!id) return undefined;
    try {
      const label = document.querySelector('label[for="' + cssEscape(id) + '"]');
      return compact(label?.textContent || undefined);
    } catch {
      return undefined;
    }
  };

  const labelledByText = (element: Element) => {
    const ids = attr(element, "aria-labelledby");
    if (!ids) return undefined;
    return compact(
      ids
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" "),
    );
  };

  const isEditableElement = (element: Element) =>
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    (element instanceof HTMLElement &&
      (element.isContentEditable || element.hasAttribute("contenteditable")));

  const accessibleName = (element: Element) =>
    attr(element, "aria-label") ||
    labelledByText(element) ||
    associatedLabel(element) ||
    attr(element, "alt") ||
    attr(element, "title") ||
    attr(element, "placeholder") ||
    (isEditableElement(element) ? undefined : directText(element));

  const isMeaningfulElement = (element: unknown) => {
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

  const meaningfulElementFromPath = (event: Event) => {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const item of path) {
      if (isMeaningfulElement(item)) return item as Element;
    }
    return event.target instanceof Element ? event.target : undefined;
  };

  const cssPath = (element: Element) => {
    const parts: string[] = [];
    let current: Element | null = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
      const tagName = current.tagName.toLowerCase();
      const id = current.getAttribute("id");
      if (id) {
        parts.unshift(tagName + "#" + cssEscape(id));
        break;
      }
      let part = tagName;
      const testAttr = testAttribute(current);
      if (testAttr) {
        part += testAttributeSelector(testAttr);
      } else {
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(
            (child) => child.tagName === current?.tagName,
          );
          if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")";
        }
      }
      parts.unshift(part);
      current = current.parentElement;
    }
    return compact(parts.join(" > "));
  };

  const selectorCandidates = (element: Element) => {
    const id = attr(element, "id");
    const testAttr = testAttribute(element);
    const name = attr(element, "name");
    const ariaLabel = attr(element, "aria-label");
    return {
      id: id ? "#" + cssEscape(id) : undefined,
      testId: testAttr ? testAttributeSelector(testAttr) : undefined,
      name: name ? '[name="' + cssEscape(name) + '"]' : undefined,
      aria: ariaLabel ? '[aria-label="' + cssEscape(ariaLabel) + '"]' : undefined,
      css: cssPath(element),
    };
  };

  const targetSnapshot = (event: Event) => {
    const element = meaningfulElementFromPath(event);
    if (!(element instanceof Element)) return undefined;
    const rect = element.getBoundingClientRect();
    const testId =
      attr(element, "data-testid") || attr(element, "data-test") || attr(element, "data-cy");
    return {
      tagName: compact(element.tagName.toLowerCase()),
      role: attr(element, "role") || implicitRole(element),
      accessibleName: accessibleName(element),
      text: isEditableElement(element) ? undefined : directText(element),
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

  const sensitiveKeywords = [
    "password",
    "passwd",
    "pwd",
    "secret",
    "card",
    "cardnumber",
    "cc-number",
    "cc-csc",
    "cc-exp",
    "cvv",
    "cvc",
    "ssn",
    "social",
    "otp",
    "tax",
  ];

  const isSensitiveField = (target: unknown) => {
    if (!(target instanceof Element)) return false;
    if (target instanceof HTMLInputElement) {
      const type = (target.type || "").toLowerCase();
      if (type === "password") return true;
      const autocomplete = (target.getAttribute("autocomplete") || "").toLowerCase();
      if (autocomplete.startsWith("cc-")) return true;
      if (autocomplete === "current-password" || autocomplete === "new-password") return true;
      if (autocomplete === "one-time-code") return true;
    }
    const haystacks = [
      target.getAttribute("name") || "",
      (target as HTMLElement).id || "",
      target.getAttribute("aria-label") || "",
      target.getAttribute("placeholder") || "",
      ...testAttributeNames.map((name) => target.getAttribute(name) || ""),
    ].map((s) => s.toLowerCase());
    return haystacks.some((s) => sensitiveKeywords.some((kw) => s.includes(kw)));
  };

  const valueSnapshot = (event: Event) => {
    const target = event.target;
    if (
      !(
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      )
    ) {
      return undefined;
    }
    const inputType =
      target instanceof HTMLInputElement ? target.type : target.tagName.toLowerCase();
    const rawValue = typeof target.value === "string" ? target.value : undefined;
    const valueLength = typeof rawValue === "string" ? rawValue.length : undefined;
    const sensitive = isSensitiveField(target);
    return {
      inputType,
      valueLength,
      text: undefined,
      redacted: sensitive || undefined,
      checked:
        target instanceof HTMLInputElement && ["checkbox", "radio"].includes(target.type)
          ? target.checked
          : undefined,
    };
  };

  const emitPayload = (payload: object) => {
    const binding = steelWindow[bindingName];
    if (typeof binding !== "function") return;
    try {
      binding(JSON.stringify(payload));
    } catch {
      // Logging must never affect the page.
    }
  };

  const send = (event: Event, interaction: Record<string, unknown>) => {
    emitPayload({
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
    });
  };

  // Drag detection. mousedown->mouseup with duration > 500ms (sync with
  // apps/live/src/viewer/input/input-interactions.ts dragHoldThresholdMs) or
  // movement > 8px is treated as a drag; otherwise the browser's own click
  // event fires the normal click/doubleClick path.
  const dragHoldThresholdMs = 500;
  const dragMoveThresholdPx = 8;
  let dragState: {
    startX: number;
    startY: number;
    startTime: number;
    startTargetSnapshot?: ReturnType<typeof targetSnapshot>;
    button: number;
  } | null = null;
  let suppressClickUntil = 0;

  document.addEventListener(
    "mousedown",
    (event) => {
      const mouseEvent = event as MouseEvent;
      dragState = {
        startX: mouseEvent.clientX,
        startY: mouseEvent.clientY,
        startTime: Date.now(),
        startTargetSnapshot: targetSnapshot(mouseEvent),
        button: mouseEvent.button,
      };
    },
    { capture: true, passive: true },
  );

  document.addEventListener(
    "mouseup",
    (event) => {
      const mouseEvent = event as MouseEvent;
      const current = dragState;
      dragState = null;
      if (!current || current.button !== mouseEvent.button) return;

      const dx = mouseEvent.clientX - current.startX;
      const dy = mouseEvent.clientY - current.startY;
      const distance = Math.hypot(dx, dy);
      const endTime = Date.now();
      const duration = endTime - current.startTime;

      if (distance <= dragMoveThresholdPx && duration <= dragHoldThresholdMs) return;

      suppressClickUntil = endTime + 50;
      emitPayload({
        source,
        timestamp: new Date(current.startTime).toISOString(),
        interaction: {
          action: "drag",
          eventType: "drag",
          target: current.startTargetSnapshot,
          endTarget: targetSnapshot(mouseEvent),
          endTimestamp: new Date(endTime).toISOString(),
          pointer: {
            startX: current.startX,
            startY: current.startY,
            endX: mouseEvent.clientX,
            endY: mouseEvent.clientY,
            button: mouseEvent.button,
          },
          page: { url: location.href, title: document.title },
        },
      });
    },
    { capture: true, passive: true },
  );

  document.addEventListener(
    "click",
    (event) => {
      const mouseEvent = event as MouseEvent;
      if (Date.now() < suppressClickUntil) return;
      send(mouseEvent, {
        action: mouseEvent.detail > 1 ? "doubleClick" : "click",
        eventType: mouseEvent.type,
        pointer: {
          x: mouseEvent.clientX,
          y: mouseEvent.clientY,
          button: mouseEvent.button,
          clickCount: mouseEvent.detail,
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
      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.repeat) return;
      if (modifierKeys.has(keyboardEvent.key)) return;

      const target = keyboardEvent.target;
      const isPrintable = typeof keyboardEvent.key === "string" && keyboardEvent.key.length === 1;
      const hasModifier = keyboardEvent.ctrlKey || keyboardEvent.metaKey || keyboardEvent.altKey;
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      if (isPrintable && !hasModifier && isEditable) return;

      send(keyboardEvent, {
        action: "keyPress",
        eventType: keyboardEvent.type,
        keyboard: {
          key: keyboardEvent.key,
          code: keyboardEvent.code,
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
  // capture: false -> only main-page scroll (scroll does not bubble on elements).
  let scrollTimer: ReturnType<typeof setTimeout> | null = null;
  const scrollDebounceMs = 200;

  document.addEventListener(
    "scroll",
    () => {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        scrollTimer = null;
        emitPayload({
          source,
          timestamp: new Date().toISOString(),
          interaction: {
            action: "scroll",
            eventType: "scroll",
            pointer: { x: window.scrollX, y: window.scrollY },
            page: { url: location.href, title: document.title },
          },
        });
      }, scrollDebounceMs);
    },
    { capture: false, passive: true },
  );
}

export function createBrowserInteractionScript(bindingName: string): string {
  return `(() => { const __name = (fn) => fn; (${installBrowserInteractionLogger.toString()})(${JSON.stringify(
    {
      bindingName,
      source: BROWSER_INTERACTION_SOURCE,
      maxTextLength: MAX_BROWSER_INTERACTION_TEXT_LENGTH,
    },
  )}); })();`;
}
