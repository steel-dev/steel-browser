import { afterEach, describe, expect, it, vi } from "vitest";
import { LaunchScope } from "./launch-scope.js";

afterEach(() => vi.useRealTimers());
const deferred = <T>() => Promise.withResolvers<T>();

describe("LaunchScope", () => {
  it("fences a late step and drains it without starting follow-up work", async () => {
    vi.useFakeTimers();
    const scope = new LaunchScope(60_000);
    const pending = deferred<void>();
    const followUp = vi.fn();
    const work = (async () => {
      await scope.step(() => pending.promise);
      await scope.step(followUp);
    })();
    const failure = expect(work).rejects.toMatchObject({ type: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(60_000);
    await failure;
    let drained = false;
    const drain = scope.drained().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    pending.resolve();
    await drain;
    expect(followUp).not.toHaveBeenCalled();
    scope.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("closes an owned browser delivered after the deadline without publishing it", async () => {
    vi.useFakeTimers();
    const scope = new LaunchScope(60_000);
    const launch = deferred<object>();
    const close = vi.fn().mockResolvedValue(undefined);
    const work = scope.own(() => launch.promise, close);
    const failure = expect(work).rejects.toMatchObject({ type: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(60_000);
    await failure;
    const browser = {};
    launch.resolve(browser);
    await scope.drained();
    expect(close).toHaveBeenCalledExactlyOnceWith(browser);
    scope.dispose();
  });

  it("closes a browser already owned when the caller cancels", async () => {
    const cancellation = new AbortController();
    const scope = new LaunchScope(60_000, cancellation.signal);
    const close = vi.fn().mockResolvedValue(undefined);
    const browser = await scope.own(async () => ({}), close);
    cancellation.abort(new DOMException("fixture", "AbortError"));
    await scope.drained();
    expect(close).toHaveBeenCalledExactlyOnceWith(browser);
    scope.dispose();
  });

  it("does not schedule anything for an already cancelled caller", async () => {
    const cancellation = new AbortController();
    cancellation.abort();
    const scope = new LaunchScope(60_000, cancellation.signal);
    const operation = vi.fn();
    await expect(scope.step(operation)).rejects.toMatchObject({ name: "AbortError" });
    expect(operation).not.toHaveBeenCalled();
    scope.dispose();
  });

  it("does not close a successfully transferred browser after disposal", async () => {
    vi.useFakeTimers();
    const cancellation = new AbortController();
    const scope = new LaunchScope(60_000, cancellation.signal);
    const close = vi.fn();
    await scope.own(async () => ({}), close);
    scope.dispose();
    cancellation.abort();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(close).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("records unconfirmed cleanup instead of treating the lease as drained", async () => {
    const scope = new LaunchScope(60_000);
    await scope.own(
      async () => ({}),
      async () => {
        throw new Error("close unknown");
      },
    );
    scope.abort(new Error("fixture cancellation"));
    await expect(scope.drained()).rejects.toThrow("close unknown");
    scope.dispose();
  });
});
