import type { Page, Protocol } from "puppeteer-core";
import type { Command } from "../commands.js";
import { checkUrl } from "../policy.js";
import type { CommandResult } from "../records.js";
import { errorInfo, navigationError } from "../results.js";
import { clientOf, type Tab } from "../tabs.js";
import {
  crashedTab,
  dialogNote,
  ending,
  goto,
  halted,
  load,
  navigationDone,
  sleep,
  tabFor,
  touch,
  waitWithin,
  watchBlocking,
  type Context,
} from "./context.js";

const TICK = `function () {
  return new Promise((resolve) => setTimeout(resolve, 0));
}`;

const TICK_MS = 1_000;

const FRAME_HISTORY_MS = 1_000;

const SWITCH_WAIT_MS = 2_000;

const SWITCH_RETRY_MS = 20;

export async function navigate(
  ctx: Context,
  command: Extract<Command, { command: "navigate" }>,
): Promise<CommandResult> {
  const tab = tabFor(ctx, command.tab, true);
  const url = checkUrl(command.url);
  const page = await goto(ctx, tab, url);
  return { ok: true, effect: "applied", url: page.url() };
}

export async function history(
  ctx: Context,
  tabId: string | undefined,
  delta: -1 | 1,
): Promise<CommandResult> {
  const tab = tabFor(ctx, tabId);
  const page = await tab.navigable();
  const session = clientOf(page);
  const { currentIndex, entries } = await historyOf(ctx, page);
  const entry = entries[currentIndex + delta];
  if (!entry) {
    return { ok: true, effect: "none", navigated: false };
  }
  checkUrl(entry.url);
  const inFrame = entry.url === entries[currentIndex]?.url;
  touch(ctx);
  try {
    await load(
      ctx,
      tab,
      Promise.all([
        page
          .waitForNavigation({
            waitUntil: "load",
            timeout: inFrame ? FRAME_HISTORY_MS : ctx.limits.navigationTimeoutMs,
          })
          .catch((error: unknown) => {
            if (!inFrame) {
              throw error;
            }
          }),
        session.send("Page.navigateToHistoryEntry", { entryId: entry.id }),
      ]),
    );
  } catch (error) {
    throw navigationError(error, entry.url, ctx.limits.navigationTimeoutMs);
  }
  return { ok: true, effect: "applied", navigated: true, url: page.url() };
}

export async function reload(ctx: Context, tabId: string | undefined): Promise<CommandResult> {
  const tab = tabFor(ctx, tabId, true);
  const page = await tab.navigable();
  const { currentIndex, entries } = await historyOf(ctx, page);
  const url = entries[currentIndex]?.url || page.url();
  checkUrl(url);
  touch(ctx);
  try {
    await load(
      ctx,
      tab,
      page.reload({ waitUntil: "load", timeout: ctx.limits.navigationTimeoutMs }),
    );
  } catch (error) {
    throw navigationError(error, url, ctx.limits.navigationTimeoutMs);
  }
  return { ok: true, effect: "applied", url: page.url() };
}

async function historyOf(
  ctx: Context,
  page: Page,
): Promise<Protocol.Page.GetNavigationHistoryResponse> {
  const until = ctx.now() + SWITCH_WAIT_MS;
  for (;;) {
    try {
      return await clientOf(page).send("Page.getNavigationHistory");
    } catch (error) {
      if (page.isClosed() || ending(ctx) || ctx.now() >= until) {
        throw error;
      }
      await sleep(ctx, SWITCH_RETRY_MS);
    }
  }
}

export async function settle(ctx: Context, result: CommandResult): Promise<CommandResult> {
  const tab = ctx.job.tab ? ctx.active.tabs.get(ctx.job.tab) : undefined;
  if (!tab || tab.closed || tab.blocking) {
    return result;
  }
  const watch = watchBlocking(tab);
  try {
    await waitWithin(ctx, Promise.race([tick(tab).catch(() => undefined), watch.promise]), TICK_MS);
  } finally {
    watch.stop();
  }
  await navigationDone(ctx, tab);
  if (tab.blocking) {
    return { ...result, ...dialogNote(ctx.active, tab) };
  }
  if (tab.crashed) {
    return { ok: false, effect: result.effect, error: errorInfo(crashedTab(tab)) };
  }
  return tab.navigating && !halted(ctx.job) ? { ...result, loading: true } : result;
}

async function tick(tab: Tab) {
  const session = await tab.session();
  const { frameTree } = await session.send("Page.getFrameTree");
  const contextId = await tab.world(session, frameTree.frame.id, frameTree.frame.loaderId);
  await session.send("Runtime.callFunctionOn", {
    executionContextId: contextId,
    functionDeclaration: TICK,
    awaitPromise: true,
  });
}
