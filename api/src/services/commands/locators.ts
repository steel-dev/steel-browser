import { hideSecrets, SECRET_VALUES } from "./secrets.js";
import { secretsIn } from "./snapshot.js";
import {
  axNode,
  callOn,
  elementFor,
  frameOwner,
  locate,
  MAX_FRAME_DEPTH,
  scopeOf,
  type Element,
  type Locator,
  type Scope,
} from "./targets.js";

export interface Placement {
  target: Locator;
  frame?: Locator | Locator[];
}

interface Facts {
  tag: string;
  escapedTag: string;
  testid: string;
  data: [string, string][];
  id: string;
  escapedId: string;
  name: string;
  placeholder: string;
  alt: string;
  title: string;
  label: string;
  src: string;
  text: string;
  classes: [string, string][];
}

const FACTS = `function () {
  const clean = (text) => String(text == null ? "" : text).replace(/\\s+/g, " ").trim();
  const read = (name) => clean(this.getAttribute(name));
  const root = this.getRootNode();
  const labelledBy = (this.getAttribute("aria-labelledby") || "")
    .split(/\\s+/)
    .filter(Boolean)
    .map((id) => (root.getElementById ? root.getElementById(id)?.textContent ?? "" : ""))
    .join(" ");
  const label =
    read("aria-label") ||
    clean(labelledBy) ||
    (this.labels && this.labels.length > 0 ? clean(this.labels[0].textContent) : "");
  const tag = this.localName;
  const framed = tag === "iframe" || tag === "frame";
  const control = ["select", "textarea", "input", "datalist"].includes(tag);
  return {
    tag,
    escapedTag: CSS.escape(tag),
    testid: this.getAttribute("data-testid") || "",
    data: ["data-test", "data-qa", "data-cy"]
      .map((name) => [name, this.getAttribute(name) || ""])
      .filter(([, value]) => value),
    id: this.id || "",
    escapedId: this.id ? CSS.escape(this.id) : "",
    name: this.getAttribute("name") || "",
    placeholder: read("placeholder"),
    alt: read("alt"),
    title: read("title"),
    label,
    src: framed ? this.getAttribute("src") || "" : "",
    text: framed || control ? "" : clean(this.textContent).slice(0, 200),
    classes: Array.from(this.classList).map((name) => [name, CSS.escape(name)]),
  };
}`;

const GENERIC_ROLES = new Set([
  "generic",
  "none",
  "presentation",
  "statictext",
  "inlinetextbox",
  "rootwebarea",
  "linebreak",
]);

const GENERATED_ID = /\d{3,}|:|^[a-f0-9-]{12,}$|^(radix|headlessui|mui|react-aria|ember)[-_]/i;

const SEMANTIC_CLASS = /^[A-Za-z][\w-]{3,}$/;

const HASHED_CLASS = /\d{2,}|^(css|sc|jsx|emotion|chakra|style)-|__[A-Za-z0-9]{5}$/;

const SESSION_URL = /^(blob|data|javascript):/i;

const TEXT_LIMIT = 80;

const CLASS_LIMIT = 3;

function cssString(value: string): string {
  return value.replace(/["\\]/g, "\\$&").replace(/\n/g, "\\a ");
}

export async function placements(element: Element): Promise<Placement[]> {
  const scope = await scopeOf(element.tab, element.session, element.frameId, element.group);
  const targets = await candidates(scope, element);
  if (targets.length === 0) {
    return [];
  }
  const frames = await frameChain(element);
  if (frames === null) {
    return [];
  }
  return targets.map((target) =>
    frames.length === 0 ? { target } : { target, frame: frames.length === 1 ? frames[0] : frames },
  );
}

async function frameChain(element: Element): Promise<Locator[] | null> {
  const chain: Locator[] = [];
  let session = element.session;
  let frameId = element.frameId;
  for (let depth = 0; depth <= MAX_FRAME_DEPTH; depth++) {
    const owner = await frameOwner(element.tab, session, frameId).catch(() => undefined);
    if (owner === undefined) {
      return null;
    }
    if (owner === null) {
      return chain;
    }
    if (depth === MAX_FRAME_DEPTH) {
      return null;
    }
    const scope = await scopeOf(element.tab, owner.session, owner.frameId, element.group);
    const iframe = await elementFor(scope, owner.backendNodeId, "The frame");
    const best = iframe ? (await candidates(scope, iframe))[0] : undefined;
    if (!best) {
      return null;
    }
    chain.unshift(best);
    session = owner.session;
    frameId = owner.frameId;
  }
  return null;
}

async function candidates(scope: Scope, element: Element): Promise<Locator[]> {
  const facts = await callOn<Facts>(element, FACTS);
  const node = await axNode(scope.session, element.backendNodeId);
  const framed = facts.tag === "iframe" || facts.tag === "frame";
  const named: Locator | null =
    node?.name && !GENERIC_ROLES.has(node.role.toLowerCase())
      ? { role: node.role.toLowerCase(), name: node.name, exact: true }
      : null;
  const ordered: { locator: Locator; raw: string[] }[] = [];
  const add = (locator: Locator, ...raw: string[]) => ordered.push({ locator, raw });
  if (facts.testid) {
    add({ testid: facts.testid }, facts.testid);
  }
  for (const [attribute, value] of facts.data) {
    add({ css: `[${attribute}="${cssString(value)}"]` }, value);
  }
  if (named) {
    add(named, node!.name);
  }
  if (facts.label) {
    add({ label: facts.label, exact: true }, facts.label);
  }
  if (facts.placeholder) {
    add({ placeholder: facts.placeholder, exact: true }, facts.placeholder);
  }
  if (facts.alt) {
    add({ alt: facts.alt, exact: true }, facts.alt);
  }
  if (facts.title) {
    add({ title: facts.title, exact: true }, facts.title);
  }
  if (facts.id && !GENERATED_ID.test(facts.id)) {
    add({ css: `#${facts.escapedId}` }, facts.id);
  }
  if (facts.name) {
    add({ css: `${facts.escapedTag}[name="${cssString(facts.name)}"]` }, facts.name);
  }
  if (facts.src && !SESSION_URL.test(facts.src)) {
    const cut = facts.src.search(/[?#]/);
    const kept = cut >= 0 ? facts.src.slice(0, cut + 1) : facts.src;
    add({ css: `${facts.escapedTag}[src${cut >= 0 ? "^" : ""}="${cssString(kept)}"]` }, kept);
  }
  if (facts.text && facts.text.length <= TEXT_LIMIT) {
    add({ text: facts.text, exact: true }, facts.text);
  }
  for (const [name, escaped] of facts.classes
    .filter(([name]) => SEMANTIC_CLASS.test(name) && !HASHED_CLASS.test(name))
    .slice(0, CLASS_LIMIT)) {
    add({ css: `${facts.escapedTag}.${escaped}` }, name);
  }
  const secrets = [
    ...(await callOn<string[]>(element, SECRET_VALUES).catch(() => [])),
    ...(await secretsIn(scope.session)),
  ];
  const unique: Locator[] = [];
  const positional: Locator[] = [];
  for (const { locator: candidate, raw } of ordered) {
    if (raw.some((value) => hideSecrets(value, secrets) !== value)) {
      continue;
    }
    const matches = await locate(scope, candidate).catch(() => []);
    const index = matches.findIndex((match) => match.backendNodeId === element.backendNodeId);
    if (index < 0) {
      continue;
    }
    if (matches.length === 1) {
      unique.push(candidate);
    } else if (candidate === named) {
      positional.push({ ...named, nth: index });
    }
  }
  if (framed && unique.length === 0 && positional.length === 0) {
    const fallbacks: Locator[] = [
      { css: facts.escapedTag },
      ...(node ? [{ role: node.role.toLowerCase() }] : []),
    ];
    for (const fallback of fallbacks) {
      const matches = await locate(scope, fallback).catch(() => []);
      const index = matches.findIndex((match) => match.backendNodeId === element.backendNodeId);
      if (index >= 0) {
        positional.push({ ...fallback, nth: index });
        break;
      }
    }
  }
  const seen = new Set<string>();
  return [...unique, ...positional].filter((locator) => {
    const key = JSON.stringify(locator);
    return !seen.has(key) && !!seen.add(key);
  });
}
