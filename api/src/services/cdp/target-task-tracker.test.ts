import { describe, expect, it, vi } from "vitest";

import { TargetTaskTracker, isTargetCloseError } from "./target-task-tracker.js";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("TargetTaskTracker", () => {
  it("drains an accepted target task and contains Target closed during shutdown", async () => {
    const errors: unknown[] = [];
    const pending = deferred();
    const tracker = new TargetTaskTracker({
      onError: (error) => errors.push(error),
    });

    expect(tracker.schedule(() => pending.promise)).toBe(true);
    const stopping = tracker.stop(100);
    pending.reject(new Error("Protocol error (Page.addScriptToEvaluateOnNewDocument): Target closed"));

    await expect(stopping).resolves.toBe(true);
    expect(errors).toEqual([]);
    expect(tracker.size).toBe(0);
  });

  it("rejects new target work once shutdown begins", async () => {
    const task = vi.fn(async () => undefined);
    const tracker = new TargetTaskTracker({ onError: vi.fn() });

    await expect(tracker.stop(100)).resolves.toBe(true);

    expect(tracker.schedule(task)).toBe(false);
    expect(task).not.toHaveBeenCalled();
  });

  it("reports unrelated target errors even when shutdown is active", async () => {
    const onError = vi.fn();
    const pending = deferred();
    const tracker = new TargetTaskTracker({ onError });

    tracker.schedule(() => pending.promise);
    const stopping = tracker.stop(100);
    const failure = new Error("instrumentation invariant failed");
    pending.reject(failure);

    await expect(stopping).resolves.toBe(true);
    expect(onError).toHaveBeenCalledWith(failure);
  });

  it("keeps timed-out work cancelled after a new generation resumes", async () => {
    vi.useFakeTimers();
    const entered = deferred();
    const release = deferred();
    let activeAfterResume: boolean | undefined;
    const tracker = new TargetTaskTracker({ onError: vi.fn() });

    try {
      tracker.schedule(async (isActive) => {
        entered.resolve();
        await release.promise;
        activeAfterResume = isActive();
      });
      await entered.promise;

      const stopping = tracker.stop(25);
      await vi.advanceTimersByTimeAsync(25);
      await expect(stopping).resolves.toBe(false);
      tracker.resume();
      release.resolve();
      await vi.runAllTimersAsync();

      expect(activeAfterResume).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("bounds shutdown while retaining rejection handling for a late target close", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const onTimeout = vi.fn();
    const pending = deferred();
    const tracker = new TargetTaskTracker({ onError, onTimeout });
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    process.on("unhandledRejection", onUnhandled);

    try {
      tracker.schedule(() => pending.promise);
      const stopping = tracker.stop(50);
      await vi.advanceTimersByTimeAsync(50);
      await expect(stopping).resolves.toBe(false);
      expect(onTimeout).toHaveBeenCalledWith(1);

      tracker.resume();
      pending.reject(new Error("Protocol error (Fetch.enable): Target closed"));
      await vi.runAllTimersAsync();
      await Promise.resolve();

      expect(onError).not.toHaveBeenCalled();
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      vi.useRealTimers();
    }
  });

  it("drops timed-out records while retaining late rejection handling", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const pending = deferred();
    const tracker = new TargetTaskTracker({ onError });
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    process.on("unhandledRejection", onUnhandled);

    try {
      tracker.schedule(() => pending.promise);
      const stopping = tracker.stop(25);
      await vi.advanceTimersByTimeAsync(25);
      await expect(stopping).resolves.toBe(false);
      expect(tracker.size).toBe(0);

      pending.reject(new Error("Protocol error (Fetch.enable): Target closed"));
      await vi.runAllTimersAsync();
      await Promise.resolve();
      expect(onError).not.toHaveBeenCalled();
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      vi.useRealTimers();
    }
  });

  it.each([
    [Object.assign(new Error("Protocol error (Page.addScriptToEvaluateOnNewDocument): Target closed"), { name: "TargetCloseError" }), true],
    [new Error("Protocol error (Fetch.enable): Session closed. Most likely the page has been closed."), true],
    [new Error("customer session closed by policy"), false],
    [new Error("Target closed accounting invariant failed"), false],
  ])("classifies target-close errors narrowly: %#", (error, expected) => {
    expect(isTargetCloseError(error)).toBe(expected);
  });
});
