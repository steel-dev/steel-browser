import type { Page } from "puppeteer-core";
import { IN_SECRET, SECRET_FIELD, SECRET_MASK } from "./secrets.js";

export const MOUSE_HELPERS = "#__cursor__, puppeteer-mouse-pointer";

export const TEXT = `function () {
  if ((${IN_SECRET})(this)) {
    return ${JSON.stringify(SECRET_MASK)};
  }
  return typeof this.innerText === "string" ? this.innerText : this.textContent || "";
}`;

export const HTML = `function () {
  const secret = ${SECRET_FIELD};
  const mask = ${JSON.stringify(SECRET_MASK)};
  if (secret(this)) {
    return this instanceof HTMLTextAreaElement ? mask : "";
  }
  if ((${IN_SECRET})(this.parentElement)) {
    return mask;
  }
  const fields = Array.from(this.querySelectorAll("*"));
  const copy = this.cloneNode(true);
  const copies = Array.from(copy.querySelectorAll("*"));
  fields.forEach((field, index) => {
    if (!secret(field)) {
      return;
    }
    if (!(copies[index] instanceof HTMLInputElement)) {
      copies[index].textContent = mask;
    } else if (copies[index].hasAttribute("value")) {
      copies[index].setAttribute("value", mask);
    }
  });
  for (const helper of copy.querySelectorAll(${JSON.stringify(MOUSE_HELPERS)})) {
    helper.remove();
  }
  return copy.innerHTML;
}`;

export const VALUE = `function () {
  if ((${SECRET_FIELD})(this)) {
    return { masked: true };
  }
  return { value: "value" in this ? String(this.value == null ? "" : this.value) : null };
}`;

export const ATTRIBUTE = `function (name) {
  if (name.toLowerCase() === "value" && (${SECRET_FIELD})(this)) {
    return { masked: true };
  }
  return { value: this.getAttribute(name) };
}`;

export const VISIBLE = `function () {
  const box = this.getBoundingClientRect();
  return (
    box.width > 0 &&
    box.height > 0 &&
    this.checkVisibility({ opacityProperty: true, visibilityProperty: true })
  );
}`;

export const ENABLED = `function () {
  return !(this.matches && this.matches(":disabled")) && this.getAttribute("aria-disabled") !== "true";
}`;

export const PAGE_TEXT = `function (text) {
  if (!document.body) {
    return false;
  }
  if ((document.body.innerText || "").includes(text)) {
    return true;
  }
  const visit = (root) => {
    for (const element of root.querySelectorAll("*")) {
      const shadow = element.shadowRoot;
      if (!shadow) {
        continue;
      }
      for (const node of shadow.childNodes) {
        const shown = node.nodeType === Node.TEXT_NODE ? node.textContent : node.innerText;
        if ((shown || "").includes(text)) {
          return true;
        }
      }
      if (visit(shadow)) {
        return true;
      }
    }
    return false;
  };
  return visit(document.body);
}`;

export const READY_STATE = `function () {
  return document.readyState;
}`;

export function urlMatches(pattern: string, url: string): boolean {
  if (!pattern.includes("*")) {
    return url.includes(pattern);
  }
  const parts = pattern.split(/\*+/);
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (!url.startsWith(first)) {
    return false;
  }
  let at = first.length;
  for (const part of parts.slice(1, -1)) {
    const found = url.indexOf(part, at);
    if (found < 0) {
      return false;
    }
    at = found + part.length;
  }
  return url.length - at >= last.length && url.endsWith(last);
}

export async function networkIdle(
  page: Page,
  quietMs: number,
  timeoutMs: number,
  stopped: () => boolean,
): Promise<boolean> {
  const controller = new AbortController();
  const timer = setInterval(() => {
    if (stopped()) {
      controller.abort();
    }
  }, 100);
  try {
    await page.waitForNetworkIdle({
      idleTime: quietMs,
      timeout: Math.max(timeoutMs, 1),
      signal: controller.signal,
    });
    return true;
  } catch (error) {
    if (controller.signal.aborted || (error as Error).name === "TimeoutError") {
      return false;
    }
    throw error;
  } finally {
    clearInterval(timer);
  }
}
