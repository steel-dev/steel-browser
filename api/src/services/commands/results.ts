import { CommandError, type CommandEffect } from "./errors.js";
import type { CommandResult, ErrorInfo } from "./records.js";

export function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  if (ms <= 0) {
    return Promise.resolve(undefined);
  }
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) => {
      timer = setTimeout(resolve, ms, undefined);
    }),
  ]).finally(() => clearTimeout(timer));
}

export function combine(results: { effect: CommandEffect }[]): CommandEffect {
  if (results.some((result) => result.effect === "unknown")) {
    return "unknown";
  }
  return results.some((result) => result.effect === "applied") ? "applied" : "none";
}

export function errorInfo(error: unknown): ErrorInfo {
  if (error instanceof CommandError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.reason ? { reason: error.reason } : {}),
    };
  }
  return { code: "internal_error", message: (error as Error).message ?? String(error) };
}

export function failed(error: unknown, effectOnCrash: CommandEffect): CommandResult {
  return {
    ok: false,
    effect: error instanceof CommandError ? error.effect : effectOnCrash,
    error: errorInfo(error),
  };
}

export function navigationError(error: unknown, url: string, timeoutMs: number): CommandError {
  if (error instanceof CommandError) {
    return error;
  }
  if (error instanceof Error && error.name === "TimeoutError") {
    return new CommandError(
      "timeout",
      `${url} did not finish loading within ${timeoutMs / 1000} seconds.`,
      "navigation",
      "unknown",
    );
  }
  const message = (error as Error).message ?? String(error);
  const net = message.match(/net::(ERR_[A-Z_]+)/)?.[1];
  return new CommandError(
    "navigation_failed",
    `Navigation to ${url} failed: ${net ?? message}`,
    net,
    net ? "applied" : "unknown",
  );
}
