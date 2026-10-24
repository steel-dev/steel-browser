import { realpath, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { Command } from "../commands.js";
import { CommandError, withEffect } from "../errors.js";
import { axString } from "../ax.js";
import {
  FOCUS,
  INPUT_STATE,
  PREPARE_EDIT,
  SCROLL_ELEMENT,
  SCROLL_WINDOW,
  SELECT,
  SET_PICKER,
  TOGGLE_INPUT,
} from "../forms.js";
import { chordStroke, insertText, press as pressKey, typeText } from "../keyboard.js";
import {
  actionPoint,
  attached,
  click,
  confirmTarget,
  drag as dragPointer,
  hover,
} from "../pointer.js";
import { ENABLED } from "../reads.js";
import type { CommandResult } from "../records.js";
import type { Tab } from "../tabs.js";
import { callIn, callOn, type Element } from "../targets.js";
import {
  activate,
  dialogNote,
  element,
  inputs,
  scopeFor,
  sleep,
  tabFor,
  touch,
  type Context,
} from "./context.js";

export async function pointer(
  ctx: Context,
  command: Extract<Command, { command: "click" | "dblclick" | "hover" }>,
): Promise<CommandResult> {
  const target = await element(ctx, command);
  if (command.command !== "hover") {
    await refuseDisabled(target);
  }
  await activate(ctx, target.tab);
  const point = await actionPoint(target, () => touch(ctx), command.command !== "hover");
  const context = inputs(ctx, target.tab);
  if (command.command === "hover") {
    await hover(context, target.session, point);
  } else {
    await click(
      context,
      target.session,
      point,
      () => confirmTarget(target, point),
      command.command === "dblclick" ? 2 : 1,
    );
  }
  return { ok: true, effect: "applied", ...dialogNote(ctx.active, target.tab) };
}

export async function focus(
  ctx: Context,
  command: Extract<Command, { command: "focus" }>,
): Promise<CommandResult> {
  const target = await element(ctx, command);
  touch(ctx);
  await target.session.send("DOM.focus", { backendNodeId: target.backendNodeId }).catch(() => {
    throw new CommandError(
      "not_actionable",
      `${target.label} cannot take keyboard focus.`,
      "not_focusable",
    );
  });
  return { ok: true, effect: "applied" };
}

export async function write(
  ctx: Context,
  command: Extract<Command, { command: "type" | "fill" }>,
): Promise<CommandResult> {
  const target = await element(ctx, command);
  await activate(ctx, target.tab);
  const context = inputs(ctx, target.tab);
  const session = await target.tab.session();
  const fill = command.command === "fill";
  const text = fill ? command.value : command.text;
  const replace = fill || command.clear === true;
  context.touch();
  const prepared = await callOn<{
    refused?: string;
    picker?: boolean;
    empty?: boolean;
    end?: boolean;
  }>(target, PREPARE_EDIT, [replace]);
  if (prepared.refused === "not_focused" || prepared.refused === "detached") {
    throw await focusFailure(target);
  }
  if (prepared.refused) {
    throw new CommandError(
      "not_actionable",
      prepared.refused === "not_editable"
        ? `${target.label} is not a text field. Use select for options and check for checkboxes.`
        : `${target.label} is ${prepared.refused === "disabled" ? "disabled" : "read-only"}.`,
      prepared.refused,
    );
  }
  if (prepared.picker) {
    touch(ctx);
    if (!(await callOn<boolean>(target, SET_PICKER, [text]))) {
      throw new CommandError(
        "invalid_argument",
        `${target.label} does not accept ${JSON.stringify(
          text,
        )}. Date and time fields take values like 2025-01-31, 13:45, or 2025-01-31T13:45.`,
      );
    }
    return { ok: true, effect: "applied" };
  }
  if (!replace) {
    if (prepared.end && (await pressKey(context, session, "End"))) {
      throw new CommandError(
        "dialog_pending",
        "A dialog opened before typing started. Answer it, then type again.",
        "during_type",
        "applied",
      );
    }
    await typeText(context, session, text, command.delay);
    return { ok: true, effect: "applied", ...dialogNote(ctx.active, target.tab) };
  }
  if (text === "") {
    if (!prepared.empty) {
      await pressKey(context, session, "Delete");
    }
  } else if (fill) {
    await insertText(context, session, text);
  } else {
    await typeText(context, session, text, command.delay);
  }
  return { ok: true, effect: "applied", ...dialogNote(ctx.active, target.tab) };
}

export async function press(
  ctx: Context,
  command: Extract<Command, { command: "press" }>,
): Promise<CommandResult> {
  chordStroke(command.key);
  let tab: Tab;
  if (command.target !== undefined) {
    const target = await element(ctx, { ...command, target: command.target });
    tab = target.tab;
    await activate(ctx, tab);
    touch(ctx);
    if (!(await callOn<boolean>(target, FOCUS))) {
      throw await focusFailure(target);
    }
  } else {
    tab = tabFor(ctx, command.tab);
    await activate(ctx, tab);
  }
  await pressKey(inputs(ctx, tab), await tab.session(), command.key);
  return { ok: true, effect: "applied", ...dialogNote(ctx.active, tab) };
}

export async function select(
  ctx: Context,
  command: Extract<Command, { command: "select" }>,
): Promise<CommandResult> {
  const target = await element(ctx, command);
  const values = Array.isArray(command.values) ? command.values : [command.values];
  touch(ctx);
  const outcome = await callOn<{
    refused?: "not_select" | "disabled";
    missing?: string;
    options?: Array<[string, string]>;
    ambiguous?: string;
    blocked?: string;
    single?: number;
    selected?: string[];
    changed?: boolean;
  }>(target, SELECT, [values]);
  if (outcome.refused) {
    throw new CommandError(
      "not_actionable",
      outcome.refused === "disabled"
        ? `${target.label} is disabled.`
        : `${target.label} is not a <select> element. For a custom dropdown, click it and then click the option.`,
      outcome.refused,
    );
  }
  if (outcome.missing !== undefined) {
    const listed = outcome.options!.map(([value, label]) => `${value} (${JSON.stringify(label)})`);
    throw new CommandError(
      "invalid_argument",
      `No option of ${target.label} matches ${JSON.stringify(
        outcome.missing,
      )}. Options: ${listed.join(", ")}`,
    );
  }
  if (outcome.ambiguous !== undefined) {
    throw new CommandError(
      "invalid_argument",
      `More than one option of ${target.label} is labelled ${JSON.stringify(
        outcome.ambiguous,
      )}. Pass the option value instead.`,
    );
  }
  if (outcome.blocked !== undefined) {
    throw new CommandError(
      "not_actionable",
      `The option ${JSON.stringify(outcome.blocked)} of ${target.label} is disabled.`,
      "disabled_option",
    );
  }
  if (outcome.single !== undefined) {
    throw new CommandError(
      "invalid_argument",
      `${target.label} takes one option, but ${outcome.single} were given.`,
    );
  }
  return { ok: true, effect: outcome.changed ? "applied" : "none", selected: outcome.selected };
}

export interface Toggle {
  checked: boolean | "mixed";
  radio: boolean;
  control: Element;
}

export async function toggleState(target: Element): Promise<Toggle | null> {
  const nodes = await target.session
    .send("Accessibility.getPartialAXTree", {
      backendNodeId: target.backendNodeId,
      fetchRelatives: false,
    })
    .then((tree) => tree.nodes)
    .catch(() => []);
  const node = nodes.find((candidate) => candidate.backendDOMNodeId === target.backendNodeId);
  const state =
    node && !node.ignored
      ? node.properties?.find((property) => property.name === "checked") ??
        node.properties?.find((property) => property.name === "pressed")
      : undefined;
  if (state) {
    const raw = String(state.value.value);
    const role = axString(node!.role);
    return {
      checked: raw === "mixed" ? "mixed" : raw === "true",
      radio: role === "radio" || role === "menuitemradio",
      control: target,
    };
  }
  const { result } = await target.session.send("Runtime.callFunctionOn", {
    objectId: target.objectId,
    functionDeclaration: TOGGLE_INPUT,
    objectGroup: target.group,
  });
  if (!result.objectId) {
    return null;
  }
  const { node: input } = await target.session.send("DOM.describeNode", {
    objectId: result.objectId,
  });
  const control = { ...target, backendNodeId: input.backendNodeId, objectId: result.objectId };
  return { ...(await callOn<Omit<Toggle, "control">>(control, INPUT_STATE)), control };
}

const KEYBOARD_FALLBACK = new Set(["covered", "offscreen", "no_box"]);

export async function check(
  ctx: Context,
  command: Extract<Command, { command: "check" | "uncheck" }>,
): Promise<CommandResult> {
  const target = await element(ctx, command);
  const wanted = command.command === "check";
  const state = await toggleState(target);
  if (!state) {
    throw new CommandError(
      "not_actionable",
      `${target.label} is not a checkbox, radio button, switch, or toggle button.`,
      "not_checkable",
    );
  }
  if (state.checked === wanted) {
    return { ok: true, effect: "none", checked: wanted };
  }
  if (!wanted && state.radio) {
    throw new CommandError(
      "invalid_argument",
      `${target.label} is a radio button, which cannot be unchecked. Check another option in its group.`,
    );
  }
  await refuseDisabled(state.control, target.label);
  await activate(ctx, target.tab);
  const context = inputs(ctx, target.tab);
  const current = async (): Promise<Element | null> => {
    if (await attached(target)) {
      return target;
    }
    return element(ctx, { ...command, tab: command.tab ?? target.tab.id }).catch((error) => {
      if (error instanceof CommandError && error.code === "element_not_found") {
        return null;
      }
      throw withEffect(error, "applied");
    });
  };
  const settles = async () => {
    for (const wait of [0, 100, 200, 400, 800]) {
      await sleep(ctx, wait);
      const now = await current();
      if (now && (await toggleState(now))?.checked === wanted) {
        return true;
      }
    }
    return false;
  };
  const unchanged = () =>
    new CommandError(
      "not_actionable",
      `${target.label} did not become ${wanted ? "checked" : "unchecked"}.`,
      "state",
      "applied",
    );
  const press = async (): Promise<CommandResult | null> => {
    const { pressed, point } = await actionPoint(state.control, () => touch(ctx))
      .then((point) => ({ pressed: state.control, point }))
      .catch(async (error) => {
        if (state.control === target || !(error instanceof CommandError)) {
          throw error;
        }
        return { pressed: target, point: await actionPoint(target, () => touch(ctx)) };
      });
    if (await click(context, pressed.session, point, () => confirmTarget(pressed, point))) {
      return { ok: true, effect: "applied", ...dialogNote(ctx.active, target.tab) };
    }
    return null;
  };
  let blocked: CommandError | null = null;
  try {
    const opened = await press();
    if (opened) {
      return opened;
    }
  } catch (error) {
    if (
      !(error instanceof CommandError) ||
      error.code !== "not_actionable" ||
      !KEYBOARD_FALLBACK.has(error.reason ?? "")
    ) {
      throw error;
    }
    blocked = error;
  }
  if (!blocked) {
    if (await settles()) {
      return { ok: true, effect: "applied", checked: wanted };
    }
    const now = await current();
    if (state.checked === "mixed" && now && (await toggleState(now))?.checked === !wanted) {
      const opened = await press().catch((error) => {
        throw withEffect(error, "applied");
      });
      if (opened) {
        return opened;
      }
      if (await settles()) {
        return { ok: true, effect: "applied", checked: wanted };
      }
    }
    throw unchanged();
  }
  touch(ctx);
  if (!(await callOn<boolean>(state.control, FOCUS))) {
    throw blocked;
  }
  if (await pressKey(context, await target.tab.session(), " ")) {
    return { ok: true, effect: "applied", ...dialogNote(ctx.active, target.tab) };
  }
  if (!(await settles())) {
    throw unchanged();
  }
  return { ok: true, effect: "applied", checked: wanted };
}

async function refuseDisabled(target: Element, label = target.label) {
  if (!(await callOn<boolean>(target, ENABLED))) {
    throw new CommandError("not_actionable", `${label} is disabled.`, "disabled");
  }
}

async function focusFailure(target: Element): Promise<CommandError> {
  if (await attached(target)) {
    return unfocusable(target);
  }
  return new CommandError(
    "stale_ref",
    `${target.label} left the page when it took focus. Take a new snapshot.`,
    "detached",
    "unknown",
  );
}

function unfocusable(target: Element): CommandError {
  return new CommandError(
    "not_actionable",
    `${target.label} cannot take keyboard focus.`,
    "not_focusable",
    "unknown",
  );
}

export async function scroll(
  ctx: Context,
  command: Extract<Command, { command: "scroll" }>,
): Promise<CommandResult> {
  const amount = command.amount ?? 300;
  const direction = command.direction ?? "down";
  const dx = direction === "left" ? -amount : direction === "right" ? amount : 0;
  const dy = direction === "up" ? -amount : direction === "down" ? amount : 0;
  let position: [number, number, number, number];
  if (command.target !== undefined) {
    const target = await element(ctx, { ...command, target: command.target });
    touch(ctx);
    position = await callOn(target, SCROLL_ELEMENT, [dx, dy]);
  } else {
    const tab = tabFor(ctx, command.tab);
    const scope = await scopeFor(ctx, tab, command.frame);
    position = await callIn(scope, SCROLL_WINDOW, [dx, dy], () => touch(ctx));
  }
  const [fromX, fromY, x, y] = position;
  const moved = fromX !== x || fromY !== y;
  return { ok: true, effect: moved ? "applied" : "none", moved, x, y };
}

export async function upload(
  ctx: Context,
  command: Extract<Command, { command: "upload" }>,
): Promise<CommandResult> {
  const target = await element(ctx, command);
  const names = Array.isArray(command.files) ? command.files : [command.files];
  const root = await realpath(ctx.host.filesRoot());
  const files: string[] = [];
  for (const name of names) {
    const path = resolve(root, name);
    const real = path.startsWith(root + sep) ? await realpath(path).catch(() => null) : path;
    if (!real || !real.startsWith(root + sep)) {
      throw new CommandError(
        "forbidden_file",
        `${name} is not a file in this session's files. Upload it with the files API first.`,
        real ? "outside_files" : "missing",
      );
    }
    if (!(await stat(real)).isFile()) {
      throw new CommandError("forbidden_file", `${name} is not a file.`, "not_file");
    }
    files.push(real);
  }
  const input = await callOn<{ file: boolean; multiple: boolean }>(
    target,
    `function () {
      return { file: this instanceof HTMLInputElement && this.type === "file", multiple: this.multiple === true };
    }`,
  );
  if (!input.file) {
    throw new CommandError(
      "not_actionable",
      `${target.label} is not a file input.`,
      "not_file_input",
    );
  }
  if (files.length > 1 && !input.multiple) {
    throw new CommandError("invalid_argument", `${target.label} takes one file.`);
  }
  await refuseDisabled(target);
  touch(ctx);
  await target.session.send("DOM.setFileInputFiles", {
    files,
    backendNodeId: target.backendNodeId,
  });
  return { ok: true, effect: "applied", files: names };
}

export async function drag(
  ctx: Context,
  command: Extract<Command, { command: "drag" }>,
): Promise<CommandResult> {
  const scope = { tab: command.tab, frame: command.frame };
  const source = await element(ctx, { ...scope, target: command.source });
  const target = await element(ctx, { ...scope, target: command.target });
  if (source.tab !== target.tab || source.session !== target.session) {
    throw new CommandError(
      "not_actionable",
      "The drag source and target must be in the same tab and frame.",
      "different_frames",
    );
  }
  await activate(ctx, source.tab);
  await actionPoint(target, () => touch(ctx), false);
  const from = await actionPoint(source, () => touch(ctx));
  const to = await actionPoint(target, () => touch(ctx), false, false).catch((error) => {
    if (error instanceof CommandError && error.reason === "offscreen") {
      throw new CommandError(
        "not_actionable",
        "The drag source and target do not fit on the screen together.",
        "too_far",
      );
    }
    throw error;
  });
  await dragPointer(
    inputs(ctx, source.tab),
    source.session,
    from,
    to,
    () => confirmTarget(source, from),
    10,
  );
  return { ok: true, effect: "applied", ...dialogNote(ctx.active, source.tab) };
}
