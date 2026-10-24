import type { CDPSession, Protocol } from "puppeteer-core";
import { _keyDefinitions, type KeyInput } from "puppeteer-core/internal/common/USKeyboardLayout.js";
import { CommandError } from "./errors.js";
import { sendOrDialog, type InputContext } from "./pointer.js";

const ALIASES = new Map<string, KeyInput>([
  ["\t", "Tab"],
  ["esc", "Escape"],
  ["return", "Enter"],
  ["up", "ArrowUp"],
  ["down", "ArrowDown"],
  ["left", "ArrowLeft"],
  ["right", "ArrowRight"],
  ["del", "Delete"],
  ["ins", "Insert"],
  ["pgup", "PageUp"],
  ["pgdn", "PageDown"],
  ["ctrl", "Control"],
  ["cmd", "Meta"],
  ["command", "Meta"],
  ["option", "Alt"],
]);

const NAMED = new Map(
  (Object.keys(_keyDefinitions) as KeyInput[])
    .filter((name) => name.length > 1)
    .map((name) => [name.toLowerCase(), name]),
);

const MODIFIER_BITS = new Map([
  ["alt", 1],
  ["option", 1],
  ["control", 2],
  ["ctrl", 2],
  ["meta", 4],
  ["cmd", 4],
  ["command", 4],
  ["shift", 8],
]);

const SHIFT = 8;

interface KeyStroke {
  key: string;
  code: string;
  keyCode: number;
  text?: string;
  location?: number;
}

function parseChord(input: string): { key: string; modifiers: number } {
  let modifiers = 0;
  let key = input;
  for (;;) {
    const plus = key.indexOf("+");
    const bit =
      plus > 0 && plus < key.length - 1 ? MODIFIER_BITS.get(key.slice(0, plus).toLowerCase()) : 0;
    if (!bit) {
      return { key, modifiers };
    }
    modifiers |= bit;
    key = key.slice(plus + 1);
  }
}

function keyStroke(name: string, modifiers: number): KeyStroke {
  const known =
    ALIASES.get(name) ??
    ALIASES.get(name.toLowerCase()) ??
    (name.length === 1 ? (name as KeyInput) : NAMED.get(name.toLowerCase()));
  const definition = known ? _keyDefinitions[known] : undefined;
  if (!definition) {
    if ([...name].length !== 1) {
      throw new CommandError(
        "invalid_argument",
        `${JSON.stringify(
          name,
        )} is not a key name. Use names like Enter, Tab, Escape, ArrowDown, F5, or a single character.`,
      );
    }
    return { key: name, code: "", keyCode: 0, ...(modifiers & ~SHIFT ? {} : { text: name }) };
  }
  const shifted = (modifiers & SHIFT) !== 0;
  const physical = (definition.code && _keyDefinitions[definition.code as KeyInput]) || definition;
  const key = (shifted && physical.shiftKey) || definition.key || "";
  const text =
    (shifted && physical.shiftText) || definition.text || (key.length === 1 ? key : undefined);
  return {
    key,
    code: definition.code ?? "",
    keyCode: (shifted && physical.shiftKeyCode) || definition.keyCode || 0,
    ...(text !== undefined && !(modifiers & ~SHIFT) ? { text } : {}),
    ...(definition.location ? { location: definition.location } : {}),
  };
}

export function chordStroke(chord: string): { stroke: KeyStroke; modifiers: number } {
  const { key, modifiers } = parseChord(chord);
  return { stroke: keyStroke(key, modifiers), modifiers };
}

export async function press(
  context: InputContext,
  session: CDPSession,
  chord: string,
): Promise<boolean> {
  const { stroke, modifiers } = chordStroke(chord);
  const common = {
    key: stroke.key,
    code: stroke.code,
    windowsVirtualKeyCode: stroke.keyCode,
    ...(stroke.location ? { location: stroke.location, isKeypad: stroke.location === 3 } : {}),
    ...(modifiers ? { modifiers } : {}),
  };
  const up: Protocol.Input.DispatchKeyEventRequest = { ...common, type: "keyUp" };
  context.touch();
  const down = await send(context, session, "Input.dispatchKeyEvent", {
    ...common,
    ...(stroke.text === undefined
      ? { type: "rawKeyDown" }
      : { type: "keyDown", text: stroke.text, unmodifiedText: stroke.text }),
  }).catch((error: unknown) => {
    void session.send("Input.dispatchKeyEvent", up).catch(() => undefined);
    throw error;
  });
  if (down) {
    context.holdKey({ session, keyUp: up });
    return true;
  }
  return send(context, session, "Input.dispatchKeyEvent", { ...up });
}

export function insertText(
  context: InputContext,
  session: CDPSession,
  text: string,
): Promise<boolean> {
  context.touch();
  return send(context, session, "Input.insertText", { text });
}

export async function typeText(
  context: InputContext,
  session: CDPSession,
  text: string,
  delay = 0,
): Promise<boolean> {
  let typed = 0;
  const characters = [...text.replace(/\r\n?/g, "\n")];
  for (const character of characters) {
    if (context.halted()) {
      throw new CommandError(
        "cancelled",
        "Typing stopped because the execution ended.",
        "halted",
        typed > 0 ? "applied" : "none",
      );
    }
    const opened = await press(context, session, character);
    typed++;
    if (opened && typed < characters.length) {
      throw new CommandError(
        "dialog_pending",
        `A dialog opened after ${typed} of ${characters.length} characters. Answer it, then type the rest.`,
        "during_type",
        "applied",
      );
    }
    if (opened) {
      return true;
    }
    if (delay > 0) {
      await context.pause(delay);
    }
  }
  return false;
}

function send(
  context: InputContext,
  session: CDPSession,
  method: "Input.dispatchKeyEvent" | "Input.insertText",
  params: Record<string, unknown>,
): Promise<boolean> {
  return sendOrDialog(
    context,
    session.send(method, params as never),
    () =>
      new CommandError(
        "timeout",
        "The page did not take the keyboard input in time.",
        "input",
        "unknown",
      ),
    "unknown",
    "keyboard",
  );
}
