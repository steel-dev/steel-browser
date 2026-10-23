import { ProtocolError } from "puppeteer-core";
import type { Command } from "../commands.js";
import { CommandError } from "../errors.js";
import type { CommandResult } from "../records.js";
import {
  ATTRIBUTE,
  ENABLED,
  HTML,
  networkIdle,
  PAGE_TEXT,
  READY_STATE,
  TEXT,
  urlMatches,
  VALUE,
  VISIBLE,
} from "../reads.js";
import { parseRef } from "../refs.js";
import { secretsIn } from "../snapshot.js";
import { hideSecrets, htmlForms, SECRET_VALUES } from "../secrets.js";
import type { Job } from "../session.js";
import type { Tab } from "../tabs.js";
import { inPage } from "../pointer.js";
import { asLocator, callIn, callOn, locate } from "../targets.js";
import {
  activate,
  element,
  ending,
  halted,
  scopeFor,
  sleep,
  tabFor,
  touch,
  usable,
  useTab,
  type Context,
} from "./context.js";
import { toggleState } from "./elements.js";

const WAIT_TIMEOUT_MS = 10_000;

const WAIT_POLL_MS = 100;

const NETWORK_QUIET_MS = 500;

const MAX_SCREENSHOT_HEIGHT = 16_384;

export async function get(
  ctx: Context,
  command: Extract<Command, { command: "get" }>,
): Promise<CommandResult> {
  const { active, job } = ctx;
  if (command.what === "title" || command.what === "url") {
    const tab = active.tabs.resolve(command.tab);
    useTab(ctx, tab.id);
    const info = await active.tabs.info(tab);
    return { ok: true, effect: "none", value: command.what === "url" ? info.url : info.title };
  }
  if (command.target === undefined) {
    throw new CommandError("invalid_argument", `get ${command.what} needs a target.`);
  }
  if (command.what === "count") {
    const locator = asLocator(command.target);
    if (!locator) {
      throw new CommandError("invalid_argument", "get count needs a locator or a CSS selector.");
    }
    const tab = tabFor(ctx, command.tab);
    const scope = await scopeFor(ctx, tab, command.frame);
    const { nth: _, ...all } = locator;
    return { ok: true, effect: "none", value: (await locate(scope, all)).length };
  }
  if (command.what === "attr" && !command.attribute) {
    throw new CommandError("invalid_argument", "get attr needs an attribute name.");
  }
  const target = await element(ctx, { ...command, target: command.target });
  switch (command.what) {
    case "text":
    case "html": {
      const value = await callOn<string>(target, command.what === "text" ? TEXT : HTML);
      const secrets = [
        ...(await callOn<string[]>(target, SECRET_VALUES).catch(() => [])),
        ...(await secretsIn(target.session)),
      ];
      return {
        ok: true,
        effect: "none",
        value: hideSecrets(value, command.what === "html" ? htmlForms(secrets) : secrets),
      };
    }
    case "attr": {
      const result = await callOn<{ value?: string | null; masked?: boolean }>(target, ATTRIBUTE, [
        command.attribute,
      ]);
      return result.masked
        ? { ok: true, effect: "none", value: null, masked: true }
        : { ok: true, effect: "none", value: result.value };
    }
    case "value": {
      const result = await callOn<{ value?: string | null; masked?: boolean }>(target, VALUE);
      return result.masked
        ? { ok: true, effect: "none", value: null, masked: true }
        : { ok: true, effect: "none", value: result.value };
    }
    case "box": {
      const border = await target.session
        .send("DOM.getBoxModel", { backendNodeId: target.backendNodeId })
        .then(({ model }) => model.border)
        .catch(() => null);
      const corners = border
        ? await inPage(
            target,
            [0, 2, 4, 6].map((at) => ({ x: border[at], y: border[at + 1] })),
          ).catch(() => null)
        : null;
      if (!corners) {
        return { ok: true, effect: "none", value: null };
      }
      const xs = corners.map((corner) => corner.x);
      const ys = corners.map((corner) => corner.y);
      return {
        ok: true,
        effect: "none",
        value: {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
        },
      };
    }
  }
}

export async function is(
  ctx: Context,
  command: Extract<Command, { command: "is" }>,
): Promise<CommandResult> {
  const target = await element(ctx, command).catch((error) => {
    if (
      command.what === "visible" &&
      error instanceof CommandError &&
      error.code === "element_not_found"
    ) {
      return null;
    }
    throw error;
  });
  if (!target) {
    return { ok: true, effect: "none", value: false };
  }
  if (command.what === "checked") {
    return { ok: true, effect: "none", value: (await toggleState(target))?.checked === true };
  }
  const script = command.what === "visible" ? VISIBLE : ENABLED;
  return { ok: true, effect: "none", value: await callOn<boolean>(target, script) };
}

export async function wait(
  ctx: Context,
  command: Extract<Command, { command: "wait" }>,
): Promise<CommandResult> {
  const { active, job } = ctx;
  const modes = [command.target, command.text, command.url, command.load, command.ms].filter(
    (mode) => mode !== undefined,
  );
  if (modes.length !== 1) {
    throw new CommandError(
      "invalid_argument",
      "wait needs exactly one of target, text, url, load, or ms.",
    );
  }
  if (command.state !== undefined && command.target === undefined) {
    throw new CommandError("invalid_argument", "state works only with target.");
  }
  if (command.ms !== undefined) {
    const watched =
      command.tab !== undefined || active.tabs.list().length === 1
        ? active.tabs.resolve(command.tab)
        : undefined;
    if (watched) {
      useTab(ctx, watched.id);
    }
    await sleep(ctx, command.ms, () => watched?.closed === true);
    if (halted(job)) {
      throw waitTimeout(job, command.ms, "the time to pass");
    }
    if (watched?.closed) {
      throw closedDuringWait(watched);
    }
    return { ok: true, effect: "none", waited: "ms" };
  }
  const timeout = command.timeout ?? WAIT_TIMEOUT_MS;
  const until = ctx.now() + timeout;
  const ref = typeof command.target === "string" ? parseRef(command.target) : null;
  const tab = ref
    ? active.tabs.get(active.refs.get(ref)?.tabId ?? "")
    : usable(ctx, active.tabs.resolve(command.tab));
  if (tab) {
    useTab(ctx, tab.id);
  }
  const satisfied = async (): Promise<boolean> => {
    if (tab?.closed) {
      throw closedDuringWait(tab);
    }
    if (command.target !== undefined) {
      const state = command.state ?? "visible";
      const target = await element(ctx, {
        ...command,
        target: command.target,
        tab: ref ? command.tab : tab!.id,
      }).catch((error) => {
        if (
          error instanceof CommandError &&
          (error.code === "element_not_found" ||
            (error.code === "stale_ref" &&
              (error.reason === "detached" || error.reason === "content_changed")))
        ) {
          return null;
        }
        throw error;
      });
      if (state === "detached") {
        return target === null;
      }
      if (state === "attached") {
        return target !== null;
      }
      const visible = target ? await callOn<boolean>(target, VISIBLE) : false;
      return state === "visible" ? visible : !visible;
    }
    const current = usable(ctx, tab!);
    if (command.url !== undefined) {
      return urlMatches(command.url, (await active.tabs.info(current)).url);
    }
    const scope = await scopeFor(ctx, current, command.frame);
    if (command.text !== undefined) {
      return callIn<boolean>(scope, PAGE_TEXT, [command.text]);
    }
    if (current.navigating) {
      return false;
    }
    const state = await callIn<string>(scope, READY_STATE);
    return command.load === "domcontentloaded" ? state !== "loading" : state === "complete";
  };
  const check = () =>
    satisfied().catch((error) => {
      if (
        error instanceof ProtocolError ||
        (error instanceof CommandError && error.code === "dialog_pending")
      ) {
        return false;
      }
      throw error;
    });
  while (!(await check())) {
    if (ctx.now() >= until || ending(ctx)) {
      throw waitTimeout(job, timeout, "the condition");
    }
    await sleep(ctx, WAIT_POLL_MS);
  }
  if (command.load === "networkidle") {
    const page = await usable(ctx, tab!).ready();
    const closed = () => tab!.closed || page.isClosed();
    const quiet = await networkIdle(
      page,
      NETWORK_QUIET_MS,
      until - ctx.now(),
      () => ending(ctx) || closed(),
    ).catch((error) => {
      if (!closed()) {
        throw error;
      }
      return false;
    });
    if (closed()) {
      throw closedDuringWait(tab!);
    }
    if (!quiet) {
      throw waitTimeout(job, timeout, "the network to go quiet");
    }
  }
  return {
    ok: true,
    effect: "none",
    waited:
      command.target !== undefined
        ? "target"
        : command.text !== undefined
        ? "text"
        : command.url !== undefined
        ? "url"
        : "load",
  };
}

function closedDuringWait(tab: Tab): CommandError {
  return new CommandError("tab_not_found", `Tab ${tab.id} closed while the wait was running.`);
}

function waitTimeout(job: Job, timeout: number, what: string): CommandError {
  if (halted(job)) {
    return new CommandError("cancelled", "The wait stopped because the execution ended.");
  }
  return new CommandError(
    "timeout",
    `Waited ${timeout / 1000} seconds for ${what}, but it did not happen.`,
    "wait",
  );
}

export async function screenshot(
  ctx: Context,
  command: Extract<Command, { command: "screenshot" }>,
): Promise<CommandResult> {
  const format = command.format ?? "png";
  let tab: Tab;
  let clip: { x: number; y: number; width: number; height: number; scale: number } | undefined;
  let beyond = false;
  let moved = false;
  if (command.target !== undefined) {
    const target = await element(ctx, { ...command, target: command.target });
    tab = target.tab;
    const session = await tab.session();
    if (target.session !== session) {
      throw new CommandError(
        "not_actionable",
        "Screenshots of elements inside cross-origin frames are not supported. Take a screenshot of the page.",
        "cross_origin_frame",
      );
    }
    await activate(ctx, tab);
    const border = () =>
      session
        .send("DOM.getBoxModel", { backendNodeId: target.backendNodeId })
        .then(({ model }) => model.border)
        .catch(() => null);
    const before = await border();
    touch(ctx);
    await session
      .send("DOM.scrollIntoViewIfNeeded", { backendNodeId: target.backendNodeId })
      .catch(() => undefined);
    const box = await border();
    if (!box) {
      throw new CommandError("not_actionable", `${target.label} has no visible box.`, "no_box");
    }
    moved = before !== null && (before[0] !== box[0] || before[1] !== box[1]);
    const { cssVisualViewport } = await session.send("Page.getLayoutMetrics");
    beyond = true;
    const xs = [box[0], box[2], box[4], box[6]];
    const ys = [box[1], box[3], box[5], box[7]];
    clip = {
      x: Math.min(...xs) + cssVisualViewport.pageX,
      y: Math.min(...ys) + cssVisualViewport.pageY,
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      scale: 1,
    };
  } else {
    tab = tabFor(ctx, command.tab);
    await activate(ctx, tab);
    if (command.fullPage) {
      const { cssContentSize } = await (await tab.session()).send("Page.getLayoutMetrics");
      clip = {
        x: 0,
        y: 0,
        width: cssContentSize.width,
        height: Math.min(cssContentSize.height, MAX_SCREENSHOT_HEIGHT),
        scale: 1,
      };
      beyond = true;
    }
  }
  const { data } = await (
    await tab.session()
  ).send("Page.captureScreenshot", {
    format,
    ...(format !== "png" && command.quality !== undefined ? { quality: command.quality } : {}),
    ...(clip ? { clip } : {}),
    captureBeyondViewport: beyond,
    fromSurface: true,
  });
  return { ok: true, effect: moved ? "applied" : "none", format, data };
}

export async function pdf(
  ctx: Context,
  command: Extract<Command, { command: "pdf" }>,
): Promise<CommandResult> {
  const tab = tabFor(ctx, command.tab);
  const session = await tab.session();
  try {
    const { data } = await session.send("Page.printToPDF", {
      landscape: command.landscape ?? false,
      printBackground: command.printBackground ?? false,
    });
    return { ok: true, effect: "none", format: "pdf", data };
  } catch (error) {
    throw new CommandError(
      "not_actionable",
      `This browser cannot print the page to PDF: ${(error as Error).message}`,
      "unsupported",
    );
  }
}
