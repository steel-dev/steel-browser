export type CommandErrorCode =
  | "stale_ref"
  | "not_actionable"
  | "dialog_pending"
  | "element_not_found"
  | "invalid_argument"
  | "tab_not_found"
  | "tab_crashed"
  | "frame_not_found"
  | "tab_required"
  | "forbidden_url"
  | "forbidden_file"
  | "navigation_failed"
  | "timeout"
  | "cancelled"
  | "session_ended"
  | "browser_restarted"
  | "unknown_command"
  | "internal_error";

export type CommandEffect = "none" | "applied" | "unknown";

export class CommandError extends Error {
  constructor(
    readonly code: CommandErrorCode,
    message: string,
    readonly reason?: string,
    readonly effect: CommandEffect = "none",
  ) {
    super(message);
    this.name = "CommandError";
  }
}

export type RequestErrorCode =
  | "invalid_request"
  | "session_ended"
  | "queue_full"
  | "expired"
  | "records_full"
  | "key_conflict"
  | "invalid_operation_token"
  | "unknown_execution"
  | "dialog_not_pending";

const STATUS: Record<RequestErrorCode, number> = {
  invalid_request: 400,
  session_ended: 410,
  queue_full: 429,
  expired: 429,
  records_full: 429,
  key_conflict: 422,
  invalid_operation_token: 422,
  unknown_execution: 422,
  dialog_not_pending: 422,
};

export function withEffect(error: unknown, effect: CommandEffect): unknown {
  return error instanceof CommandError && error.effect === "none"
    ? new CommandError(error.code, error.message, error.reason, effect)
    : error;
}

export function statusFor(code: RequestErrorCode): number {
  return STATUS[code];
}
