import { parse, type AnyNode, type Program } from "acorn";
import { Script } from "node:vm";
import type { Command } from "../commands.js";
import { dialogHint } from "../dialogs.js";
import { CommandError } from "../errors.js";
import type { CommandResult } from "../records.js";
import { SECRET_VALUES, secretMask } from "../secrets.js";
import { secretsIn } from "../snapshot.js";
import { callIn } from "../targets.js";
import {
  crashedTab,
  ending,
  openDialogOn,
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
  const { expression, bodyError } = runnable(command.script);
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
          expression,
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
    const dialog = openDialogOn(ctx.active, tab.id);
    const hint = dialogHint(tab.id, dialog?.id);
    throw new CommandError(
      "dialog_pending",
      dialog
        ? `A dialog opened while the script ran: ${dialog.type} dialog ${dialog.id}. ${hint}`
        : `A dialog opened while the script ran. ${hint}`,
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
    const thrown = exceptionDetails.exception?.description ?? exceptionDetails.text;
    throw new CommandError(
      "script_error",
      bodyError && exceptionDetails.exception?.className === "SyntaxError"
        ? `The script threw: ${thrown}. As a function body: ${bodyError}`
        : `The script threw: ${thrown}`,
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

function runnable(script: string): { expression: string; bodyError?: string } {
  const program = parsed(script);
  if (program) {
    const body = functionBody(script, program);
    return { expression: body === undefined ? script : wrap(body) };
  }
  if (!syntaxError(script)) {
    return { expression: script };
  }
  const wrapped = wrap(script);
  const bodyError = syntaxError(wrapped);
  return bodyError ? { expression: script, bodyError } : { expression: wrapped };
}

function wrap(body: string): string {
  return `(async () => {\n${body}\n})()`;
}

function parsed(script: string): Program | undefined {
  try {
    return parse(script, {
      ecmaVersion: "latest",
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      preserveParens: true,
    });
  } catch {
    return undefined;
  }
}

function functionBody(script: string, program: Program): string | undefined {
  const found = new Set<string>();
  topLevel(program.body, found);
  if (found.has("return")) {
    return script;
  }
  if (!found.has("await")) {
    return undefined;
  }
  const ranges: Array<[number, number]> = [];
  completions(program.body[program.body.length - 1], ranges);
  return ranges
    .sort((a, b) => b[0] - a[0])
    .reduce(
      (text, [from, to]) =>
        `${text.slice(0, from)}return (${text.slice(from, to)})${text.slice(to)}`,
      script,
    );
}

function completions(node: AnyNode | null | undefined, ranges: Array<[number, number]>): void {
  switch (node?.type) {
    case "ExpressionStatement":
      ranges.push([node.expression.start, node.expression.end]);
      return;
    case "BlockStatement":
      completions(node.body[node.body.length - 1], ranges);
      return;
    case "IfStatement":
      completions(node.consequent, ranges);
      completions(node.alternate, ranges);
      return;
    case "TryStatement":
      completions(node.block, ranges);
      completions(node.handler?.body, ranges);
      return;
  }
}

function topLevel(node: unknown, found: Set<string>): void {
  if (Array.isArray(node)) {
    node.forEach((item) => topLevel(item, found));
    return;
  }
  if (!node || typeof node !== "object" || !("type" in node)) {
    return;
  }
  const type = node.type;
  if (
    type === "FunctionDeclaration" ||
    type === "FunctionExpression" ||
    type === "ArrowFunctionExpression"
  ) {
    return;
  }
  if (type === "ReturnStatement") {
    found.add("return");
  }
  if (type === "AwaitExpression" || (type === "ForOfStatement" && "await" in node && node.await)) {
    found.add("await");
  }
  Object.values(node).forEach((value) => topLevel(value, found));
}

function syntaxError(code: string): string | undefined {
  try {
    new Script(code);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
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
