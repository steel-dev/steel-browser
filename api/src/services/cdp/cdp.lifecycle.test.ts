import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../../env.js", () => ({
  env: { FILTER_CHROME_ARGS: [], SKIP_FINGERPRINT_INJECTION: true },
}));
vi.mock("../../utils/extensions.js", () => ({ getExtensionPaths: vi.fn().mockResolvedValue([]) }));
vi.mock("../file.service.js", () => ({
  FileService: class {
    static getInstance() {
      return { cleanupFiles: vi.fn().mockResolvedValue(undefined) };
    }
  },
}));
vi.mock("puppeteer-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("puppeteer-core")>()),
  default: { launch: vi.fn() },
}));
vi.mock("../timezone-fetcher.service.js", () => ({
  TimezoneFetcher: class {
    getTimezone() {
      return Promise.resolve("UTC");
    }
  },
}));
vi.mock("./utils/validation.js", () => ({
  isSimilarConfig: vi.fn().mockResolvedValue(true),
  validateLaunchConfig: vi.fn(),
  validateTimezone: vi.fn(),
}));
import { CDPService } from "./cdp.service.js";
import puppeteer from "puppeteer-core";
const logger = {
  child: () => logger,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};
function fixture() {
  const service = new CDPService({}, logger as never);
  const browser = {
    close: vi.fn().mockResolvedValue(undefined),
    process: vi.fn().mockReturnValue(null),
  };
  const ready = vi.fn().mockResolvedValue(undefined);
  Object.assign(service, {
    browserInstance: browser,
    launchConfig: {},
    defaultLaunchConfig: {},
    pluginManager: { onBrowserReady: ready },
    refreshPrimaryPage: vi.fn().mockResolvedValue(undefined),
    removeAllHandlers: vi.fn(),
  });
  return { service, browser, ready };
}
afterEach(() => vi.useRealTimers());
describe("CDP launch deadline and owned cleanup", () => {
  it("uses a bounded native launch and closes its late browser without publishing it", async () => {
    const { service, browser, ready } = fixture();
    const launchResult = Promise.withResolvers<any>();
    const controller = new AbortController();
    Object.assign(service, { browserInstance: null });
    vi.mocked(puppeteer.launch).mockReturnValueOnce(launchResult.promise);
    const launch = service.launch({ options: { timeout: 0 }, signal: controller.signal } as never);
    await vi.waitFor(() => expect(puppeteer.launch).toHaveBeenCalledOnce());
    expect(vi.mocked(puppeteer.launch).mock.calls[0][0]?.timeout).toBeGreaterThan(0);
    expect(vi.mocked(puppeteer.launch).mock.calls[0][0]?.timeout).toBeLessThanOrEqual(30_000);
    controller.abort();
    await expect(launch).rejects.toMatchObject({ name: "AbortError" });
    launchResult.resolve(browser);
    await service.waitForLaunchCleanup();
    expect(browser.close).toHaveBeenCalledOnce();
    expect(ready).not.toHaveBeenCalled();
    expect((service as any).browserInstance).toBeNull();
  });
  it("does not retry a partial launch when owned-resource cleanup fails", async () => {
    const { service } = fixture();
    const operation = vi.fn(async (_config, scope) => {
      await scope.own(
        async () => ({}),
        async () => {
          throw new Error("owned cleanup unknown");
        },
      );
      throw new Error("launch failed");
    });
    (service as any).launchInternal = operation;
    await expect(service.launch()).rejects.toThrow("owned cleanup unknown");
    await expect(service.waitForLaunchCleanup()).rejects.toThrow("owned cleanup unknown");
    await expect(service.launch()).rejects.toThrow("already in progress");
    expect(operation).toHaveBeenCalledOnce();
  });
  it("fences reused-browser work after 60s and keeps new launches blocked until it drains", async () => {
    vi.useFakeTimers();
    const { service, browser, ready } = fixture();
    const refresh = Promise.withResolvers<void>();
    (service as any).refreshPrimaryPage = () => refresh.promise;
    const launch = service.launch();
    const rejected = expect(launch).rejects.toMatchObject({ type: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(60_000);
    await rejected;
    expect(browser.close).toHaveBeenCalledOnce();
    expect(ready).not.toHaveBeenCalled();
    await expect(service.launch()).rejects.toThrow("already in progress");
    refresh.resolve();
    await service.waitForLaunchCleanup();
    expect(ready).not.toHaveBeenCalled();
    expect((service as any).browserInstance).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels on the caller's signal before the CDP deadline", async () => {
    const { service, browser, ready } = fixture();
    const refresh = Promise.withResolvers<void>();
    const controller = new AbortController();
    (service as any).refreshPrimaryPage = () => refresh.promise;
    const launch = service.launch({ signal: controller.signal } as never);
    await vi.waitFor(() => expect((service as any).refreshPrimaryPage).toBeDefined());
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort(new DOMException("delivery lost", "AbortError"));
    await expect(launch).rejects.toMatchObject({ name: "AbortError" });
    refresh.resolve();
    await service.waitForLaunchCleanup();
    expect(browser.close).toHaveBeenCalledOnce();
    expect(ready).not.toHaveBeenCalled();
  });
  it("does not start or close a browser for an already cancelled caller", async () => {
    const { service, browser, ready } = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(service.launch({ signal: controller.signal } as never)).rejects.toMatchObject({
      name: "AbortError",
    });
    await service.waitForLaunchCleanup();
    expect(browser.close).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
  });
  it("transfers ownership and clears the deadline after successful reuse", async () => {
    vi.useFakeTimers();
    const { service, browser, ready } = fixture();
    expect(await service.launch()).toBe(browser);
    await service.waitForLaunchCleanup();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ready).toHaveBeenCalledOnce();
    expect(browser.close).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("retains quarantine if closing the owned browser cannot be confirmed", async () => {
    const { service, browser } = fixture();
    const refresh = Promise.withResolvers<void>();
    const controller = new AbortController();
    browser.close.mockRejectedValue(new Error("close unknown"));
    (service as any).refreshPrimaryPage = () => refresh.promise;
    const launch = service.launch({ signal: controller.signal } as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await expect(launch).rejects.toMatchObject({ name: "AbortError" });
    refresh.resolve();
    await expect(service.waitForLaunchCleanup()).rejects.toThrow("close unknown");
    await expect(service.launch()).rejects.toThrow("already in progress");
  });
  it("kills only the owned process when its browser close times out", async () => {
    vi.useFakeTimers();
    const { service, browser } = fixture();
    browser.close.mockReturnValue(new Promise(() => {}));
    const process = Object.assign(new EventEmitter(), {
      exitCode: null,
      signalCode: null,
      kill: vi.fn(() => {
        queueMicrotask(() => process.emit("exit"));
        return true;
      }),
    });
    browser.process.mockReturnValue(process);
    const cleanup = (service as any).closeFailedLaunchBrowser(browser);
    await vi.advanceTimersByTimeAsync(5_000);
    await cleanup;
    expect(process.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not claim cleanup when owned process exit is unconfirmed", async () => {
    vi.useFakeTimers();
    const { service, browser } = fixture();
    browser.close.mockRejectedValue(new Error("close failed"));
    const process = Object.assign(new EventEmitter(), {
      exitCode: null,
      signalCode: null,
      kill: vi.fn(() => true),
    });
    browser.process.mockReturnValue(process);
    const cleanup = (service as any).closeFailedLaunchBrowser(browser);
    const failed = expect(cleanup).rejects.toThrow("exit is unconfirmed");
    await vi.advanceTimersByTimeAsync(2_000);
    await failed;
    expect(process.listenerCount("exit")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
