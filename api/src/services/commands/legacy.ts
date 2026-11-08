import { z } from "zod";
import { LOCATOR_KINDS } from "./targets.js";

export const DEPRECATED_HEADER = "x-steel-deprecated";

export type LegacyForm = "eventsAfter" | "find" | "status" | "cancel" | "dialog";

const CONTROL: ReadonlySet<unknown> = new Set(["status", "cancel", "dialog"]);
const KINDS: ReadonlySet<unknown> = new Set(LOCATOR_KINDS);

export const legacyControlSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("status"), execution: z.string().min(1) }).strict(),
  z.object({ command: z.literal("cancel"), execution: z.string().min(1) }).strict(),
  z
    .object({
      command: z.literal("dialog"),
      dialog: z.string().min(1),
      action: z.enum(["accept", "dismiss"]),
      text: z.string().optional(),
    })
    .strict(),
]);

export type LegacyControl = z.infer<typeof legacyControlSchema>;

export interface LegacyRequest {
  body: unknown;
  forms: LegacyForm[];
  control?: unknown;
  mixed: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function upgradeFind(command: Record<string, unknown>): Record<string, unknown> {
  const { by, value, name, exact, ...rest } = command;
  if (rest.target !== undefined || !KINDS.has(by)) {
    return command;
  }
  return {
    ...rest,
    target: {
      [by as string]: value,
      ...(name !== undefined ? { name } : {}),
      ...(exact !== undefined ? { exact } : {}),
    },
  };
}

export function upgradeLegacy(body: unknown): LegacyRequest {
  if (!isRecord(body)) {
    return { body, forms: [], mixed: false };
  }
  const forms = new Set<LegacyForm>();
  const rest: Record<string, unknown> = { ...body };
  if ("eventsAfter" in rest) {
    forms.add("eventsAfter");
    delete rest.eventsAfter;
  }
  const given = rest.commands;
  const list: unknown[] = Array.isArray(given) ? given : given === undefined ? [] : [given];
  const controls = list.filter((command) => isRecord(command) && CONTROL.has(command.command));
  if (controls.length > 0) {
    for (const command of controls) {
      forms.add((command as { command: LegacyForm }).command);
    }
    return {
      body: rest,
      forms: [...forms],
      control: list.length === 1 ? list[0] : undefined,
      mixed: list.length > 1,
    };
  }
  const commands = list.map((command) => {
    if (isRecord(command) && command.command === "find" && "by" in command) {
      forms.add("find");
      return upgradeFind(command);
    }
    return command;
  });
  if (forms.size === 0) {
    return { body, forms: [], mixed: false };
  }
  if (given !== undefined) {
    rest.commands = Array.isArray(given) ? commands : commands[0];
  }
  return { body: rest, forms: [...forms], mixed: false };
}

export function deprecationHeader(forms: LegacyForm[]): Record<string, string> {
  return forms.length > 0 ? { [DEPRECATED_HEADER]: forms.join(", ") } : {};
}
