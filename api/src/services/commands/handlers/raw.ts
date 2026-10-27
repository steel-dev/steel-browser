import type { Command } from "../commands.js";
import { CommandError } from "../errors.js";
import { chordStroke, modifierBit, sendKey, strokeEvent } from "../keyboard.js";
import { input, type MouseButton, type MouseParams } from "../pointer.js";
import type { CommandResult } from "../records.js";
import { activate, dialogNote, inputs, tabFor, type Context } from "./context.js";

const BUTTONS: Record<MouseButton, number> = { left: 1, right: 2, middle: 4 };

export async function mouse(
  ctx: Context,
  command: Extract<Command, { command: "mouse" }>,
): Promise<CommandResult> {
  if ((command.x === undefined) !== (command.y === undefined)) {
    throw new CommandError("invalid_argument", "Pass x and y together.");
  }
  const tab = tabFor(ctx, command.tab);
  const holds = command.action === "down" || command.action === "up";
  const point =
    command.x !== undefined && command.y !== undefined
      ? { x: command.x, y: command.y }
      : holds
      ? tab.pointer
      : null;
  if (!point) {
    throw new CommandError(
      "invalid_argument",
      holds ? "Move the mouse first, or pass x and y." : `mouse ${command.action} needs x and y.`,
    );
  }
  await activate(ctx, tab);
  const session = await tab.session();
  const context = inputs(ctx, tab);
  const send = (params: MouseParams) => input(context, session, params, "unknown");
  const button = command.button ?? "left";
  switch (command.action) {
    case "move": {
      const held = tab.pressed ? tab.pressed.button ?? "left" : undefined;
      await send({
        type: "mouseMoved",
        ...point,
        ...(held ? { button: held, buttons: BUTTONS[held] } : {}),
      });
      break;
    }
    case "down":
      await send({
        type: "mousePressed",
        ...point,
        button,
        buttons: BUTTONS[button],
        clickCount: 1,
      });
      break;
    case "up":
      await send({ type: "mouseReleased", ...point, button, buttons: 0, clickCount: 1 });
      break;
    case "click": {
      const clicks = command.clicks ?? 1;
      for (let count = 1; count <= clicks; count++) {
        const opened =
          (await send({
            type: "mousePressed",
            ...point,
            button,
            buttons: BUTTONS[button],
            clickCount: count,
          })) ||
          (await send({ type: "mouseReleased", ...point, button, buttons: 0, clickCount: count }));
        if (opened && count < clicks) {
          throw new CommandError(
            "dialog_pending",
            `A dialog opened after ${count} of ${clicks} clicks. Answer it, then click again.`,
            "during_click",
            "applied",
          );
        }
        if (opened) {
          break;
        }
      }
      break;
    }
    case "wheel":
      await send({
        type: "mouseWheel",
        ...point,
        deltaX: command.deltaX ?? 0,
        deltaY: command.deltaY ?? 0,
      });
      break;
  }
  return { ok: true, effect: "applied", ...dialogNote(ctx.active, tab) };
}

export async function key(
  ctx: Context,
  command: Extract<Command, { command: "keydown" | "keyup" }>,
): Promise<CommandResult> {
  const alone = chordStroke(command.key);
  if (alone.modifiers !== 0) {
    throw new CommandError(
      "invalid_argument",
      `${command.command} takes one key. Hold each modifier with its own keydown.`,
    );
  }
  const tab = tabFor(ctx, command.tab);
  const down = command.command === "keydown";
  const bit = modifierBit(alone.stroke.key);
  const modifiers = down ? tab.modifiers | bit : tab.modifiers & ~bit;
  const { stroke } = chordStroke(command.key, modifiers);
  await activate(ctx, tab);
  const session = await tab.session();
  const name = stroke.code || stroke.key;
  const event = strokeEvent(stroke, modifiers);
  tab.modifiers = modifiers;
  if (down) {
    tab.held.set(name, {
      session,
      keyUp: { ...strokeEvent(stroke, modifiers & ~bit), type: "keyUp" },
    });
  } else {
    tab.held.delete(name);
  }
  await sendKey(
    inputs(ctx, tab),
    session,
    !down
      ? { ...event, type: "keyUp" }
      : stroke.text === undefined
      ? { ...event, type: "rawKeyDown" }
      : { ...event, type: "keyDown", text: stroke.text, unmodifiedText: stroke.text },
  );
  return { ok: true, effect: "applied", ...dialogNote(ctx.active, tab) };
}
