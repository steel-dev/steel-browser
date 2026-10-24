import { z } from "zod";
import { publishedRequestSchema } from "../../services/commands/commands.js";

const Effect = z
  .enum(["none", "applied", "unknown"])
  .describe("What happened to the page: nothing, a change, or a possible change.");

const ErrorInfo = z.object({
  code: z.string().describe("Error code, such as stale_ref or not_actionable."),
  message: z.string(),
  reason: z.string().optional().describe("More detail, such as covered or detached."),
});

const Dialog = z.object({
  id: z.string(),
  tab: z.string(),
  type: z.enum(["alert", "confirm", "prompt", "beforeunload"]),
  message: z.string(),
  defaultPrompt: z.string().optional(),
  accepted: z.boolean().optional(),
  text: z.string().optional(),
  by: z.enum(["auto", "request", "command", "client", "closed"]).optional(),
});

const CommandResult = z
  .object({
    ok: z.boolean(),
    effect: Effect,
    error: ErrorInfo.optional(),
  })
  .passthrough()
  .describe(
    "Result of one command. Commands add their own fields, such as snapshot, value, url, or loading.",
  );

const Events = z.object({
  cursor: z.string(),
  items: z.array(
    z.object({ id: z.string(), type: z.string(), tab: z.string(), at: z.string() }).passthrough(),
  ),
  more: z.boolean().optional(),
  truncated: z.boolean().optional(),
});

const CommandResponse = z.object({
  next: z.string().optional().describe("Send it as after in the next request."),
  epoch: z.number().int().describe("Goes up when the page changes or the browser restarts."),
  epochChanged: z
    .boolean()
    .optional()
    .describe("Whether another client changed the session since after."),
  page: z
    .object({ tab: z.string(), url: z.string(), title: z.string() })
    .nullable()
    .describe("The tab the execution used."),
  execution: z.object({
    id: z.string(),
    state: z.enum(["queued", "running", "completed", "failed", "cancelled", "timeout", "expired"]),
    effect: Effect,
    replayed: z.boolean(),
    ran: z.number().int().describe("Commands started."),
    error: ErrorInfo.optional(),
  }),
  results: z.array(CommandResult),
  observe: z
    .object({
      snapshotId: z.string(),
      snapshot: z.string(),
      base: z.string(),
      diff: z.string(),
      additions: z.number().int(),
      removals: z.number().int(),
      full: z.boolean(),
      error: ErrorInfo,
    })
    .partial()
    .optional(),
  dialog: Dialog.optional().describe("A dialog that is open on the tab and waits for an answer."),
  dialogs: z.array(Dialog).optional().describe("Dialogs answered during the execution."),
  events: Events.optional(),
  bodyExpired: z.boolean().optional(),
});

const CommandDialogResponse = z
  .object({
    answered: Dialog.describe("The dialog that the dialog command answered."),
    epoch: z.number().int(),
    events: Events.optional(),
  })
  .describe("Response to the dialog command.");

const CommandRequestError = z
  .object({
    error: z.object({ code: z.string(), message: z.string() }),
  })
  .passthrough();

const CommandsSchemaResponse = z.object({
  version: z.number().int(),
  schema: z.record(z.unknown()).describe("JSON Schema of the request body."),
});

export const commandsSchemas = {
  CommandRequest: publishedRequestSchema,
  CommandResponse,
  CommandDialogResponse,
  CommandRequestError,
  CommandsSchemaResponse,
};

export default commandsSchemas;
