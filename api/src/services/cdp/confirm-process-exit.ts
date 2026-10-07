import type { ChildProcess } from "node:child_process";

/** A kill return value is not exit evidence. Retain the owned root until exit is observed. */
export async function confirmBrowserProcessExit(
  process: ChildProcess | null | undefined,
  timeoutMs = 1000,
): Promise<void> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000)
    throw new Error("Invalid browser exit confirmation timeout");
  if (!process)
    throw new Error("Browser process exit cannot be confirmed without its owned handle");
  if (process.exitCode !== null || process.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.off("exit", onExit);
      process.off("error", onError);
      if (error) reject(error);
      else resolve();
    };
    const onExit = () => finish();
    const onError = () => finish(new Error("Browser process exit could not be confirmed"));
    // Referenced: losing other application handles must not skip this confirmation.
    const timer = setTimeout(
      () => finish(new Error("Browser process exit confirmation timed out")),
      timeoutMs,
    );
    process.once("exit", onExit);
    process.once("error", onError);
    try {
      process.kill("SIGKILL");
    } catch {
      onError();
    }
  });
}
