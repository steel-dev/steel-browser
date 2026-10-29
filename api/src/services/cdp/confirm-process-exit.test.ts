import { EventEmitter, once } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { confirmBrowserProcessExit } from "./confirm-process-exit.js";
function fixture() {
  return Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill: vi.fn().mockReturnValue(true),
  });
}
afterEach(() => vi.useRealTimers());
it("does not confuse a successful signal with confirmed exit", async () => {
  vi.useFakeTimers();
  const proc = fixture();
  const result = confirmBrowserProcessExit(proc as unknown as ChildProcess, 25);
  const rejected = expect(result).rejects.toThrow("timed out");
  expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
  await vi.advanceTimersByTimeAsync(25);
  await rejected;
  expect(proc.listenerCount("exit")).toBe(0);
  expect(proc.listenerCount("error")).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});
it("accepts an observed exit and cleans up listeners and deadline", async () => {
  vi.useFakeTimers();
  const proc = fixture();
  const result = confirmBrowserProcessExit(proc as unknown as ChildProcess);
  proc.signalCode = "SIGKILL";
  proc.emit("exit", null, "SIGKILL");
  await result;
  expect(vi.getTimerCount()).toBe(0);
  expect(proc.listenerCount("error")).toBe(0);
  await confirmBrowserProcessExit(proc as unknown as ChildProcess);
  expect(proc.kill).toHaveBeenCalledOnce();
});
it("rejects missing handles and signal errors", async () => {
  await expect(confirmBrowserProcessExit(null)).rejects.toThrow("owned handle");
  const proc = fixture();
  proc.kill.mockImplementation(() => {
    throw new Error("not permitted");
  });
  await expect(confirmBrowserProcessExit(proc as unknown as ChildProcess)).rejects.toThrow(
    "could not be confirmed",
  );
  expect(proc.listenerCount("exit")).toBe(0);
});
it("confirms a real owned child exits", async () => {
  const proc = spawn(process.execPath, ["-e", 'process.send("ready");setInterval(()=>{},1000)'], {
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const watchdog = setTimeout(() => proc.kill("SIGKILL"), 3000);
  try {
    await once(proc, "message");
    await confirmBrowserProcessExit(proc);
    expect(proc.signalCode).toBe("SIGKILL");
  } finally {
    clearTimeout(watchdog);
    if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
  }
});
