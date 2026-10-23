import type { CDPSession } from "puppeteer-core";
import {
  axString,
  holdsValue,
  ITEM_NODE_LIMIT,
  lostText,
  normalizeName,
  textSignature,
  type AXNode,
} from "./ax.js";
import { CommandError } from "./errors.js";
import { VISIBLE } from "./reads.js";
import { parseRef, type RefEntry, type RefTable } from "./refs.js";
import { hideSecrets, SECRET_VALUES, secretsWithin } from "./secrets.js";
import { bounded } from "./pointer.js";
import { findLoader, scanSecrets } from "./snapshot.js";
import type { Tab } from "./tabs.js";

const CHECK_TIMEOUT_MS = 5_000;

let handleGroups = 0;

export function handleGroup(): string {
  return `steel-command-${++handleGroups}`;
}

const SHOWN = `function () {
  const visible = ${VISIBLE};
  return this.map((element) => visible.call(element));
}`;

const LOCATE = `function (kind, value, exact) {
  const normalize = (text) => String(text == null ? "" : text).replace(/\\s+/g, " ").trim();
  const wanted = normalize(value);
  const lower = wanted.toLowerCase();
  const matches = (text) => {
    const candidate = normalize(text);
    if (!candidate) return false;
    return exact ? candidate === wanted : candidate.toLowerCase().includes(lower);
  };
  if (kind === "css") return Array.from(document.querySelectorAll(value));
  const elements = [];
  const collect = (root) => {
    for (const element of root.querySelectorAll("*")) {
      elements.push(element);
      if (element.shadowRoot) collect(element.shadowRoot);
    }
  };
  collect(document);
  const skipped = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "TITLE"]);
  const textOf = (id) => {
    const element = document.getElementById(id);
    return element ? element.textContent : "";
  };
  switch (kind) {
    case "text":
      return elements.filter(
        (element) =>
          !skipped.has(element.tagName) &&
          matches(element.textContent) &&
          !Array.from(element.children).some((child) => matches(child.textContent)),
      );
    case "label": {
      const found = [];
      for (const element of elements) {
        if (element.tagName === "LABEL" && element.control && matches(element.textContent)) {
          found.push(element.control);
        } else if (matches(element.getAttribute("aria-label"))) {
          found.push(element);
        } else if (
          element.hasAttribute("aria-labelledby") &&
          matches(element.getAttribute("aria-labelledby").split(/\\s+/).map(textOf).join(" "))
        ) {
          found.push(element);
        }
      }
      return Array.from(new Set(found));
    }
    case "placeholder":
    case "alt":
    case "title":
      return elements.filter((element) => matches(element.getAttribute(kind)));
    case "testid":
      return elements.filter((element) => element.getAttribute("data-testid") === value);
  }
  return [];
}`;

export interface Locator {
  role?: string;
  name?: string;
  text?: string;
  label?: string;
  placeholder?: string;
  alt?: string;
  title?: string;
  testid?: string;
  css?: string;
  exact?: boolean;
  nth?: number;
}

export type Target = string | Locator;

export interface Expectation {
  role?: string;
  name?: string;
}

export interface Scope {
  tab: Tab;
  session: CDPSession;
  frameId: string;
  root: boolean;
  group: string;
}

export interface Element {
  tab: Tab;
  session: CDPSession;
  frameId: string;
  group: string;
  backendNodeId: number;
  objectId: string;
  contextId: number;
  label: string;
  recheck?: () => Promise<void>;
}

export interface Match {
  backendNodeId: number;
  role: string;
  name: string;
  visible: boolean;
}

export const LOCATOR_KINDS = [
  "role",
  "text",
  "label",
  "placeholder",
  "alt",
  "title",
  "testid",
  "css",
] as const;

export type LocatorKind = (typeof LOCATOR_KINDS)[number];

export function locatorKind(locator: Locator): LocatorKind {
  const kinds = LOCATOR_KINDS.filter((kind) => locator[kind] !== undefined);
  if (kinds.length !== 1) {
    throw new CommandError(
      "invalid_argument",
      `A locator needs exactly one of ${LOCATOR_KINDS.join(", ")}.`,
    );
  }
  return kinds[0];
}

export function describeTarget(target: Target): string {
  if (typeof target === "string") {
    return target;
  }
  const kind = locatorKind(target);
  const parts = [`${kind}=${JSON.stringify(target[kind])}`];
  if (target.name !== undefined) {
    parts.push(`name=${JSON.stringify(target.name)}`);
  }
  if (target.nth !== undefined) {
    parts.push(`nth=${target.nth}`);
  }
  return parts.join(" ");
}

export function asLocator(target: Target): Locator | null {
  if (typeof target !== "string") {
    return target;
  }
  return parseRef(target) ? null : { css: target };
}

export async function mainScope(tab: Tab, group: string): Promise<Scope> {
  const session = await tab.session();
  const { frameTree } = await session.send("Page.getFrameTree");
  return { tab, session, frameId: frameTree.frame.id, root: true, group };
}

export async function frameScope(
  tab: Tab,
  refs: RefTable,
  frame: string,
  group: string,
): Promise<Scope> {
  const ref = parseRef(frame);
  const entry = ref ? refs.get(ref) : undefined;
  if (!entry || entry.tabId !== tab.id || entry.role !== "Iframe") {
    throw new CommandError(
      "frame_not_found",
      `Frame ${frame} is not an iframe ref from a snapshot of tab ${tab.id}.`,
    );
  }
  const parent = tab.sessionByKey(entry.sessionKey);
  if (!parent) {
    throw new CommandError("frame_not_found", `Frame ${frame} is no longer in the page.`);
  }
  const { node } = await parent
    .send("DOM.describeNode", { backendNodeId: entry.backendNodeId, depth: 1 })
    .catch(() => ({ node: null }));
  const frameId = node?.contentDocument?.frameId ?? node?.frameId;
  if (!frameId) {
    throw new CommandError("frame_not_found", `Frame ${frame} has no document.`);
  }
  const child = tab.frameSession(frameId);
  return child
    ? { tab, session: child, frameId, root: true, group }
    : { tab, session: parent, frameId, root: false, group };
}

export async function locate(scope: Scope, locator: Locator): Promise<Match[]> {
  const kind = locatorKind(locator);
  if (kind === "role") {
    return byRole(scope, locator);
  }
  const contextId = await worldOf(scope);
  const { result, exceptionDetails } = await scope.session.send("Runtime.callFunctionOn", {
    functionDeclaration: LOCATE,
    executionContextId: contextId,
    arguments: [{ value: kind }, { value: locator[kind] }, { value: locator.exact === true }],
    returnByValue: false,
    objectGroup: scope.group,
  });
  if (exceptionDetails || !result.objectId) {
    throw new CommandError(
      "invalid_argument",
      `The locator ${describeTarget(locator)} is not valid: ${
        exceptionDetails?.exception?.description ?? exceptionDetails?.text ?? "no result"
      }`,
    );
  }
  const { result: properties } = await scope.session.send("Runtime.getProperties", {
    objectId: result.objectId,
    ownProperties: true,
  });
  const { result: shown } = await scope.session.send("Runtime.callFunctionOn", {
    objectId: result.objectId,
    functionDeclaration: SHOWN,
    returnByValue: true,
  });
  const visible: boolean[] = Array.isArray(shown.value) ? shown.value : [];
  const matches: Match[] = [];
  for (const property of properties) {
    if (!/^\d+$/.test(property.name) || !property.value?.objectId) {
      continue;
    }
    const { node } = await scope.session.send("DOM.describeNode", {
      objectId: property.value.objectId,
    });
    matches.push({
      backendNodeId: node.backendNodeId,
      role: "",
      name: "",
      visible: visible[Number(property.name)] !== false,
    });
  }
  await scope.session
    .send("Runtime.releaseObject", { objectId: result.objectId })
    .catch(() => undefined);
  return matches;
}

export function pick<T>(matches: T[], locator: Locator): T | undefined {
  const nth = locator.nth ?? 0;
  return matches[nth < 0 ? matches.length + nth : nth];
}

function sole(matches: Match[], locator: Locator): Match | undefined {
  if (matches.length <= 1) {
    return matches[0];
  }
  const shown = matches.filter((match) => match.visible);
  if (shown.length === 1) {
    return shown[0];
  }
  throw new CommandError(
    "invalid_argument",
    `${describeTarget(locator)} matches ${matches.length} elements${
      shown.length === matches.length ? "" : `, ${shown.length} of them visible`
    }. Pass nth, use a more specific locator, or use a ref from a snapshot.`,
    "ambiguous",
  );
}

export async function resolveLocator(
  scope: Scope,
  locator: Locator,
  expect?: Expectation,
): Promise<Element> {
  const matches = await locate(scope, locator);
  const match = locator.nth === undefined ? sole(matches, locator) : pick(matches, locator);
  if (!match) {
    throw new CommandError(
      "element_not_found",
      matches.length === 0
        ? `No element matches ${describeTarget(locator)}.`
        : `Only ${matches.length} elements match ${describeTarget(locator)}.`,
    );
  }
  const element = await elementFor(scope, match.backendNodeId, describeTarget(locator));
  if (!element) {
    throw new CommandError(
      "element_not_found",
      `The element for ${describeTarget(locator)} left the page.`,
    );
  }
  const name = (await axNode(scope.session, match.backendNodeId))?.name ?? "";
  element.recheck = async () => {
    const now = await axNode(scope.session, match.backendNodeId);
    if (now && now.name !== name) {
      throw new CommandError(
        "not_actionable",
        `${element.label} shows different content now. Find it again.`,
        "content_changed",
      );
    }
  };
  if (expect) {
    const current = await axNode(scope.session, match.backendNodeId);
    if (!fits(current, expect)) {
      throw new CommandError(
        "element_not_found",
        `${describeTarget(locator)} is ${await shownAs(
          element,
          current,
        )}, not what expect describes.`,
        "expect_mismatch",
      );
    }
  }
  return element;
}

export async function resolveRef(
  tab: Tab,
  entry: RefEntry,
  group: string,
  expect?: Expectation,
): Promise<Element> {
  const session = tab.sessionByKey(entry.sessionKey);
  if (!session) {
    throw stale(entry, "detached");
  }
  const { frameTree } = await session.send("Page.getFrameTree");
  const loaderId = findLoader(frameTree, entry.frameId);
  if (!loaderId || loaderId !== entry.loaderId) {
    throw stale(entry, "detached");
  }
  const scope = { tab, session, frameId: entry.frameId, root: true, group };
  const element = await elementFor(scope, entry.backendNodeId, `Ref ${entry.ref}`);
  if (!element) {
    throw stale(entry, "detached");
  }
  const unchanged = async () => {
    const now = await axNode(session, entry.backendNodeId);
    if (!now) {
      return null;
    }
    if (entry.axName !== null && now.name !== entry.axName) {
      throw stale(entry, "content_changed");
    }
    if (entry.item) {
      const text = await itemText(session, entry.item.backendNodeId, entry.frameId);
      if (text === null || lostText(entry.item.text, text)) {
        throw stale(entry, "content_changed");
      }
    }
    return now;
  };
  const current = await unchanged();
  element.recheck = async () => {
    await unchanged();
  };
  if (expect && !fits(current, expect)) {
    throw new CommandError(
      "stale_ref",
      `Ref ${entry.ref} is ${await shownAs(
        element,
        current,
      )}, not what expect describes. Take a new snapshot.`,
      "expect_mismatch",
    );
  }
  return element;
}

export async function elementFor(
  scope: Omit<Scope, "root">,
  backendNodeId: number,
  label: string,
): Promise<Element | null> {
  const { frameTree } = await scope.session.send("Page.getFrameTree");
  const loaderId = findLoader(frameTree, scope.frameId);
  if (!loaderId) {
    return null;
  }
  const executionContextId = await scope.tab.world(scope.session, scope.frameId, loaderId);
  try {
    const { object } = await scope.session.send("DOM.resolveNode", {
      backendNodeId,
      executionContextId,
      objectGroup: scope.group,
    });
    if (!object.objectId) {
      return null;
    }
    const { result } = await scope.session.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: "function () { return this.isConnected; }",
      returnByValue: true,
    });
    if (result.value !== true) {
      return null;
    }
    return {
      ...scope,
      backendNodeId,
      objectId: object.objectId,
      contextId: executionContextId,
      label,
    };
  } catch {
    return null;
  }
}

export async function callOn<T>(
  element: Element,
  functionDeclaration: string,
  args: unknown[] = [],
): Promise<T> {
  const { result, exceptionDetails } = await element.session.send("Runtime.callFunctionOn", {
    objectId: element.objectId,
    functionDeclaration,
    arguments: args.map((value) => ({ value })),
    returnByValue: true,
  });
  if (exceptionDetails) {
    throw new CommandError(
      "internal_error",
      `A script on ${element.label} failed: ${
        exceptionDetails.exception?.description ?? exceptionDetails.text
      }`,
    );
  }
  return result.value as T;
}

export async function callIn<T>(
  scope: Scope,
  functionDeclaration: string,
  args: unknown[] = [],
  ready?: () => void,
): Promise<T> {
  const executionContextId = await worldOf(scope);
  ready?.();
  const { result, exceptionDetails } = await scope.session.send("Runtime.callFunctionOn", {
    executionContextId,
    functionDeclaration,
    arguments: args.map((value) => ({ value })),
    returnByValue: true,
  });
  if (exceptionDetails) {
    throw new CommandError(
      "internal_error",
      `A script in tab ${scope.tab.id} failed: ${
        exceptionDetails.exception?.description ?? exceptionDetails.text
      }`,
    );
  }
  return result.value as T;
}

export async function axNode(
  session: CDPSession,
  backendNodeId: number,
): Promise<{ role: string; name: string } | null> {
  try {
    const { nodes } = await session.send("Accessibility.getPartialAXTree", {
      backendNodeId,
      fetchRelatives: false,
    });
    const node = nodes.find((candidate) => candidate.backendDOMNodeId === backendNodeId);
    return node && !node.ignored
      ? { role: axString(node.role), name: normalizeName(axString(node.name)) }
      : null;
  } catch {
    return null;
  }
}

async function worldOf(scope: Scope): Promise<number> {
  const { frameTree } = await scope.session.send("Page.getFrameTree");
  const loaderId = findLoader(frameTree, scope.frameId);
  if (!loaderId) {
    throw new CommandError("frame_not_found", "The frame has no document.");
  }
  return scope.tab.world(scope.session, scope.frameId, loaderId);
}

async function byRole(scope: Scope, locator: Locator): Promise<Match[]> {
  const { nodes } = await scope.session.send(
    "Accessibility.getFullAXTree",
    scope.root ? {} : { frameId: scope.frameId },
  );
  const role = ariaRole(locator.role!);
  const wanted = whitespace(locator.name ?? "");
  const matches: Match[] = [];
  for (const node of treeOrder(nodes)) {
    if (node.ignored || node.backendDOMNodeId === undefined) {
      continue;
    }
    if (ariaRole(axString(node.role)) !== role) {
      continue;
    }
    const name = whitespace(normalizeName(axString(node.name)));
    if (locator.name !== undefined) {
      const fits = locator.exact
        ? name === wanted
        : name.toLowerCase().includes(wanted.toLowerCase());
      if (!fits) {
        continue;
      }
    }
    matches.push({
      backendNodeId: node.backendDOMNodeId,
      role: axString(node.role),
      name,
      visible: true,
    });
  }
  return matches;
}

function treeOrder<T extends { nodeId: string; parentId?: string; childIds?: string[] }>(
  nodes: T[],
): T[] {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const ordered: T[] = [];
  const seen = new Set<string>();
  const stack = nodes.filter((node) => !node.parentId || !byId.has(node.parentId)).reverse();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (seen.has(node.nodeId)) {
      continue;
    }
    seen.add(node.nodeId);
    ordered.push(node);
    const children = (node.childIds ?? []).flatMap((id) => byId.get(id) ?? []);
    for (let index = children.length - 1; index >= 0; index--) {
      stack.push(children[index]);
    }
  }
  return ordered.concat(nodes.filter((node) => !seen.has(node.nodeId)));
}

function ariaRole(role: string): string {
  const lower = role.toLowerCase();
  return lower === "image" ? "img" : lower === "rootwebarea" ? "document" : lower;
}

function whitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function fits(current: { role: string; name: string } | null, expect: Expectation): boolean {
  if (!current) {
    return false;
  }
  if (expect.role !== undefined && ariaRole(current.role) !== ariaRole(expect.role)) {
    return false;
  }
  if (expect.name !== undefined && whitespace(current.name) !== whitespace(expect.name)) {
    return false;
  }
  return true;
}

async function shownAs(
  element: Element,
  current: { role: string; name: string } | null,
): Promise<string> {
  if (!current) {
    return "not in the accessibility tree";
  }
  const scan = await scanSecrets(element.session);
  const secrets = [
    ...(await callOn<string[]>(element, SECRET_VALUES).catch(() => [])),
    ...scan.values,
  ];
  const within = [
    ...(await secretsWithin(element.session, element.backendNodeId)),
    ...scan.within(element.backendNodeId),
  ];
  return `${current.role} "${hideSecrets(hideSecrets(current.name, secrets), within, 1)}"`;
}

function stale(entry: RefEntry, reason: string): CommandError {
  const message =
    reason === "content_changed"
      ? `Ref ${entry.ref} now shows different content. Take a new snapshot.`
      : `Ref ${entry.ref} is no longer in the page. Take a new snapshot.`;
  return new CommandError("stale_ref", message, reason);
}

async function itemText(
  session: CDPSession,
  backendNodeId: number,
  frameId: string,
): Promise<string | null> {
  try {
    return await bounded(
      walkText(session, backendNodeId, frameId),
      CHECK_TIMEOUT_MS,
      () =>
        new CommandError("timeout", "The page did not answer the ref check in time.", "ref_check"),
    );
  } catch (error) {
    if (error instanceof CommandError) {
      throw error;
    }
    return null;
  }
}

async function walkText(
  session: CDPSession,
  backendNodeId: number,
  frameId: string,
): Promise<string | null> {
  const { nodes } = await session.send("Accessibility.getPartialAXTree", {
    backendNodeId,
    fetchRelatives: false,
  });
  const root = nodes.find((node) => node.backendDOMNodeId === backendNodeId);
  if (!root) {
    return null;
  }
  const collected: AXNode[] = [root];
  const seen = new Set([root.nodeId]);
  const queue: AXNode[] = [root];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (!node.childIds?.length || holdsValue(node)) {
      continue;
    }
    const { nodes: children } = await session.send("Accessibility.getChildAXNodes", {
      id: node.nodeId,
      frameId,
    });
    for (const child of children) {
      if (!seen.has(child.nodeId)) {
        seen.add(child.nodeId);
        collected.push(child);
        queue.push(child);
      }
    }
    if (collected.length > ITEM_NODE_LIMIT) {
      return null;
    }
  }
  return textSignature(collected);
}
