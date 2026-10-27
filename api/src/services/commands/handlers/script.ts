import type { Command } from "../commands.js";
import { CommandError } from "../errors.js";
import type { CommandResult } from "../records.js";
import { SECRET_VALUES, secretMask } from "../secrets.js";
import { secretsIn } from "../snapshot.js";
import { callIn } from "../targets.js";
import {
  crashedTab,
  ending,
  scopeFor,
  tabFor,
  touch,
  waitWithin,
  watchBlocking,
  type Context,
} from "./context.js";

const SCRIPT_TIMEOUT_MS = 10_000;

const RESULT_CHARS = 100_000;

export async function evaluate(
  ctx: Context,
  command: Extract<Command, { command: "eval" }>,
): Promise<CommandResult> {
  const tab = tabFor(ctx, command.tab);
  const session = await tab.session();
  const timeout = command.timeout ?? SCRIPT_TIMEOUT_MS;
  touch(ctx);
  const watch = watchBlocking(tab);
  const outcome = await waitWithin(
    ctx,
    Promise.race([
      session
        .send("Runtime.evaluate", {
          expression: command.script,
          returnByValue: true,
          awaitPromise: true,
          userGesture: true,
        })
        .then(
          (response) => ({ response }),
          (error: Error) => ({ error }),
        ),
      watch.promise.then(() => ({ blocked: true })),
    ]),
    timeout,
  ).finally(() => watch.stop());
  if (!outcome) {
    void tab.terminate().catch(() => undefined);
    throw ending(ctx)
      ? new CommandError(
          "cancelled",
          "The script stopped because its execution ended.",
          "halted",
          "unknown",
        )
      : new CommandError(
          "timeout",
          `The script did not finish within ${timeout / 1000} seconds.`,
          "script",
          "unknown",
        );
  }
  if ("blocked" in outcome) {
    if (tab.crashed && !tab.blocking) {
      throw crashedTab(tab);
    }
    throw new CommandError(
      "dialog_pending",
      "A dialog opened while the script ran. Answer it with the dialog command.",
      "during_script",
      "applied",
    );
  }
  if ("error" in outcome) {
    throw new CommandError(
      "script_error",
      `The script result could not be returned: ${outcome.error.message}`,
      undefined,
      "applied",
    );
  }
  const { result, exceptionDetails } = outcome.response;
  if (exceptionDetails) {
    throw new CommandError(
      "script_error",
      `The script threw: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`,
      undefined,
      "applied",
    );
  }
  if (result.type === "undefined") {
    return { ok: true, effect: "applied" };
  }
  const scope = await scopeFor(ctx, tab);
  const hide = secretMask([
    ...(await callIn<string[]>(scope, SECRET_VALUES).catch(() => [])),
    ...(await secretsIn(session)),
  ]);
  const value = masked(result.value, hide);
  const size = JSON.stringify(value)?.length ?? 0;
  if (size > RESULT_CHARS) {
    throw new CommandError(
      "invalid_argument",
      `The result is ${size} characters of JSON. Return at most ${RESULT_CHARS}.`,
      "too_large",
      "applied",
    );
  }
  return { ok: true, effect: "applied", value };
}

function masked(value: unknown, hide: (text: string) => string): unknown {
  if (typeof value === "string") {
    return hide(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => masked(item, hide));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [hide(key), masked(item, hide)]),
    );
  }
  return value;
}
