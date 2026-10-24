import type { Command } from "../commands.js";
import { diffSnapshots } from "../diff.js";
import { CommandError } from "../errors.js";
import { checkUrl } from "../policy.js";
import type { CommandResult } from "../records.js";
import { combine, errorInfo, failed } from "../results.js";
import type { Observe } from "../session.js";
import { refsFor, scanSecrets } from "../snapshot.js";
import { callIn, locate } from "../targets.js";
import { SECRET_VALUES, secretsWithin } from "../secrets.js";
import {
  capture,
  ending,
  goto,
  navigationDone,
  optionsKey,
  scopeFor,
  tabFor,
  touch,
  usable,
  useTab,
  type Context,
} from "./context.js";

const FIND_LIMIT = 50;

export async function snapshot(
  ctx: Context,
  command: Extract<Command, { command: "snapshot" }>,
): Promise<CommandResult> {
  const tab = tabFor(ctx, command.tab);
  const { command: _, tab: __, ...options } = command;
  return {
    ok: true,
    effect: "none",
    ...(await capture(ctx.active, tab, options, () => !ending(ctx), ctx.limits.frameReadMs)),
  };
}

export async function find(
  ctx: Context,
  command: Extract<Command, { command: "find" }>,
): Promise<CommandResult> {
  if (command.name !== undefined && command.by !== "role") {
    throw new CommandError("invalid_argument", "name works only with by: role.");
  }
  const tab = tabFor(ctx, command.tab);
  const scope = await scopeFor(ctx, tab, command.frame);
  const matches = await locate(scope, {
    [command.by]: command.value,
    ...(command.name !== undefined ? { name: command.name } : {}),
    ...(command.exact !== undefined ? { exact: command.exact } : {}),
  });
  const scan = await scanSecrets(scope.session);
  const secrets = [
    ...(await callIn<string[]>(scope, SECRET_VALUES).catch(() => [])),
    ...scan.values,
  ];
  const shown = matches.slice(0, FIND_LIMIT).map((match) => match.backendNodeId);
  const within = new Map<number, string[]>();
  for (const backendNodeId of shown) {
    within.set(backendNodeId, [
      ...(await secretsWithin(scope.session, backendNodeId)),
      ...scan.within(backendNodeId),
    ]);
  }
  const found = await refsFor(
    { ...scope, tabId: tab.id, sessionKey: scope.session.id() },
    ctx.active.refs,
    shown,
    secrets,
    within,
    () => !ending(ctx),
  );
  return { ok: true, effect: "none", count: matches.length, matches: found };
}

export async function tab(
  ctx: Context,
  command: Extract<Command, { command: "tab" }>,
): Promise<CommandResult> {
  const { active, job } = ctx;
  switch (command.action) {
    case "list":
      return { ok: true, effect: "none", tabs: await active.tabs.describe() };
    case "new": {
      const url = command.url ? checkUrl(command.url) : undefined;
      touch(ctx);
      const opened = await active.tabs.create();
      useTab(ctx, opened.id);
      if (url) {
        try {
          await goto(ctx, opened, url);
        } catch (error) {
          const result = failed(error, "unknown");
          return {
            ...result,
            effect: combine([result, { ok: true, effect: "applied" }]),
            tab: opened.id,
          };
        }
      }
      return { ok: true, effect: "applied", tab: opened.id };
    }
    case "close": {
      const closing = active.tabs.resolve(command.tab);
      if (active.tabs.list().length === 1) {
        throw new CommandError(
          "invalid_argument",
          `Tab ${closing.id} is the last open tab. Open another tab before closing it.`,
          "last_tab",
        );
      }
      touch(ctx);
      await active.tabs.close(closing);
      return { ok: true, effect: "applied", tab: closing.id };
    }
  }
}

export async function observe(ctx: Context, observe: Observe): Promise<Record<string, unknown>> {
  const { active, job } = ctx;
  try {
    const tab = active.tabs.resolve(observe.tab ?? job.execution.tab);
    useTab(ctx, tab.id);
    await navigationDone(ctx, tab);
    const current = usable(ctx, tab);
    const { mode, base, tab: _, ...options } = observe;
    const baseId = mode === "diff" ? base ?? active.latest.get(current.id) : undefined;
    const before = baseId ? active.kept.get(baseId) : undefined;
    const captured = await capture(
      active,
      current,
      options,
      () => !ending(ctx),
      ctx.limits.frameReadMs,
    );
    if (mode !== "diff") {
      return captured;
    }
    const diff =
      before && before.tab === current.id && before.options === optionsKey(options)
        ? diffSnapshots(before.text, captured.snapshot)
        : null;
    if (!diff) {
      return { ...captured, full: true };
    }
    return {
      snapshotId: captured.snapshotId,
      base: baseId,
      diff: diff.diff,
      additions: diff.additions,
      removals: diff.removals,
    };
  } catch (error) {
    return { error: errorInfo(error) };
  }
}
