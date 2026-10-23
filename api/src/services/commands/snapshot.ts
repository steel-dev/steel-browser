import type { CDPSession, Protocol } from "puppeteer-core";
import {
  axString,
  holdsValue,
  ITEM_NODE_LIMIT,
  normalizeName,
  textSignature,
  type AXNode,
} from "./ax.js";
import type { ItemSignature, RefEntry, RefTable } from "./refs.js";
import { within } from "./results.js";
import { hideSecrets, SECRET_MASK } from "./secrets.js";

type DomCapture = Protocol.DOMSnapshot.CaptureSnapshotResponse;
type DomDocument = Protocol.DOMSnapshot.DocumentSnapshot;

export const CONTROL_ROLES = new Set([
  "button",
  "checkbox",
  "ColorWell",
  "combobox",
  "Date",
  "DateTime",
  "DisclosureTriangle",
  "InputTime",
  "link",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "treeitem",
]);

const NAMED_ROLES = new Set([
  "article",
  "cell",
  "columnheader",
  "gridcell",
  "heading",
  "listitem",
  "main",
  "navigation",
  "region",
  "rowheader",
]);

const NATIVE_CONTROLS = new Set([
  "a",
  "button",
  "details",
  "input",
  "select",
  "summary",
  "textarea",
]);

const ITEM_ROLES = new Set(["row", "LayoutTableRow", "listitem", "option", "treeitem", "article"]);

const CONTEXT_DEPTH = 4;

const CONTEXT_LIMIT = 400;

const SIGNED_ITEM_NODES = ITEM_NODE_LIMIT / 2;

const STYLES = ["cursor", "visibility", "-webkit-text-security"];

const CURSOR = 0;

const VISIBILITY = 1;

const TEXT_SECURITY = 2;

const AFFORDANCE_TEXT = 100;

const MAX_FRAME_DEPTH = 4;

const SILENT_FRAME = "(did not answer)";

export interface SnapshotOptions {
  interactive?: boolean;
  compact?: boolean;
  depth?: number;
}

export interface FrameHandle {
  tabId: string;
  frameId: string;
  session: CDPSession;
  sessionKey: string;
  root: boolean;
}

export interface FrameResolver {
  child(parent: FrameHandle, frameId: string): FrameHandle;
  readMs: number;
}

interface Affordance {
  kind: "clickable" | "editable" | "focusable";
  hints: string[];
  text: string;
  toggle?: { role: "radio" | "checkbox"; checked: string };
}

interface DomFacts {
  affordances: Map<number, Affordance>;
  secrets: Set<number>;
  secretValues: string[];
}

interface Outline {
  role: string;
  name: string;
  value?: string;
  level?: number;
  checked?: string;
  expanded?: boolean;
  selected?: boolean;
  disabled?: boolean;
  required?: boolean;
  backendNodeId?: number;
  children: Outline[];
  size: number;
  ref?: string;
  entry?: Omit<RefEntry, "ref">;
  affordance?: Affordance;
  frame?: Outline[];
}

interface Built {
  roots: Outline[];
  byIndex: Array<Outline | undefined>;
  parents: Int32Array;
}

export async function takeSnapshot(
  main: FrameHandle,
  frames: FrameResolver,
  refs: RefTable,
  options: SnapshotOptions = {},
  current: () => boolean = () => true,
): Promise<string> {
  const roots = await readFrame(main, frames, refs, new Map(), 0);
  const lines: string[] = [];
  const shown: Outline[] = [];
  for (const root of roots) {
    emit(root, 0, options, lines, shown);
  }
  if (current()) {
    refs.commit(
      shown.flatMap((node) => (node.entry && node.ref ? [{ ...node.entry, ref: node.ref }] : [])),
    );
  }
  const output = lines.join("\n").trim();
  return output || (options.interactive ? "(no interactive elements)" : "(empty page)");
}

export async function refsFor(
  frame: FrameHandle,
  refs: RefTable,
  backendNodeIds: number[],
  secrets: string[] = [],
  within = new Map<number, string[]>(),
  current: () => boolean = () => true,
): Promise<Array<{ ref: string; role: string; name: string }>> {
  const { frameTree } = await frame.session.send("Page.getFrameTree");
  const loaderId = findLoader(frameTree, frame.frameId);
  refs.observe(frame.tabId, frame.frameId, frame.sessionKey, loaderId, false);
  const { nodes: axNodes } = await frame.session.send(
    "Accessibility.getFullAXTree",
    frame.root ? {} : { frameId: frame.frameId },
  );
  const built = outline(axNodes);
  const itemText = itemTextReader(axNodes);
  const repeated = repeatReader(axNodes, built.parents);
  const valueInside = valueReader(axNodes);
  const indexOf = new Map<number, number>();
  axNodes.forEach((node, index) => {
    if (node.backendDOMNodeId !== undefined && !indexOf.has(node.backendDOMNodeId)) {
      indexOf.set(node.backendDOMNodeId, index);
    }
  });
  const entries = backendNodeIds.map((backendNodeId): RefEntry => {
    const index = indexOf.get(backendNodeId);
    const node = index === undefined ? undefined : built.byIndex[index];
    const entry = {
      tabId: frame.tabId,
      frameId: frame.frameId,
      sessionKey: frame.sessionKey,
      loaderId,
      backendNodeId,
      role: node?.role || "generic",
      name: hideSecrets(hideSecrets(node?.name ?? "", secrets), within.get(backendNodeId) ?? [], 1),
      axName:
        index === undefined
          ? ""
          : valueInside(index)
          ? null
          : normalizeName(axString(axNodes[index].name)),
      item:
        index === undefined
          ? null
          : itemSignature(axNodes, built.parents, index, itemText, repeated),
    };
    return { ...entry, ref: refs.reserve(entry) };
  });
  if (current()) {
    refs.commit(entries);
  }
  return entries.map(({ ref, role, name }) => ({ ref, role, name }));
}

export function findLoader(tree: Protocol.Page.FrameTree, frameId: string): string | null {
  if (tree.frame.id === frameId) {
    return tree.frame.loaderId || null;
  }
  for (const child of tree.childFrames ?? []) {
    const loader = findLoader(child, frameId);
    if (loader) {
      return loader;
    }
  }
  return null;
}

async function readFrame(
  frame: FrameHandle,
  frames: FrameResolver,
  refs: RefTable,
  captures: Map<string, Promise<DomCapture | null>>,
  depth: number,
): Promise<Outline[]> {
  const { frameTree } = await frame.session.send("Page.getFrameTree");
  const loaderId = findLoader(frameTree, frame.frameId);
  refs.observe(frame.tabId, frame.frameId, frame.sessionKey, loaderId, depth === 0);
  const { nodes: axNodes } = await frame.session.send(
    "Accessibility.getFullAXTree",
    frame.root ? {} : { frameId: frame.frameId },
  );
  const built = outline(axNodes);
  const facts = readDom(await capture(frame, captures), frame.frameId);
  for (const node of built.byIndex) {
    if (node) {
      applyFacts(node, facts);
    }
  }
  hideSecretsAbove(axNodes, built, facts);
  for (const node of built.byIndex) {
    if (node) {
      node.name = hideSecrets(node.name, facts.secretValues);
      if (node.value && node.value !== SECRET_MASK) {
        node.value = hideSecrets(node.value, facts.secretValues);
      }
      if (node.affordance) {
        node.affordance.text = hideSecrets(node.affordance.text, facts.secretValues);
      }
    }
  }
  const itemText = itemTextReader(axNodes);
  const repeated = repeatReader(axNodes, built.parents);
  const valueInside = valueReader(axNodes);
  built.byIndex.forEach((node, index) => {
    if (!node || node.backendNodeId === undefined || !wantsRef(node)) {
      return;
    }
    node.entry = {
      tabId: frame.tabId,
      frameId: frame.frameId,
      sessionKey: frame.sessionKey,
      loaderId,
      backendNodeId: node.backendNodeId,
      role: node.role,
      name: node.name,
      axName: valueInside(index) ? null : normalizeName(axString(axNodes[index].name)),
      item: itemSignature(axNodes, built.parents, index, itemText, repeated),
    };
    node.ref = refs.reserve(node.entry);
  });
  if (depth < MAX_FRAME_DEPTH) {
    for (const node of built.byIndex) {
      if (node?.role !== "Iframe" || !node.ref || node.backendNodeId === undefined) {
        continue;
      }
      const childId = await childFrameId(frame.session, node.backendNodeId);
      if (childId) {
        const read = await within(
          readFrame(frames.child(frame, childId), frames, refs, captures, depth + 1).catch(
            () => null,
          ),
          frames.readMs,
        );
        if (read === undefined) {
          node.value = SILENT_FRAME;
        } else if (read) {
          node.frame = read;
        }
      }
    }
  }
  return built.roots;
}

function wantsRef(node: Outline): boolean {
  return (
    CONTROL_ROLES.has(node.role) ||
    node.role === "Iframe" ||
    (NAMED_ROLES.has(node.role) && node.name !== "") ||
    node.affordance !== undefined
  );
}

function applyFacts(node: Outline, facts: DomFacts) {
  if (node.backendNodeId === undefined) {
    return;
  }
  const affordance = facts.affordances.get(node.backendNodeId);
  if (affordance) {
    node.affordance = affordance;
    if (affordance.toggle && (node.role === "LabelText" || node.role === "generic")) {
      node.role = affordance.toggle.role;
      node.name ||= affordance.text;
      node.checked = affordance.toggle.checked;
    }
  }
  if (facts.secrets.has(node.backendNodeId)) {
    if (node.value) {
      node.value = SECRET_MASK;
    }
    node.children = [];
    node.size = 0;
  }
}

function hideSecretsAbove(axNodes: AXNode[], built: Built, facts: DomFacts) {
  axNodes.forEach((node, index) => {
    const secret =
      node.backendDOMNodeId !== undefined && facts.secrets.has(node.backendDOMNodeId)
        ? axString(node.value)
        : "";
    if (!secret) {
      return;
    }
    for (let parent = built.parents[index]; parent >= 0; parent = built.parents[parent]) {
      const above = built.byIndex[parent];
      if (above?.name.includes(secret)) {
        above.name = above.name.split(secret).join(SECRET_MASK);
      }
    }
  });
}

function capture(
  frame: FrameHandle,
  captures: Map<string, Promise<DomCapture | null>>,
): Promise<DomCapture | null> {
  let pending = captures.get(frame.sessionKey);
  if (!pending) {
    pending = frame.session
      .send("DOMSnapshot.captureSnapshot", { computedStyles: STYLES })
      .catch(() => null);
    captures.set(frame.sessionKey, pending);
  }
  return pending;
}

async function childFrameId(session: CDPSession, backendNodeId: number): Promise<string | null> {
  try {
    const { node } = await session.send("DOM.describeNode", { backendNodeId, depth: 1 });
    return node.contentDocument?.frameId ?? node.frameId ?? null;
  } catch {
    return null;
  }
}

function outline(axNodes: AXNode[]): Built {
  const indexOf = new Map(axNodes.map((node, index) => [node.nodeId, index]));
  const raw = axNodes.map((node) =>
    (node.childIds ?? [])
      .map((id) => indexOf.get(id))
      .filter((index): index is number => index !== undefined),
  );
  const parents = new Int32Array(axNodes.length).fill(-1);
  raw.forEach((children, index) => {
    for (const child of children) {
      parents[child] = index;
    }
  });
  const byIndex = axNodes.map((node): Outline | undefined => {
    const raw = axString(node.role);
    const role = raw === "IframePresentational" ? "Iframe" : raw;
    if (!role || role === "InlineTextBox" || (node.ignored && role !== "RootWebArea")) {
      return undefined;
    }
    return {
      role,
      name: axString(node.name),
      value: shownValue(node.value),
      backendNodeId: node.backendDOMNodeId,
      children: [],
      size: 0,
      ...states(node.properties),
    };
  });
  byIndex.forEach((node, index) => {
    if (node) {
      joinText(node, raw[index], byIndex, raw);
    }
  });
  const expand = (indices: number[], into: Outline[]) => {
    for (const index of indices) {
      const node = byIndex[index];
      if (node) {
        into.push(node);
      } else {
        expand(raw[index], into);
      }
    }
  };
  byIndex.forEach((node, index) => {
    if (node) {
      node.size = raw[index].length;
      expand(raw[index], node.children);
    }
  });
  const referenced = new Set(raw.flat());
  const roots: Outline[] = [];
  expand(
    axNodes.map((_, index) => index).filter((index) => !referenced.has(index)),
    roots,
  );
  return { roots, byIndex, parents };
}

function joinText(
  parent: Outline,
  children: number[],
  byIndex: Array<Outline | undefined>,
  raw: number[][],
) {
  const isText = (index: number) => byIndex[index]?.role === "StaticText";
  const runs: number[][] = [];
  for (const child of children) {
    const last = runs[runs.length - 1];
    if (last && isText(child) && isText(last[0])) {
      last.push(child);
    } else {
      runs.push([child]);
    }
  }
  const drop = (index: number) => {
    byIndex[index] = undefined;
    raw[index] = [];
  };
  for (const run of runs) {
    if (run.length > 1) {
      byIndex[run[0]]!.name = run.map((index) => byIndex[index]!.name).join("");
      run.slice(1).forEach(drop);
    }
  }
  if (children.length === 1 && isText(children[0]) && byIndex[children[0]]!.name === parent.name) {
    drop(children[0]);
  }
}

function shownValue(value: Protocol.Accessibility.AXValue | undefined): string | undefined {
  const raw = value?.value;
  if (typeof raw === "number") {
    return String(raw);
  }
  return typeof raw === "string" && raw !== "" ? raw : undefined;
}

function states(properties: Protocol.Accessibility.AXProperty[] = []): Partial<Outline> {
  const found: Partial<Outline> = {};
  for (const { name, value } of properties) {
    const raw = value.value;
    if (name === "level" && typeof raw === "number") {
      found.level = raw;
    } else if (name === "checked" && raw !== undefined) {
      found.checked = typeof raw === "string" || typeof raw === "boolean" ? String(raw) : "false";
    } else if (
      (name === "expanded" || name === "selected" || name === "disabled" || name === "required") &&
      typeof raw === "boolean"
    ) {
      found[name] = raw;
    }
  }
  return found;
}

function valueReader(axNodes: AXNode[]): (index: number) => boolean {
  const byId = new Map(axNodes.map((node) => [node.nodeId, node]));
  const memo = new Map<number, boolean>();
  return (index) => {
    const cached = memo.get(index);
    if (cached !== undefined) {
      return cached;
    }
    const stack = (axNodes[index].childIds ?? []).flatMap((id) => byId.get(id) ?? []);
    let found = false;
    for (let seen = 0; stack.length > 0 && !found; seen++) {
      const node = stack.pop()!;
      found = seen >= SIGNED_ITEM_NODES || holdsValue(node);
      for (const childId of node.childIds ?? []) {
        const child = byId.get(childId);
        if (child) {
          stack.push(child);
        }
      }
    }
    memo.set(index, found);
    return found;
  };
}

function itemTextReader(axNodes: AXNode[]): (index: number) => string | null {
  const byId = new Map(axNodes.map((node) => [node.nodeId, node]));
  const memo = new Map<number, string | null>();
  return (index) => {
    const cached = memo.get(index);
    if (cached !== undefined) {
      return cached;
    }
    const collected: AXNode[] = [];
    const stack = [axNodes[index]];
    while (stack.length > 0 && collected.length <= SIGNED_ITEM_NODES) {
      const node = stack.pop()!;
      collected.push(node);
      if (holdsValue(node)) {
        continue;
      }
      for (const childId of node.childIds ?? []) {
        const child = byId.get(childId);
        if (child) {
          stack.push(child);
        }
      }
    }
    const text = collected.length > SIGNED_ITEM_NODES ? null : textSignature(collected);
    memo.set(index, text);
    return text;
  };
}

function repeatReader(axNodes: AXNode[], parents: Int32Array): (index: number) => boolean {
  const children = new Map<number, number[]>();
  parents.forEach((parent, index) => {
    if (parent >= 0) {
      const list = children.get(parent);
      if (list) {
        list.push(index);
      } else {
        children.set(parent, [index]);
      }
    }
  });
  const shapes = new Map<number, string>();
  const shape = (index: number): string => {
    let known = shapes.get(index);
    if (known === undefined) {
      const kids = children.get(index) ?? [];
      known =
        kids.length < 2
          ? ""
          : [index, ...kids].map((node) => axString(axNodes[node].role)).join(",");
      shapes.set(index, known);
    }
    return known;
  };
  const counts = new Map<number, Map<string, number>>();
  return (index) => {
    const own = shape(index);
    const parent = parents[index];
    if (own === "" || parent < 0) {
      return false;
    }
    let tally = counts.get(parent);
    if (!tally) {
      tally = new Map();
      for (const sibling of children.get(parent) ?? []) {
        const key = shape(sibling);
        tally.set(key, (tally.get(key) ?? 0) + 1);
      }
      counts.set(parent, tally);
    }
    return (tally.get(own) ?? 0) >= 2;
  };
}

function itemSignature(
  axNodes: AXNode[],
  parents: Int32Array,
  index: number,
  itemText: (index: number) => string | null,
  repeated: (index: number) => boolean,
): ItemSignature | null {
  for (let current = index; current >= 0; current = parents[current]) {
    const backendNodeId = axNodes[current].backendDOMNodeId;
    if (ITEM_ROLES.has(axString(axNodes[current].role)) && backendNodeId !== undefined) {
      const text = itemText(current);
      if (text !== null) {
        return { backendNodeId, text };
      }
      break;
    }
  }
  const own = itemText(index);
  if (own === null) {
    return null;
  }
  let current = parents[index];
  for (let level = 0; current >= 0 && level < CONTEXT_DEPTH; level++) {
    const backendNodeId = axNodes[current].backendDOMNodeId;
    const text = itemText(current);
    if (text === null) {
      return null;
    }
    const distinct = backendNodeId !== undefined && text !== "" && text !== own;
    if (distinct && repeated(current)) {
      return { backendNodeId, text };
    }
    if (text.length > CONTEXT_LIMIT) {
      return null;
    }
    if (distinct) {
      return { backendNodeId, text };
    }
    current = parents[current];
  }
  return null;
}

const EDITABLE = ["", "true", "plaintext-only"];

function secretField(dom: DomView, node: number): boolean {
  const tag = dom.tag(node);
  const concealed = dom.concealed(node);
  if (tag === "input" || tag === "textarea") {
    return concealed || dom.attribute(node, "type")?.toLowerCase() === "password";
  }
  const editing = dom.attribute(node, "contenteditable");
  return concealed && editing !== null && EDITABLE.includes(editing.toLowerCase());
}

function secretValue(dom: DomView, node: number): string {
  const tag = dom.tag(node);
  return tag === "input" || tag === "textarea" ? dom.inputValue(node) : dom.textContent(node);
}

export interface SecretScan {
  values: string[];
  within(backendNodeId: number): string[];
}

export async function scanSecrets(session: CDPSession): Promise<SecretScan> {
  const capture = await session
    .send("DOMSnapshot.captureSnapshot", { computedStyles: STYLES })
    .catch(() => null);
  const views = (capture?.documents ?? []).map(
    (document) => new DomView(document, capture!.strings),
  );
  const fields: Array<{ dom: DomView; node: number; value: string }> = [];
  for (const dom of views) {
    for (let node = 0; node < dom.size; node++) {
      if (dom.isElement(node) && secretField(dom, node)) {
        const value = secretValue(dom, node);
        if (value) {
          fields.push({ dom, node, value });
        }
      }
    }
  }
  return {
    values: fields.map((field) => field.value),
    within: (backendNodeId) => {
      for (const dom of views) {
        const root = dom.nodeOf(backendNodeId);
        if (root >= 0) {
          return fields
            .filter(
              (field) => field.dom === dom && field.node >= root && field.node < dom.end(root),
            )
            .map((field) => field.value);
        }
      }
      return [];
    },
  };
}

export async function secretsIn(session: CDPSession): Promise<string[]> {
  return (await scanSecrets(session)).values;
}

function readDom(capture: DomCapture | null, frameId: string): DomFacts {
  const facts: DomFacts = { affordances: new Map(), secrets: new Set(), secretValues: [] };
  const document = capture?.documents.find((doc) => capture.strings[doc.frameId] === frameId);
  if (!capture || !document) {
    return facts;
  }
  const dom = new DomView(document, capture.strings);
  const hidden = new Uint8Array(dom.size);
  let body = -1;
  for (let node = 0; node < dom.size; node++) {
    const parent = dom.parent(node);
    if (
      (parent >= 0 && hidden[parent]) ||
      dom.attribute(node, "hidden") !== null ||
      dom.attribute(node, "aria-hidden") === "true"
    ) {
      hidden[node] = 1;
    }
    if (!dom.isElement(node)) {
      continue;
    }
    const tag = dom.tag(node);
    if (body < 0 && tag === "body") {
      body = node;
    }
    const backendNodeId = dom.backendNodeId(node);
    if (backendNodeId !== undefined && secretField(dom, node)) {
      facts.secrets.add(backendNodeId);
      const value = secretValue(dom, node);
      if (value) {
        facts.secretValues.push(value);
      }
    }
  }
  if (body < 0) {
    return facts;
  }
  for (let node = body + 1; node < dom.end(body); node++) {
    if (!hidden[node]) {
      const backendNodeId = dom.backendNodeId(node);
      const affordance = backendNodeId === undefined ? null : affordanceOf(dom, node);
      if (affordance) {
        facts.affordances.set(backendNodeId!, affordance);
      }
    }
  }
  return facts;
}

function affordanceOf(dom: DomView, node: number): Affordance | null {
  if (!dom.isElement(node) || NATIVE_CONTROLS.has(dom.tag(node))) {
    return null;
  }
  const role = dom.attribute(node, "role")?.toLowerCase();
  if (role && CONTROL_ROLES.has(role)) {
    return null;
  }
  const pointer = dom.style(node, CURSOR) === "pointer";
  const onclick = dom.attribute(node, "onclick") !== null;
  const tabindex = dom.attribute(node, "tabindex");
  const focusable = tabindex !== null && tabindex !== "-1";
  const editing = dom.attribute(node, "contenteditable");
  const editable = editing === "" || editing === "true";
  if (!onclick && !focusable && !editable) {
    const parent = dom.parent(node);
    if (!pointer || (parent >= 0 && dom.style(parent, CURSOR) === "pointer")) {
      return null;
    }
  }
  const box = dom.box(node);
  if (!box || box[2] === 0 || box[3] === 0) {
    return null;
  }
  const hints = [
    pointer && "cursor:pointer",
    onclick && "onclick",
    focusable && "tabindex",
    editable && "contenteditable",
  ].filter((hint): hint is string => typeof hint === "string");
  const affordance: Affordance = {
    kind: pointer || onclick ? "clickable" : editable ? "editable" : "focusable",
    hints,
    text: dom.textWithin(node, AFFORDANCE_TEXT),
  };
  const toggle = dom.concealedToggle(node);
  if (toggle) {
    affordance.toggle = toggle;
  }
  return affordance;
}

class DomView {
  readonly size: number;
  private readonly layoutOf: Int32Array;
  private readonly ends: Int32Array;
  private readonly checked: Set<number>;
  private readonly values: Map<number, number>;

  constructor(
    private readonly document: DomDocument,
    private readonly strings: string[],
  ) {
    const parents = document.nodes.parentIndex ?? [];
    this.size = parents.length;
    this.layoutOf = new Int32Array(this.size).fill(-1);
    document.layout.nodeIndex.forEach((node, layout) => {
      if (this.layoutOf[node] < 0) {
        this.layoutOf[node] = layout;
      }
    });
    this.ends = new Int32Array(this.size);
    for (let node = this.size - 1; node >= 0; node--) {
      this.ends[node] = Math.max(this.ends[node], node + 1);
      const parent = parents[node];
      if (parent >= 0) {
        this.ends[parent] = Math.max(this.ends[parent], this.ends[node]);
      }
    }
    this.checked = new Set(document.nodes.inputChecked?.index ?? []);
    this.values = new Map(
      [document.nodes.inputValue, document.nodes.textValue].flatMap((data) =>
        (data?.index ?? []).map((node, at): [number, number] => [node, data!.value[at]]),
      ),
    );
  }

  inputValue(node: number): string {
    const value = this.values.get(node);
    return value === undefined ? "" : this.string(value);
  }

  nodeOf(backendNodeId: number): number {
    return this.document.nodes.backendNodeId?.indexOf(backendNodeId) ?? -1;
  }

  concealed(node: number): boolean {
    const security = this.style(node, TEXT_SECURITY);
    return !!security && security !== "none";
  }

  textContent(node: number): string {
    let text = "";
    for (let inner = node + 1; inner < this.ends[node]; inner++) {
      if (this.document.nodes.nodeType?.[inner] === 3) {
        text += this.string(this.document.nodes.nodeValue?.[inner]);
      }
    }
    return text;
  }

  end(node: number): number {
    return this.ends[node];
  }

  parent(node: number): number {
    return this.document.nodes.parentIndex?.[node] ?? -1;
  }

  isElement(node: number): boolean {
    return this.document.nodes.nodeType?.[node] === 1;
  }

  tag(node: number): string {
    return this.string(this.document.nodes.nodeName?.[node]).toLowerCase();
  }

  backendNodeId(node: number): number | undefined {
    return this.document.nodes.backendNodeId?.[node];
  }

  attribute(node: number, name: string): string | null {
    const pairs = this.document.nodes.attributes?.[node] ?? [];
    for (let index = 0; index + 1 < pairs.length; index += 2) {
      if (this.string(pairs[index]).toLowerCase() === name) {
        return this.string(pairs[index + 1]);
      }
    }
    return null;
  }

  style(node: number, slot: number): string | null {
    const layout = this.layoutOf[node];
    return layout < 0 ? null : this.string(this.document.layout.styles[layout]?.[slot]);
  }

  box(node: number): number[] | null {
    const layout = this.layoutOf[node];
    return layout < 0 ? null : this.document.layout.bounds[layout] ?? null;
  }

  textWithin(node: number, limit: number): string {
    let text = "";
    for (let inner = node + 1; inner < this.ends[node] && text.length <= limit * 10; inner++) {
      if (this.document.nodes.nodeType?.[inner] !== 3 || this.layoutOf[inner] < 0) {
        continue;
      }
      const value = this.string(this.document.nodes.nodeValue?.[inner]);
      if (!this.concealed(inner) && !this.concealed(this.parent(inner))) {
        text += value;
      } else if (value.trim() && !text.endsWith(SECRET_MASK)) {
        text += SECRET_MASK;
      }
    }
    return text.trim().slice(0, limit);
  }

  concealedToggle(node: number): Affordance["toggle"] | null {
    for (let inner = node + 1; inner < this.ends[node]; inner++) {
      if (!this.isElement(inner) || this.tag(inner) !== "input") {
        continue;
      }
      const type = this.attribute(inner, "type")?.toLowerCase();
      if (type !== "radio" && type !== "checkbox") {
        continue;
      }
      const concealed =
        this.layoutOf[inner] < 0 ||
        this.style(inner, VISIBILITY) === "hidden" ||
        this.attribute(inner, "hidden") !== null;
      return concealed ? { role: type, checked: this.checked.has(inner) ? "true" : "false" } : null;
    }
    return null;
  }

  private string(index: number | undefined): string {
    return index === undefined || index < 0 ? "" : this.strings[index] ?? "";
  }
}

function emit(
  node: Outline,
  indent: number,
  options: SnapshotOptions,
  lines: string[],
  shown: Outline[],
): boolean {
  const through = () =>
    node.children.reduce(
      (kept, child) => emit(child, indent, options, lines, shown) || kept,
      false,
    );
  if (
    (node.role === "generic" && !node.ref && node.size <= 1) ||
    (node.role === "StaticText" && normalizeName(node.name).trim() === "")
  ) {
    return through();
  }
  if (options.depth !== undefined && indent > options.depth) {
    return false;
  }
  if (
    node.role === "RootWebArea" ||
    node.role === "WebArea" ||
    (options.interactive && !node.ref)
  ) {
    return through();
  }
  const start = lines.length;
  const value = node.value && node.value !== node.name ? node.value : undefined;
  lines.push(lineOf(node, indent, options, value));
  if (node.ref !== undefined) {
    shown.push(node);
  }
  let kept = node.ref !== undefined || value !== undefined;
  for (const root of node.frame ?? []) {
    kept = emit(root, indent + 1, options, lines, shown) || kept;
  }
  for (const child of node.children) {
    kept = emit(child, indent + 1, options, lines, shown) || kept;
  }
  if (options.compact && !kept) {
    lines.length = start;
  }
  return kept;
}

function lineOf(
  node: Outline,
  indent: number,
  options: SnapshotOptions,
  value: string | undefined,
): string {
  const parts = [`${"  ".repeat(indent)}- ${node.role}`];
  const display = node.name || (options.interactive ? node.affordance?.text ?? "" : "");
  if (display) {
    parts.push(JSON.stringify(normalizeName(display)));
  }
  const marks = [
    node.level !== undefined && `level=${node.level}`,
    node.checked !== undefined && `checked=${node.checked}`,
    node.expanded !== undefined && `expanded=${node.expanded}`,
    node.selected && "selected",
    node.disabled && "disabled",
    node.required && "required",
    node.ref && `ref=${node.ref}`,
  ].filter((mark): mark is string => typeof mark === "string");
  if (marks.length > 0) {
    parts.push(`[${marks.join(", ")}]`);
  }
  if (node.affordance) {
    parts.push(`${node.affordance.kind} [${node.affordance.hints.join(", ")}]`);
  }
  const line = parts.join(" ");
  return value === undefined ? line : `${line}: ${value.replace(/\r\n|\r|\n/g, "\\n")}`;
}
