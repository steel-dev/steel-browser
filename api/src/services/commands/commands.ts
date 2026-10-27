import { createHash } from "node:crypto";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { LOCATOR_KINDS } from "./targets.js";

const tab = z
  .string()
  .regex(/^t\d+$/)
  .optional();

const snapshotOptions = {
  interactive: z.boolean().optional(),
  compact: z.boolean().optional(),
  depth: z.number().int().nonnegative().optional(),
};

const filled = z.string().regex(/\S/, "Must contain more than spaces.");

const locator = z
  .object({
    role: filled.optional(),
    name: filled.optional(),
    text: filled.optional(),
    label: filled.optional(),
    placeholder: filled.optional(),
    alt: filled.optional(),
    title: filled.optional(),
    testid: filled.optional(),
    css: filled.optional(),
    exact: z.boolean().optional(),
    nth: z.number().int().optional(),
  })
  .strict()
  .refine((value) => LOCATOR_KINDS.filter((kind) => value[kind] !== undefined).length === 1, {
    message: `A locator needs exactly one of ${LOCATOR_KINDS.join(", ")}.`,
  })
  .refine((value) => value.name === undefined || value.role !== undefined, {
    message: "name works only with role.",
  });

const target = z.union([filled, locator]);

const scoped = {
  tab,
  frame: z.string().min(1).optional(),
  expect: z
    .object({ role: z.string().min(1).optional(), name: z.string().optional() })
    .strict()
    .optional(),
};

const element = { target, ...scoped };

function strict<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).strict();
}

export const commandSchema = z.discriminatedUnion("command", [
  strict({ command: z.literal("navigate"), url: z.string().min(1), tab }),
  strict({ command: z.literal("back"), tab }),
  strict({ command: z.literal("forward"), tab }),
  strict({ command: z.literal("reload"), tab }),
  strict({ command: z.literal("snapshot"), tab, ...snapshotOptions }),
  strict({ command: z.literal("click"), ...element }),
  strict({ command: z.literal("dblclick"), ...element }),
  strict({ command: z.literal("hover"), ...element }),
  strict({ command: z.literal("focus"), ...element }),
  strict({
    command: z.literal("type"),
    ...element,
    text: z.string(),
    clear: z.boolean().optional(),
    delay: z.number().int().min(0).max(1000).optional(),
  }),
  strict({ command: z.literal("fill"), ...element, value: z.string() }),
  strict({
    command: z.literal("press"),
    key: z.string().min(1),
    target: target.optional(),
    ...scoped,
  }),
  strict({ command: z.literal("keydown"), key: z.string().min(1), tab }),
  strict({ command: z.literal("keyup"), key: z.string().min(1), tab }),
  strict({
    command: z.literal("mouse"),
    action: z.enum(["move", "down", "up", "click", "wheel"]),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    button: z.enum(["left", "right", "middle"]).optional(),
    clicks: z.number().int().min(1).max(3).optional(),
    deltaX: z.number().finite().optional(),
    deltaY: z.number().finite().optional(),
    tab,
  }),
  strict({
    command: z.literal("select"),
    ...element,
    values: z.union([z.string(), z.array(z.string()).min(1)]),
  }),
  strict({ command: z.literal("check"), ...element }),
  strict({
    command: z.literal("upload"),
    ...element,
    files: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  }),
  strict({
    command: z.literal("drag"),
    source: target,
    target,
    tab,
    frame: z.string().min(1).optional(),
  }),
  strict({ command: z.literal("uncheck"), ...element }),
  strict({
    command: z.literal("get"),
    what: z.enum(["text", "html", "markdown", "value", "attr", "title", "url", "count", "box"]),
    target: target.optional(),
    attribute: z.string().min(1).optional(),
    ...scoped,
  }),
  strict({
    command: z.literal("is"),
    what: z.enum(["visible", "enabled", "checked"]),
    ...element,
  }),
  strict({
    command: z.literal("wait"),
    target: target.optional(),
    state: z.enum(["visible", "hidden", "attached", "detached"]).optional(),
    text: z.string().min(1).optional(),
    url: z.string().min(1).optional(),
    load: z.enum(["load", "domcontentloaded", "networkidle"]).optional(),
    ms: z.number().int().min(0).max(30_000).optional(),
    download: z.literal(true).optional(),
    timeout: z.number().int().min(0).max(50_000).optional(),
    ...scoped,
  }),
  strict({
    command: z.literal("screenshot"),
    target: target.optional(),
    fullPage: z.boolean().optional(),
    format: z.enum(["png", "jpeg", "webp"]).optional(),
    quality: z.number().int().min(0).max(100).optional(),
    ...scoped,
  }),
  strict({
    command: z.literal("eval"),
    script: z.string().min(1),
    timeout: z.number().int().min(0).max(50_000).optional(),
    tab,
  }),
  strict({
    command: z.literal("pdf"),
    tab,
    landscape: z.boolean().optional(),
    printBackground: z.boolean().optional(),
  }),
  strict({
    command: z.literal("scroll"),
    direction: z.enum(["up", "down", "left", "right"]).optional(),
    amount: z.number().min(1).optional(),
    target: target.optional(),
    ...scoped,
  }),
  strict({
    command: z.literal("find"),
    by: z.enum(LOCATOR_KINDS),
    value: filled,
    name: filled.optional(),
    exact: z.boolean().optional(),
    tab,
    frame: z.string().min(1).optional(),
  }),
  strict({
    command: z.literal("tab"),
    action: z.enum(["list", "new", "close"]),
    tab,
    url: z.string().min(1).optional(),
  }),
  strict({ command: z.literal("status"), execution: z.string().min(1) }),
  strict({ command: z.literal("cancel"), execution: z.string().min(1) }),
  strict({
    command: z.literal("dialog"),
    dialog: z.string().min(1),
    action: z.enum(["accept", "dismiss"]),
    text: z.string().optional(),
  }),
]);

export type Command = z.infer<typeof commandSchema>;

const commandList = z.array(commandSchema).min(1).max(50);

export const requestSchema = z
  .object({
    after: z.string().min(1).optional(),
    commands: z.preprocess(
      (value) => (value === undefined || Array.isArray(value) ? value : [value]),
      commandList,
    ),
    eventsAfter: z
      .string()
      .regex(/^c-\d+$/)
      .optional(),
    observe: z
      .object({
        mode: z.enum(["none", "snapshot", "diff"]),
        base: z.string().min(1).optional(),
        tab,
        ...snapshotOptions,
      })
      .strict()
      .optional(),
  })
  .strict();

export type CommandRequest = z.infer<typeof requestSchema>;

export const publishedRequestSchema = requestSchema.extend({
  commands: z.union([commandSchema, commandList]),
});

export const COMMANDS_API_VERSION = 1;

export function requestJsonSchema() {
  return zodToJsonSchema(publishedRequestSchema, {
    name: "CommandRequest",
    definitions: { Command: commandSchema },
  });
}

const MUTATING = new Set([
  "navigate",
  "back",
  "forward",
  "reload",
  "click",
  "dblclick",
  "hover",
  "focus",
  "type",
  "fill",
  "press",
  "select",
  "check",
  "uncheck",
  "scroll",
  "screenshot",
  "upload",
  "drag",
  "keydown",
  "keyup",
  "mouse",
  "eval",
]);

const CONTROL = new Set(["status", "cancel", "dialog"]);

export function isMutating(command: Command): boolean {
  if (command.command === "tab") {
    return command.action !== "list";
  }
  return MUTATING.has(command.command);
}

export function isControl(command: Command): boolean {
  return CONTROL.has(command.command);
}

export function commandHash(commands: Command[]): string {
  return createHash("sha256").update(JSON.stringify({ commands })).digest("hex");
}

export function scopedKey(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}
