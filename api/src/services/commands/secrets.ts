import type { CDPSession } from "puppeteer-core";

export const SECRET_MASK = "••••••••";

const SPREAD_SECRET_LENGTH = 4;

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
  const variants = new Set(
    secrets.flatMap((secret) => [secret, secret.replace(/\s+/g, " ").trim()]),
  );
  let hidden = text;
  for (const variant of [...variants].sort((a, b) => b.length - a.length)) {
    if (variant.length >= minimum && hidden.includes(variant)) {
      hidden = hidden.split(variant).join(SECRET_MASK);
    }
  }
  return hidden;
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
