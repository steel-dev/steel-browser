import type { Page } from "puppeteer-core";
import { describeDialog, type Dialog } from "../dialogs.js";
import { CommandError } from "../errors.js";
import type { InputContext, Watch } from "../pointer.js";
import { isFinal } from "../records.js";
import { parseRef } from "../refs.js";
import { navigationError } from "../results.js";
import {
  KEPT_SNAPSHOTS,
  STEP_MS,
  type ActiveSession,
  type EngineHost,
  type EngineLimits,
  type Job,
} from "../session.js";
import { takeSnapshot, type FrameHandle, type SnapshotOptions } from "../snapshot.js";
import type { Tab, TabInfo } from "../tabs.js";
import {
  asLocator,
  frameScope,
  mainScope,
  resolveLocator,
  resolveRef,
  type Element,
  type Expectation,
  type Scope,
  type Target,
} from "../targets.js";

export interface Context {
  active: ActiveSession;
  job: Job;
  host: EngineHost;
  limits: EngineLimits;
  now: () => number;
  group: string;
  abandoned?: boolean;
}

export function openDialogOn(active: ActiveSession, tabId?: string): Dialog | undefined {
  for (const dialog of active.dialogs.values()) {
    if (dialog.open && dialog.tab === tabId) {
      return dialog;
    }
  }
  return undefined;
}

export function usable(ctx: Context, tab: Tab, crashed = false): Tab {
  if (tab.closed) {
    throw new CommandError("tab_not_found", `Tab ${tab.id} is closed.`);
  }
  if (tab.crashed && !crashed) {
    throw crashedTab(tab);
  }
  if (!tab.blocking) {
    return tab;
  }
  const dialog = openDialogOn(ctx.active, tab.id);
  throw new CommandError(
    "dialog_pending",
    dialog
      ? `Tab ${tab.id} shows ${dialog.type} dialog ${dialog.id}: "${dialog.message}". Answer it with the dialog command, then send the command again.`
      : `Tab ${tab.id} shows a dialog. Answer it, then send the command again.`,
  );
}

export function useTab(ctx: Context, tabId: string) {
  ctx.job.execution.tab = tabId;
  ctx.job.tab = tabId;
  ctx.job.tabs.add(tabId);
}

export function tabFor(ctx: Context, tabId?: string, crashed = false): Tab {
  const tab = ctx.active.tabs.resolve(tabId);
  useTab(ctx, tab.id);
  return usable(ctx, tab, crashed);
}

export function crashedTab(tab: Tab): CommandError {
  return new CommandError(
    "tab_crashed",
    `Tab ${tab.id} crashed. Navigate or reload it to start it again, or open a new tab.`,
  );
}

export function dialogNote(
  active: ActiveSession,
  tab?: Tab,
): { dialog?: ReturnType<typeof describeDialog> } {
  const dialog = tab?.blocking ? openDialogOn(active, tab.id) : undefined;
  return dialog ? { dialog: describeDialog(dialog) } : {};
}

export function watchBlocking(tab: Tab, crashes = true): Watch {
  let stop = () => {};
  const promise = new Promise<void>((resolve) => {
    stop = tab.onBlocking(() => {
      if (!crashes && !tab.blocking) {
        return;
      }
      stop();
      resolve();
    });
    if (tab.blocking || (crashes && tab.crashed)) {
      stop();
      resolve();
    }
  });
  return { promise, stop: () => stop() };
}

export function scopeFor(ctx: Context, tab: Tab, frame?: string): Promise<Scope> {
  return frame ? frameScope(tab, ctx.active.refs, frame, ctx.group) : mainScope(tab, ctx.group);
}

export function touch(ctx: Context) {
  if (ending(ctx)) {
    throw stopped(ctx);
  }
  ctx.job.touched = true;
}

export async function activate(ctx: Context, tab: Tab) {
  if (ending(ctx)) {
    throw stopped(ctx);
  }
  await tab.activate().catch((error: Error) => {
    throw new CommandError(
      "internal_error",
      `Tab ${tab.id} could not be brought to the front: ${error.message}`,
      "activate",
    );
  });
}

export function inputs(ctx: Context, tab: Tab): InputContext {
  return {
    inputTimeoutMs: ctx.limits.inputTimeoutMs,
    blocked: () => watchBlocking(tab),
    touch: () => touch(ctx),
    press: (button) => {
      tab.pressed = button;
    },
    holdKey: (key) => {
      tab.key = key;
    },
    release: () => tab.release(),
    halted: () => ending(ctx),
    crashed: () => tab.crashed && !tab.blocking,
    pause: (ms) => sleep(ctx, ms),
  };
}

export async function element(
  ctx: Context,
  command: { target: Target; tab?: string; frame?: string; expect?: Expectation },
): Promise<Element> {
  const { active } = ctx;
  const ref = typeof command.target === "string" ? parseRef(command.target) : null;
  if (!ref) {
    const tab = tabFor(ctx, command.tab);
    const scope = await scopeFor(ctx, tab, command.frame);
    return resolveLocator(scope, asLocator(command.target)!, command.expect);
  }
  if (command.frame) {
    throw new CommandError(
      "invalid_argument",
      `Ref ${ref} already knows its frame. Pass frame only with a locator.`,
    );
  }
  const entry = active.refs.get(ref);
  if (!entry) {
    const reason = active.refs.missing(ref);
    throw new CommandError(
      "stale_ref",
      reason === "browser_restarted"
        ? `Ref ${ref} is from before the browser restarted. Run tab list and take a new snapshot.`
        : `Ref ${ref} is not known. Take a new snapshot.`,
      reason,
    );
  }
  if (command.tab && command.tab !== entry.tabId) {
    throw new CommandError(
      "invalid_argument",
      `Ref ${ref} belongs to tab ${entry.tabId}, not ${command.tab}.`,
    );
  }
  useTab(ctx, entry.tabId);
  const tab = active.tabs.get(entry.tabId);
  if (!tab || tab.closed) {
    throw new CommandError(
      "stale_ref",
      `Ref ${ref} was in tab ${entry.tabId}, which is closed. Take a new snapshot.`,
      "detached",
    );
  }
  usable(ctx, tab);
  await tab.session();
  return resolveRef(tab, entry, ctx.group, command.expect);
}

export async function load(ctx: Context, tab: Tab, loading: Promise<unknown>) {
  loading.catch(() => undefined);
  if (
    (await waitWithin(
      ctx,
      loading.then(() => true),
      Infinity,
    )) === undefined
  ) {
    const { state } = ctx.job.execution;
    if (ctx.job.cancelled || state === "cancelled" || state === "timeout") {
      await tab.stopLoading().catch(() => undefined);
    }
    throw stopped(ctx);
  }
}

export async function goto(ctx: Context, tab: Tab, url: string): Promise<Page> {
  const page = await tab.navigable();
  touch(ctx);
  try {
    await load(
      ctx,
      tab,
      page.goto(url, { waitUntil: "load", timeout: ctx.limits.navigationTimeoutMs }),
    );
  } catch (error) {
    throw navigationError(error, url, ctx.limits.navigationTimeoutMs);
  }
  return page;
}

export async function capture(
  active: ActiveSession,
  tab: Tab,
  options: SnapshotOptions,
  current: () => boolean,
  readMs: number,
) {
  const session = await tab.session();
  const { frameTree } = await session.send("Page.getFrameTree");
  const main: FrameHandle = {
    tabId: tab.id,
    frameId: frameTree.frame.id,
    session,
    sessionKey: session.id(),
    root: true,
  };
  const snapshot = await takeSnapshot(
    main,
    {
      child: (parent, frameId) => {
        const child = tab.frameSession(frameId);
        return child
          ? { tabId: tab.id, frameId, session: child, sessionKey: child.id(), root: true }
          : { ...parent, frameId, root: false };
      },
      readMs,
    },
    active.refs,
    options,
    current,
  );
  const snapshotId = `s-${++active.snapshots}`;
  if (!current()) {
    return { snapshotId, snapshot };
  }
  active.kept.set(snapshotId, { tab: tab.id, options: optionsKey(options), text: snapshot });
  active.latest.set(tab.id, snapshotId);
  for (const id of active.kept.keys()) {
    if (active.kept.size <= KEPT_SNAPSHOTS) {
      break;
    }
    active.kept.delete(id);
  }
  return { snapshotId, snapshot };
}

export function optionsKey(options: SnapshotOptions): string {
  return JSON.stringify([
    options.interactive ?? false,
    options.compact ?? false,
    options.depth ?? null,
  ]);
}

export async function pageInfo(active: ActiveSession, tabId?: string): Promise<TabInfo | null> {
  const tab = tabId ? active.tabs.get(tabId) : undefined;
  if (!tab || tab.closed) {
    return null;
  }
  return active.tabs.info(tab).catch(() => null);
}

function stopped(ctx: Context): CommandError {
  return new CommandError(
    "cancelled",
    "The command stopped because its execution ended.",
    "halted",
    ctx.job.touched ? "unknown" : "none",
  );
}

export function halted(job: Job): boolean {
  return job.cancelled || isFinal(job.execution.state);
}

export function ending(ctx: Context): boolean {
  return ctx.abandoned === true || halted(ctx.job) || ctx.host.released(ctx.active.id);
}

export async function sleep(ctx: Context, ms: number, done?: () => boolean) {
  const until = ctx.now() + ms;
  while (ctx.now() < until && !ending(ctx) && !done?.()) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(STEP_MS, until - ctx.now())));
  }
}

export async function waitWithin<T>(
  ctx: Context,
  promise: Promise<T>,
  ms: number,
): Promise<T | undefined> {
  let done = false;
  return Promise.race([
    promise.finally(() => {
      done = true;
    }),
    sleep(ctx, ms, () => done).then(() => undefined),
  ]);
}

export async function navigationDone(ctx: Context, tab: Tab) {
  if (!tab.navigating || tab.blocking) {
    return;
  }
  const watch = watchBlocking(tab);
  try {
    await waitWithin(
      ctx,
      Promise.race([tab.navigated(), watch.promise]),
      ctx.limits.navigationTimeoutMs,
    );
  } finally {
    watch.stop();
  }
}
