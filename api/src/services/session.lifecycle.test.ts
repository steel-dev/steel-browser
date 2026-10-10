import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../env.js", () => ({ env: {} }));
vi.mock("fs/promises", () => ({ mkdir: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./timezone-fetcher.service.js", () => ({
  TimezoneFetcher: class {
    getTimezone() {
      return Promise.resolve("UTC");
    }
  },
}));
import { SessionService } from "./session.service.js";

const options = (sessionId: string) => ({ sessionId, timezone: "UTC", credentials: {} });
function fixture() {
  const runtime = {
    getUserAgent: () => "fixture",
    getDimensions: () => ({ width: 1280, height: 800 }),
    startNewSession: vi.fn().mockResolvedValue(undefined),
    waitForLaunchCleanup: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    endSession: vi.fn().mockResolvedValue(undefined),
  };
  const service = new SessionService({
    cdpService: runtime as never,
    seleniumService: { close: vi.fn() } as never,
    fileService: {} as never,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
  });
  return { service, runtime };
}
afterEach(() => vi.useRealTimers());
describe("SessionService singleton lifecycle", () => {
  it("rejects a second create without replacing a live session", async () => {
    const { service, runtime } = fixture();
    const first = await service.startSession(options("owned-A"));
    await expect(service.startSession(options("owned-B"))).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(service.activeSession.id).toBe(first.id);
    expect(runtime.startNewSession).toHaveBeenCalledOnce();
  });
  it("reserves startup synchronously before any asynchronous reset or launch", async () => {
    const { service, runtime } = fixture();
    const first = service.startSession(options("owned-A"));
    await expect(service.startSession(options("owned-B"))).rejects.toMatchObject({
      statusCode: 409,
    });
    await first;
    expect(runtime.startNewSession).toHaveBeenCalledOnce();
  });
  it("rejects a stale release ID without touching the active browser", async () => {
    const { service, runtime } = fixture();
    await service.startSession(options("owned-B"));
    await expect(service.endSession("stale-A")).rejects.toMatchObject({ statusCode: 404 });
    expect(runtime.endSession).not.toHaveBeenCalled();
    expect(service.activeSession.id).toBe("owned-B");
  });
  it("rejects a release racing an in-flight startup", async () => {
    const { service, runtime } = fixture();
    const launch = Promise.withResolvers<void>();
    runtime.startNewSession.mockReturnValue(launch.promise);
    const first = service.startSession(options("owned-A"));
    await vi.waitFor(() => expect(runtime.startNewSession).toHaveBeenCalledOnce());
    await expect(service.endSession("owned-A")).rejects.toMatchObject({ statusCode: 409 });
    launch.resolve();
    await first;
    expect(runtime.endSession).not.toHaveBeenCalled();
  });
  it("returns the 45s timeout and keeps ownership reserved until late startup settles", async () => {
    vi.useFakeTimers();
    const { service, runtime } = fixture();
    const launch = Promise.withResolvers<void>();
    runtime.startNewSession.mockReturnValueOnce(launch.promise);
    const first = service.startSession(options("owned-A"));
    const failure = expect(first).rejects.toMatchObject({ type: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(45_000);
    await failure;
    await expect(service.startSession(options("owned-B"))).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(runtime.shutdown).not.toHaveBeenCalled();
    launch.resolve();
    await (service as any).startupCleanup;
    expect(runtime.shutdown).toHaveBeenCalledOnce();
    expect(service.activeSession.status).toBe("idle");
    expect(service.activeSession.id).not.toBe("owned-A");
    await service.startSession(options("owned-B"));
    expect(service.activeSession.id).toBe("owned-B");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels startup, waits for CDP cleanup, and closes only the owned proxy", async () => {
    const { service, runtime } = fixture();
    const launch = Promise.withResolvers<void>();
    const cancellation = new AbortController();
    runtime.startNewSession.mockReturnValueOnce(launch.promise);
    const proxy = {
      url: "fixture",
      listen: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
    service.setProxyFactory(() => proxy as never);
    const first = service.startSession(
      { ...options("owned-A"), proxyUrl: "fixture" },
      { signal: cancellation.signal },
    );
    await vi.waitFor(() => expect(runtime.startNewSession).toHaveBeenCalledOnce());
    cancellation.abort(new DOMException("fixture", "AbortError"));
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    launch.resolve();
    await (service as any).startupCleanup;
    expect(proxy.close).toHaveBeenCalledExactlyOnceWith(true);
    expect(runtime.waitForLaunchCleanup).toHaveBeenCalledOnce();
    expect(service.activeSession.status).toBe("idle");
  });
  it("cleans a proxy factory result arriving after cancellation without listening", async () => {
    const { service } = fixture();
    const factory = Promise.withResolvers<any>();
    const cancellation = new AbortController();
    const invoked = vi.fn(() => factory.promise);
    service.setProxyFactory(invoked);
    const first = service.startSession(
      { ...options("owned-A"), proxyUrl: "fixture" },
      { signal: cancellation.signal },
    );
    await vi.waitFor(() => expect(invoked).toHaveBeenCalledOnce());
    cancellation.abort();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    const proxy = { listen: vi.fn(), close: vi.fn().mockResolvedValue(undefined) };
    factory.resolve(proxy);
    await (service as any).startupCleanup;
    expect(proxy.listen).not.toHaveBeenCalled();
    expect(proxy.close).toHaveBeenCalledExactlyOnceWith(true);
  });
  it("quarantines the singleton if startup cleanup cannot be confirmed", async () => {
    const { service, runtime } = fixture();
    runtime.startNewSession.mockRejectedValueOnce(new Error("launch failed"));
    runtime.shutdown.mockRejectedValueOnce(new Error("cleanup unknown"));
    await expect(service.startSession(options("owned-A"))).rejects.toThrow("launch failed");
    await expect((service as any).startupCleanup).rejects.toThrow("cleanup unknown");
    await expect(service.startSession(options("owned-B"))).rejects.toMatchObject({
      statusCode: 409,
    });
  });
  it("serializes release and retains explicit global release compatibility", async () => {
    const { service, runtime } = fixture();
    await service.startSession(options("owned-A"));
    const end = Promise.withResolvers<void>();
    runtime.endSession.mockReturnValueOnce(end.promise);
    const release = service.endSession();
    await expect(service.startSession(options("owned-B"))).rejects.toMatchObject({
      statusCode: 409,
    });
    await expect(service.endSession("owned-A")).rejects.toMatchObject({ statusCode: 409 });
    end.resolve();
    expect((await release).id).toBe("owned-A");
    expect(service.activeSession.status).toBe("idle");
  });
  it("does not admit a new session after unconfirmed release", async () => {
    const { service, runtime } = fixture();
    await service.startSession(options("owned-A"));
    runtime.endSession.mockRejectedValueOnce(new Error("release unknown"));
    await expect(service.endSession("owned-A")).rejects.toThrow("release unknown");
    await expect(service.startSession(options("owned-B"))).rejects.toMatchObject({
      statusCode: 409,
    });
  });
});
