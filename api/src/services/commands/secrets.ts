import type { CDPSession } from "puppeteer-core";

export const SECRET_MASK = "••••••••";

const SPREAD_SECRET_LENGTH = 4;

const SECRET_CHARS = 100_000;

const CODES = 65_536;

export const SECRET_FIELD = `(element) =>
  (element instanceof HTMLInputElement && element.type === "password") ||
  ((element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    (element.isContentEditable && element.hasAttribute("contenteditable"))) &&
    !["", "none"].includes(window.getComputedStyle(element).webkitTextSecurity || ""))`;

export const IN_SECRET = `(element) => {
  const secret = ${SECRET_FIELD};
  for (let node = element; node; node = node.parentElement) {
    if (secret(node)) {
      return true;
    }
  }
  return false;
}`;

const COLLECT_SECRETS = `(root, values) => {
  const secret = ${SECRET_FIELD};
  const add = (element) => {
    const forms =
      element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        ? [element.value]
        : [element.textContent, element.innerText];
    for (const form of forms) {
      if (form && !values.includes(form)) {
        values.push(form);
      }
    }
  };
  const visit = (node) => {
    for (const element of node.querySelectorAll("*")) {
      if (secret(element)) {
        add(element);
      }
      if (element.shadowRoot) {
        visit(element.shadowRoot);
      }
    }
  };
  if (root instanceof Element && secret(root)) {
    add(root);
  }
  visit(root);
  return values;
}`;

export const SECRET_VALUES = `function () {
  return (${COLLECT_SECRETS})(this && this.ownerDocument ? this.ownerDocument : document, []);
}`;

const SECRETS_WITHIN = `function () {
  return (${COLLECT_SECRETS})(this, []);
}`;

export function hideSecrets(
  text: string,
  secrets: string[],
  minimum = SPREAD_SECRET_LENGTH,
): string {
  return secretMask(secrets, minimum)(text);
}

export function secretMask(
  secrets: string[],
  minimum = SPREAD_SECRET_LENGTH,
): (text: string) => string {
  const edges = new Map<number, number>();
  const parent = [0];
  const via = [0];
  const depth = [0];
  const longest = [0];
  let budget = SECRET_CHARS;
  const variants = new Set(
    secrets.flatMap((secret) => [secret, secret.replace(/\s+/g, " ").trim()]),
  );
  for (const variant of variants) {
    if (variant.length < minimum || variant.length > budget) {
      continue;
    }
    budget -= variant.length;
    let state = 0;
    for (let index = 0; index < variant.length; index++) {
      const code = variant.charCodeAt(index);
      let next = edges.get(state * CODES + code);
      if (next === undefined) {
        next = parent.length;
        edges.set(state * CODES + code, next);
        parent.push(state);
        via.push(code);
        depth.push(depth[state] + 1);
        longest.push(0);
      }
      state = next;
    }
    longest[state] = variant.length;
  }
  if (parent.length === 1) {
    return (text) => text;
  }
  const fail = new Int32Array(parent.length);
  const order = Array.from({ length: parent.length - 1 }, (_, index) => index + 1).sort(
    (a, b) => depth[a] - depth[b],
  );
  for (const state of order) {
    if (depth[state] > 1) {
      let candidate = fail[parent[state]];
      let target = edges.get(candidate * CODES + via[state]);
      while (target === undefined && candidate !== 0) {
        candidate = fail[candidate];
        target = edges.get(candidate * CODES + via[state]);
      }
      fail[state] = target ?? 0;
    }
    longest[state] = Math.max(longest[state], longest[fail[state]]);
  }
  return (text) => {
    let cover: Int32Array | null = null;
    let state = 0;
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      let next = edges.get(state * CODES + code);
      while (next === undefined && state !== 0) {
        state = fail[state];
        next = edges.get(state * CODES + code);
      }
      state = next ?? 0;
      if (longest[state] > 0) {
        cover ??= new Int32Array(text.length);
        const start = index + 1 - longest[state];
        cover[start] = Math.max(cover[start], index + 1);
      }
    }
    if (!cover) {
      return text;
    }
    let hidden = "";
    let until = 0;
    for (let index = 0; index < text.length; index++) {
      const end = cover[index];
      if (end === 0) {
        continue;
      }
      if (index >= until) {
        hidden += text.slice(until, index) + SECRET_MASK;
        until = end;
      } else if (end > until) {
        until = end;
      }
    }
    return hidden + text.slice(until);
  };
}

export function htmlForms(secrets: string[]): string[] {
  return secrets.flatMap((secret) => {
    const text = secret
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\u00a0/g, "&nbsp;");
    const attribute = secret
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/\u00a0/g, "&nbsp;");
    return [
      ...new Set([secret, text, attribute, attribute.replace(/</g, "&lt;").replace(/>/g, "&gt;")]),
    ];
  });
}

let scans = 0;

export function secretsNear(session: CDPSession, backendNodeId: number): Promise<string[]> {
  return collectFrom(session, backendNodeId, SECRET_VALUES);
}

export function secretsWithin(session: CDPSession, backendNodeId: number): Promise<string[]> {
  return collectFrom(session, backendNodeId, SECRETS_WITHIN);
}

async function collectFrom(
  session: CDPSession,
  backendNodeId: number,
  functionDeclaration: string,
): Promise<string[]> {
  const group = `steel-secrets-${++scans}`;
  try {
    const { object } = await session.send("DOM.resolveNode", {
      backendNodeId,
      objectGroup: group,
    });
    const { result } = await session.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration,
      returnByValue: true,
    });
    return Array.isArray(result.value) ? result.value : [];
  } catch {
    return [];
  } finally {
    await session.send("Runtime.releaseObjectGroup", { objectGroup: group }).catch(() => undefined);
  }
}
