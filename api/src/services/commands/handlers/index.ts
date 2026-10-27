import type { Command } from "../commands.js";
import { CommandError } from "../errors.js";
import type { CommandResult } from "../records.js";
import { failed } from "../results.js";
import type { Context } from "./context.js";
import { check, drag, focus, pointer, press, scroll, select, upload, write } from "./elements.js";
import { get, is, pdf, screenshot, wait } from "./inspect.js";
import { history, navigate, reload, settle } from "./navigation.js";
import { find, snapshot, tab } from "./pages.js";
import { key, mouse } from "./raw.js";
import { evaluate } from "./script.js";

export {
  crashedTab,
  dialogNote,
  openDialogOn,
  pageInfo,
  watchBlocking,
  type Context,
} from "./context.js";
export { observe } from "./pages.js";

const SETTLES = new Set([
  "click",
  "dblclick",
  "type",
  "fill",
  "press",
  "select",
  "check",
  "uncheck",
  "upload",
  "drag",
  "keydown",
  "keyup",
  "mouse",
  "eval",
]);

export async function execute(ctx: Context, command: Command): Promise<CommandResult> {
  try {
    const result = await dispatch(ctx, command);
    return result.ok && SETTLES.has(command.command) ? await settle(ctx, result) : result;
  } catch (error) {
    return failed(error, ctx.job.touched ? "unknown" : "none");
  } finally {
    release(ctx);
  }
}

function release(ctx: Context) {
  const tab = ctx.job.tab ? ctx.active.tabs.get(ctx.job.tab) : undefined;
  for (const session of tab?.sessions() ?? []) {
    void session
      .send("Runtime.releaseObjectGroup", { objectGroup: ctx.group })
      .catch(() => undefined);
  }
}

async function dispatch(ctx: Context, command: Command): Promise<CommandResult> {
  switch (command.command) {
    case "navigate":
      return await navigate(ctx, command);
    case "back":
      return await history(ctx, command.tab, -1);
    case "forward":
      return await history(ctx, command.tab, 1);
    case "reload":
      return await reload(ctx, command.tab);
    case "snapshot":
      return await snapshot(ctx, command);
    case "click":
    case "dblclick":
    case "hover":
      return await pointer(ctx, command);
    case "focus":
      return await focus(ctx, command);
    case "type":
    case "fill":
      return await write(ctx, command);
    case "press":
      return await press(ctx, command);
    case "keydown":
    case "keyup":
      return await key(ctx, command);
    case "mouse":
      return await mouse(ctx, command);
    case "eval":
      return await evaluate(ctx, command);
    case "select":
      return await select(ctx, command);
    case "check":
    case "uncheck":
      return await check(ctx, command);
    case "scroll":
      return await scroll(ctx, command);
    case "upload":
      return await upload(ctx, command);
    case "drag":
      return await drag(ctx, command);
    case "get":
      return await get(ctx, command);
    case "is":
      return await is(ctx, command);
    case "wait":
      return await wait(ctx, command);
    case "screenshot":
      return await screenshot(ctx, command);
    case "pdf":
      return await pdf(ctx, command);
    case "find":
      return await find(ctx, command);
    case "tab":
      return await tab(ctx, command);
    default:
      throw new CommandError("unknown_command", `${command.command} cannot run here.`);
  }
}
