import type { CDPSession } from "puppeteer-core";
import { axString, normalizeName } from "./ax.js";
import { CommandError, withEffect } from "./errors.js";
import type { HeldKey, PressedButton } from "./tabs.js";
import { CONTROL_ROLES, scanSecrets } from "./snapshot.js";
import { hideSecrets, secretsNear, secretsWithin } from "./secrets.js";
import type { Element } from "./targets.js";

const ACTIVE = [
  "a[href]",
  "area[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  "label",
  "iframe",
  "[onclick]",
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
  ...[...CONTROL_ROLES].map((role) => `[role="${role}"]`),
].join(", ");

const CONTROLS = [
  "a[href]",
  "area[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  ...[...CONTROL_ROLES].map((role) => `[role="${role}"]`),
].join(", ");

let covers = 0;

const CONNECTED = `function () {
  return this.isConnected;
}`;

const REACHES = `function (hit) {
  const origin = hit instanceof Node ? hit : hit && hit.element;
  if (!origin) {
    return true;
  }
  const up = (node) => node.assignedSlot || node.parentNode || (node instanceof ShadowRoot ? node.host : null);
  const path = [];
  for (let node = origin; node; node = up(node)) {
    path.push(node);
  }
  if (path.includes(this)) {
    const control = path
      .slice(0, path.indexOf(this))
      .find((node) => node instanceof Element && node.matches(${JSON.stringify(CONTROLS)}));
    return !control || (this instanceof HTMLLabelElement && control === this.control);
  }
  const label = path.find((node) => node instanceof HTMLLabelElement);
  if (label && label.control === this) {
    return true;
  }
  const skipped = [];
  for (let node = this; node !== origin; node = up(node)) {
    if (!node) {
      return false;
    }
    skipped.push(node);
  }
  return (
    getComputedStyle(this).pointerEvents === "none" ||
    !skipped.some((node) => node instanceof Element && node.matches(${JSON.stringify(ACTIVE)}))
  );
}`;

const BLOCKER = `function (target) {
  const origin = this instanceof Node ? this : this.element;
  const up = (node) => node.assignedSlot || node.parentNode || (node instanceof ShadowRoot ? node.host : null);
  let control = null;
  for (let node = origin; node; node = up(node)) {
    if (node === target) {
      return control || origin;
    }
    if (!control && node instanceof Element && node.matches(${JSON.stringify(CONTROLS)})) {
      control = node;
    }
  }
  return origin;
}`;

const PLAIN_ROLES = new Set(["", "generic", "none", "presentation", "StaticText", "InlineTextBox"]);

export interface Watch {
  promise: Promise<void>;
  stop(): void;
}

export interface InputContext {
  inputTimeoutMs: number;
  blocked(): Watch;
  touch(): void;
  press(button: PressedButton | null): void;
  holdKey(key: HeldKey | null): void;
  release(): Promise<void>;
  halted(): boolean;
  crashed(): boolean;
  pause(ms: number): Promise<void>;
}

export interface Point {
  x: number;
  y: number;
}

interface FrameBox {
  origin: Point;
  across: Point;
  down: Point;
}

type MouseParams = {
  type: "mouseMoved" | "mousePressed" | "mouseReleased";
  x: number;
  y: number;
  button?: "left";
  buttons?: number;
  clickCount?: number;
};

export async function actionPoint(
  element: Element,
  touch: () => void,
  covered = true,
  scroll = true,
): Promise<Point> {
  const owners = await element.tab.owners(element.session);
  let moved = false;
  if (scroll) {
    const before = await placement(element, owners);
    for (const { session, owner } of owners) {
      touch();
      await session
        .send("DOM.scrollIntoViewIfNeeded", { backendNodeId: owner })
        .catch(() => undefined);
    }
    touch();
    await element.session
      .send("DOM.scrollIntoViewIfNeeded", { backendNodeId: element.backendNodeId })
      .catch(() => undefined);
    moved = before !== (await placement(element, owners));
  }
  try {
    const { points, scrolled } = await visiblePoints(element);
    let blocked: unknown = null;
    for (const point of points) {
      try {
        await checkPoint(element, owners, point, scrolled, true);
        return point;
      } catch (error) {
        if (!(error instanceof CommandError) || error.reason !== "covered") {
          throw error;
        }
        blocked ??= error;
      }
    }
    if (covered) {
      throw blocked;
    }
    return points[0];
  } catch (error) {
    throw moved ? withEffect(error, "applied") : error;
  }
}

async function placement(
  element: Element,
  owners: Array<{ session: CDPSession; owner: number }>,
): Promise<string> {
  const boxes = await Promise.all(
    [...owners, { session: element.session, owner: element.backendNodeId }].map(
      ({ session, owner }) =>
        session
          .send("DOM.getBoxModel", { backendNodeId: owner })
          .then(({ model }) => model.border)
          .catch(() => null),
    ),
  );
  return JSON.stringify(boxes);
}

export function attached(element: Element): Promise<boolean> {
  return element.session
    .send("Runtime.callFunctionOn", {
      objectId: element.objectId,
      functionDeclaration: CONNECTED,
      returnByValue: true,
    })
    .then(({ result }) => result.value === true)
    .catch(() => false);
}

export async function confirmTarget(element: Element, point: Point): Promise<void> {
  await element.recheck?.().catch((error) => {
    throw withEffect(error, "applied");
  });
  if (!(await attached(element))) {
    throw new CommandError(
      "stale_ref",
      `${element.label} left the page when the mouse moved onto it. Take a new snapshot.`,
      "detached",
      "applied",
    );
  }
  const owners = await element.tab.owners(element.session);
  const { cssLayoutViewport } = await element.session.send("Page.getLayoutMetrics");
  await checkPoint(
    element,
    owners,
    point,
    { x: cssLayoutViewport.pageX, y: cssLayoutViewport.pageY },
    true,
    true,
  );
}

export async function inPage(element: Element, points: Point[]): Promise<Point[]> {
  const owners = await element.tab.owners(element.session);
  if (owners.length === 0) {
    return points;
  }
  const frames = await frameBoxes(element, owners);
  return points.map((point) => throughFrames(frames, point)[0]);
}

async function frameBoxes(
  element: Element,
  owners: Array<{ session: CDPSession; owner: number }>,
): Promise<FrameBox[]> {
  const frames: FrameBox[] = [];
  for (const { session, owner } of owners) {
    const model = await session
      .send("DOM.getBoxModel", { backendNodeId: owner })
      .then(({ model }) => model)
      .catch(() => null);
    if (!model || !model.width || !model.height) {
      throw new CommandError(
        "not_actionable",
        `${element.label} is in a frame that has no visible box.`,
        "no_box",
      );
    }
    const [x1, y1, x2, y2, , , x4, y4] = model.border;
    frames.push({
      origin: { x: model.content[0], y: model.content[1] },
      across: { x: (x2 - x1) / model.width, y: (y2 - y1) / model.width },
      down: { x: (x4 - x1) / model.height, y: (y4 - y1) / model.height },
    });
  }
  return frames;
}

function throughFrames(frames: FrameBox[], point: Point): Point[] {
  const points: Point[] = [];
  let mapped = point;
  for (let index = frames.length - 1; index >= 0; index--) {
    const { origin, across, down } = frames[index];
    mapped = {
      x: origin.x + mapped.x * across.x + mapped.y * down.x,
      y: origin.y + mapped.x * across.y + mapped.y * down.y,
    };
    points[index] = mapped;
  }
  return points;
}

async function checkPoint(
  element: Element,
  owners: Array<{ session: CDPSession; owner: number }>,
  point: Point,
  scrolled: Point,
  covered: boolean,
  strict = false,
): Promise<void> {
  const points = throughFrames(await frameBoxes(element, owners), point).map((mapped) => ({
    x: Math.round(mapped.x),
    y: Math.round(mapped.y),
  }));
  const top = points[0];
  if (top) {
    const { cssLayoutViewport } = await owners[0].session.send("Page.getLayoutMetrics");
    if (
      top.x < 0 ||
      top.y < 0 ||
      top.x > cssLayoutViewport.clientWidth ||
      top.y > cssLayoutViewport.clientHeight
    ) {
      throw new CommandError(
        "not_actionable",
        `${element.label} is outside the visible part of the page.`,
        "offscreen",
      );
    }
  }
  if (covered) {
    for (const [index, { session, owner }] of owners.entries()) {
      const blocker = await ownerCovered(session, owner, points[index]);
      if (blocker) {
        throw coveredError(element, blocker);
      }
    }
    const blocker = await coverAt(
      element,
      {
        x: Math.round(point.x + scrolled.x),
        y: Math.round(point.y + scrolled.y),
      },
      strict,
    );
    if (blocker) {
      throw coveredError(element, blocker);
    }
  }
}

async function ownerCovered(session: CDPSession, owner: number, at: Point): Promise<string | null> {
  const { cssLayoutViewport } = await session.send("Page.getLayoutMetrics");
  const hit = await session
    .send("DOM.getNodeForLocation", {
      x: Math.round(at.x + cssLayoutViewport.pageX),
      y: Math.round(at.y + cssLayoutViewport.pageY),
      includeUserAgentShadowDOM: false,
    })
    .catch(() => null);
  return hit && hit.backendNodeId !== owner ? describe(session, hit.backendNodeId) : null;
}

function coveredError(element: Element, blocker: string): CommandError {
  return new CommandError(
    "not_actionable",
    `${element.label} is covered by ${blocker} at its click point. Dismiss or interact with the covering element first.`,
    "covered",
  );
}

const SAMPLES: Array<[number, number]> = [
  [0.5, 0.25],
  [0.5, 0.75],
  [0.25, 0.5],
  [0.75, 0.5],
  [0.25, 0.25],
  [0.75, 0.25],
  [0.25, 0.75],
  [0.75, 0.75],
];

const MAX_POINTS = 9;

async function visiblePoints(element: Element): Promise<{ points: Point[]; scrolled: Point }> {
  const quads = await element.session
    .send("DOM.getContentQuads", { backendNodeId: element.backendNodeId })
    .then(({ quads }) => quads)
    .catch(() => []);
  if (quads.length === 0) {
    throw new CommandError("not_actionable", `${element.label} has no visible box.`, "no_box");
  }
  const { cssLayoutViewport } = await element.session.send("Page.getLayoutMetrics");
  const pieces: Array<{ left: number; right: number; top: number; bottom: number; area: number }> =
    [];
  for (const quad of quads) {
    const xs = [quad[0], quad[2], quad[4], quad[6]];
    const ys = [quad[1], quad[3], quad[5], quad[7]];
    const left = Math.max(Math.min(...xs), 0);
    const right = Math.min(Math.max(...xs), cssLayoutViewport.clientWidth);
    const top = Math.max(Math.min(...ys), 0);
    const bottom = Math.min(Math.max(...ys), cssLayoutViewport.clientHeight);
    const area = Math.max(right - left, 0) * Math.max(bottom - top, 0);
    if (area > 0) {
      pieces.push({ left, right, top, bottom, area });
    }
  }
  if (pieces.length === 0) {
    throw new CommandError(
      "not_actionable",
      `${element.label} is outside the visible part of the page.`,
      "offscreen",
    );
  }
  pieces.sort((a, b) => b.area - a.area);
  const points: Point[] = [];
  const add = (x: number, y: number) => {
    const point = { x: Math.round(x), y: Math.round(y) };
    if (!points.some((other) => other.x === point.x && other.y === point.y)) {
      points.push(point);
    }
  };
  for (const piece of pieces) {
    add((piece.left + piece.right) / 2, (piece.top + piece.bottom) / 2);
  }
  const [largest] = pieces;
  for (const [across, down] of SAMPLES) {
    add(
      largest.left + (largest.right - largest.left) * across,
      largest.top + (largest.bottom - largest.top) * down,
    );
  }
  return {
    points: points.slice(0, MAX_POINTS),
    scrolled: { x: cssLayoutViewport.pageX, y: cssLayoutViewport.pageY },
  };
}

async function coverAt(element: Element, spot: Point, strict = false): Promise<string | null> {
  const { session } = element;
  const group = `steel-cover-${++covers}`;
  const unverified = () =>
    new CommandError(
      "not_actionable",
      `${element.label} could not be checked again at its click point. Take a new snapshot.`,
      "unverified",
      "applied",
    );
  const hit = await session
    .send("DOM.getNodeForLocation", { ...spot, includeUserAgentShadowDOM: false })
    .catch(() => null);
  if (!hit) {
    if (strict) {
      throw unverified();
    }
    return null;
  }
  if (hit.backendNodeId === element.backendNodeId) {
    return null;
  }
  if (hit.frameId && hit.frameId !== element.frameId) {
    return (await framedIn(element, hit.frameId)) ? null : describe(session, hit.backendNodeId);
  }
  try {
    const { object } = await session.send("DOM.resolveNode", {
      backendNodeId: hit.backendNodeId,
      executionContextId: element.contextId,
      objectGroup: group,
    });
    const { result, exceptionDetails } = await session.send("Runtime.callFunctionOn", {
      objectId: element.objectId,
      functionDeclaration: REACHES,
      arguments: [{ objectId: object.objectId }],
      returnByValue: true,
    });
    if (exceptionDetails || result.value !== false) {
      return null;
    }
    const { result: origin } = await session.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: BLOCKER,
      arguments: [{ objectId: element.objectId }],
      objectGroup: group,
    });
    const { node } = await session.send("DOM.describeNode", { objectId: origin.objectId });
    return describe(session, node.backendNodeId);
  } catch {
    if (strict) {
      throw unverified();
    }
    return null;
  } finally {
    await session.send("Runtime.releaseObjectGroup", { objectGroup: group }).catch(() => undefined);
  }
}

async function framedIn(element: Element, frameId: string): Promise<boolean> {
  const { node } = await element.session
    .send("DOM.describeNode", { backendNodeId: element.backendNodeId })
    .catch(() => ({ node: null }));
  const owned = node?.frameId;
  if (!owned) {
    return false;
  }
  const { frameTree } = await element.session.send("Page.getFrameTree");
  const find = (tree: typeof frameTree, id: string): typeof frameTree | undefined =>
    tree.frame.id === id
      ? tree
      : (tree.childFrames ?? []).map((child) => find(child, id)).find(Boolean);
  const inner = find(frameTree, owned);
  return inner !== undefined && find(inner, frameId) !== undefined;
}

async function describe(session: CDPSession, backendNodeId: number): Promise<string> {
  const { node } = await session
    .send("DOM.describeNode", { backendNodeId })
    .catch(() => ({ node: null }));
  const attributes = new Map<string, string>();
  for (let index = 0; index + 1 < (node?.attributes?.length ?? 0); index += 2) {
    attributes.set(node!.attributes![index], node!.attributes![index + 1]);
  }
  const classes = (attributes.get("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 3);
  const tag = `<${node?.localName || "element"}${
    attributes.has("id") ? ` id="${attributes.get("id")}"` : ""
  }${classes.length > 0 ? ` class="${classes.join(" ")}"` : ""}>`;
  const ax = await session
    .send("Accessibility.getPartialAXTree", { backendNodeId, fetchRelatives: false })
    .then(({ nodes }) => nodes.find((candidate) => candidate.backendDOMNodeId === backendNodeId))
    .catch(() => undefined);
  const role = ax && !ax.ignored ? axString(ax.role) : "";
  if (PLAIN_ROLES.has(role)) {
    return tag;
  }
  const name = normalizeName(axString(ax?.name)).trim();
  const scan = name ? await scanSecrets(session) : null;
  const shown = scan
    ? hideSecrets(
        hideSecrets(name, [...(await secretsNear(session, backendNodeId)), ...scan.values]),
        [...(await secretsWithin(session, backendNodeId)), ...scan.within(backendNodeId)],
        1,
      )
    : "";
  return `${role}${shown ? ` ${JSON.stringify(shown)}` : ""} (${tag})`;
}

export async function click(
  context: InputContext,
  session: CDPSession,
  point: Point,
  confirm: () => Promise<void>,
  clickCount = 1,
): Promise<boolean> {
  context.touch();
  if (await input(context, session, { type: "mouseMoved", ...point }, "unknown")) {
    throw dialogBefore("click");
  }
  await confirm().catch((error) => {
    throw withEffect(error, "applied");
  });
  context.touch();
  for (let count = 1; count <= clickCount; count++) {
    const opened = await input(
      context,
      session,
      { type: "mousePressed", ...point, button: "left", buttons: 1, clickCount: count },
      "unknown",
    );
    if (opened) {
      return true;
    }
    const released = await input(
      context,
      session,
      { type: "mouseReleased", ...point, button: "left", buttons: 0, clickCount: count },
      "unknown",
    );
    if (released) {
      return true;
    }
  }
  return false;
}

export async function hover(
  context: InputContext,
  session: CDPSession,
  point: Point,
): Promise<boolean> {
  context.touch();
  return input(context, session, { type: "mouseMoved", ...point }, "unknown");
}

export async function drag(
  context: InputContext,
  session: CDPSession,
  from: Point,
  to: Point,
  confirm: () => Promise<void>,
  steps = 5,
): Promise<boolean> {
  context.touch();
  if (await input(context, session, { type: "mouseMoved", ...from }, "unknown")) {
    throw dialogBefore("drag");
  }
  await confirm().catch((error) => {
    throw withEffect(error, "applied");
  });
  context.touch();
  const opened = await input(
    context,
    session,
    { type: "mousePressed", ...from, button: "left", buttons: 1, clickCount: 1 },
    "unknown",
  );
  if (opened) {
    return true;
  }
  for (let step = 1; step <= steps; step++) {
    const x = from.x + ((to.x - from.x) * step) / steps;
    const y = from.y + ((to.y - from.y) * step) / steps;
    const moved = await input(
      context,
      session,
      { type: "mouseMoved", x, y, button: "left", buttons: 1 },
      "unknown",
    );
    if (moved) {
      return true;
    }
  }
  return input(
    context,
    session,
    { type: "mouseReleased", ...to, button: "left", buttons: 0, clickCount: 1 },
    "unknown",
  );
}

export async function bounded<T>(
  promise: Promise<T>,
  ms: number,
  error: () => CommandError,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(error()), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function sendOrDialog(
  context: InputContext,
  send: Promise<unknown>,
  error: () => CommandError,
  effectOnFailure: "none" | "unknown",
  what: string,
): Promise<boolean> {
  const watch = context.blocked();
  const crashed = () =>
    new CommandError(
      "tab_crashed",
      `The tab crashed during the ${what} input. Navigate or reload it to start it again, or open a new tab.`,
      undefined,
      effectOnFailure,
    );
  try {
    const opened = await bounded(
      Promise.race([send.then(() => false), watch.promise.then(() => true)]),
      context.inputTimeoutMs,
      error,
    );
    if (opened && context.crashed()) {
      throw crashed();
    }
    return opened;
  } catch (failure) {
    if (failure instanceof CommandError) {
      throw failure;
    }
    if (context.crashed()) {
      throw crashed();
    }
    throw new CommandError(
      "internal_error",
      `The ${what} input failed: ${(failure as Error).message}`,
      "input",
      effectOnFailure,
    );
  } finally {
    watch.stop();
  }
}

function dialogBefore(action: "click" | "drag"): CommandError {
  return new CommandError(
    "dialog_pending",
    `A dialog opened when the mouse moved onto the element, before the ${action}. Answer it with the dialog command, then ${action} again.`,
    `before_${action}`,
    "applied",
  );
}

function letGo(context: InputContext) {
  void context.release().catch(() => undefined);
}

async function input(
  context: InputContext,
  session: CDPSession,
  params: MouseParams,
  effectOnFailure: "none" | "unknown",
): Promise<boolean> {
  if (params.type === "mouseReleased") {
    context.press(null);
  } else if (context.halted()) {
    letGo(context);
    throw new CommandError(
      "cancelled",
      "The mouse input stopped because its execution ended.",
      "halted",
      effectOnFailure,
    );
  } else if (params.buttons) {
    context.press({ session, x: params.x, y: params.y });
  }
  try {
    return await sendOrDialog(
      context,
      session.send("Input.dispatchMouseEvent", params),
      () =>
        new CommandError(
          "timeout",
          `The page did not take the ${params.type} input in time.`,
          "input",
          effectOnFailure,
        ),
      effectOnFailure,
      params.type,
    );
  } catch (error) {
    letGo(context);
    throw error;
  }
}
