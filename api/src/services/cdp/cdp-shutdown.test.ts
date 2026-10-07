import { EventEmitter } from "node:events";
import puppeteer, { type Browser } from "puppeteer-core";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("../../env.js", () => ({ env: {} }));
vi.mock("../../telemetry/tracer.js", () => ({
  traceable: (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
  tracer: { startActiveSpan: (_name: string, fn: () => unknown) => fn() },
}));
vi.mock("./utils/validation.js", async (original) => ({
  ...(await original<typeof import("./utils/validation.js")>()),
  isSimilarConfig: async () => true,
}));
afterEach(() => vi.useRealTimers());
import { CDPService } from "./cdp.service.js";
import { LaunchShutdownGate } from "./launch-shutdown-gate.js";
import { RetryManager } from "../../utils/retry.js";
import { PluginManager } from "./plugins/core/plugin-manager.js";
import { BasePlugin } from "./plugins/core/base-plugin.js";
function fixture() {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const service = Object.create(CDPService.prototype) as CDPService;
  const internal = vi.fn();
  Object.assign(service, {
    launchShutdownGate: new LaunchShutdownGate(logger.error),
    retryManager: new RetryManager(logger as any),
    launchInternal: internal,
    pluginManager: { onShutdown: vi.fn().mockResolvedValue(undefined) },
    shutdownHook: vi.fn().mockResolvedValue(undefined),
    logger,
  });
  return { service, internal };
}
it("rejects future public launch calls without invoking launch or retry cleanup", async () => {
  const { service, internal } = fixture();
  service.sealForShutdown();
  await expect(service.launch()).rejects.toMatchObject({ isRetryable: false });
  expect(internal).not.toHaveBeenCalled();
});
it("fences an in-flight public launch result with the actual retry manager", async () => {
  const { service, internal } = fixture();
  const pending = Promise.withResolvers<Browser>();
  internal.mockReturnValue(pending.promise);
  const proc = { exitCode: null, signalCode: null, kill: vi.fn() };
  const browser = { process: () => proc, close: vi.fn().mockResolvedValue(undefined) };
  const result = service.launch();
  service.sealForShutdown();
  pending.resolve(browser as unknown as Browser);
  await expect(result).rejects.toMatchObject({ isRetryable: false });
  expect(internal).toHaveBeenCalledOnce();
  expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
});

function reuseFixture() {
  const { service } = fixture();
  EventEmitter.call(service);
  const proc = { exitCode: null, signalCode: null, kill: vi.fn() };
  const browser = { process: () => proc, close: vi.fn().mockResolvedValue(undefined) };
  const ready = vi.fn().mockResolvedValue(undefined);
  const beforeReuse = vi.fn().mockResolvedValue(undefined);
  const refresh = vi.fn().mockResolvedValue(undefined);
  Object.assign(service, {
    launchInternal: (CDPService.prototype as any).launchInternal,
    browserInstance: browser,
    launchConfig: {},
    defaultLaunchConfig: {},
    refreshPrimaryPage: refresh,
    pluginManager: {
      onBeforeBrowserReuse: beforeReuse,
      onBrowserReady: ready,
      onShutdown: vi.fn().mockResolvedValue(undefined),
    },
  });
  return { service, browser, proc, ready, refresh, beforeReuse };
}
it("configures reused browser ownership before refreshing its pages", async () => {
  const { service, beforeReuse, refresh, ready } = reuseFixture();
  const configured = Promise.withResolvers<void>();
  beforeReuse.mockReturnValue(configured.promise);
  const launch = service.launch();
  await vi.waitFor(() => expect(beforeReuse).toHaveBeenCalledOnce());
  expect(refresh).not.toHaveBeenCalled();
  expect(ready).not.toHaveBeenCalled();
  configured.resolve();
  await launch;
  expect(refresh).toHaveBeenCalledOnce();
  expect(ready).toHaveBeenCalledOnce();
});

it("propagates critical reuse configuration errors from the real plugin manager", async () => {
  const { service, refresh } = reuseFixture();
  const manager = new PluginManager(service, {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as any);
  class ReusePlugin extends BasePlugin {}
  const plugin = new ReusePlugin({ name: "reuse-owner" });
  plugin.onBeforeBrowserReuse = vi.fn().mockRejectedValue(new Error("owner unavailable"));
  manager.register(plugin);
  (service as any).pluginManager = manager;
  await expect((service as any).launchInternal()).rejects.toThrow("owner unavailable");
  expect(refresh).not.toHaveBeenCalled();
});
it("retires the real launch path at its deadline and refuses overlapping retries", async () => {
  vi.useFakeTimers();
  const { service, proc, ready, refresh } = reuseFixture();
  const pending = Promise.withResolvers<void>();
  refresh.mockReturnValue(pending.promise);
  const shutdown = vi.fn();
  service.on("shutdownRequired", shutdown);
  const result = service.launch();
  const rejected = expect(result).rejects.toMatchObject({ isRetryable: false, type: "TIMEOUT" });
  await vi.advanceTimersByTimeAsync(60000);
  await rejected;
  expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
  expect(shutdown).toHaveBeenCalledOnce();
  await expect(service.launch()).rejects.toMatchObject({ isRetryable: false });
  expect(refresh).toHaveBeenCalledOnce();
  pending.resolve();
  await vi.advanceTimersByTimeAsync(1);
  expect(ready).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it("clears the actual launch deadline after successful reuse", async () => {
  vi.useFakeTimers();
  const { service, browser, proc } = reuseFixture();
  const shutdown = vi.fn();
  service.on("shutdownRequired", shutdown);
  expect(await service.launch()).toBe(browser);
  await vi.advanceTimersByTimeAsync(60001);
  expect(shutdown).not.toHaveBeenCalled();
  expect(proc.kill).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["refresh", "ready"])(
  "checks elapsed time after %s even if the deadline timer has not run",
  async (stage) => {
    vi.useFakeTimers();
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    try {
      const { service, proc, ready, refresh } = reuseFixture();
      (stage === "refresh" ? refresh : ready).mockImplementation(async () => {
        now.mockReturnValue(60001);
      });
      const shutdown = vi.fn();
      service.on("shutdownRequired", shutdown);
      await expect(service.launch()).rejects.toMatchObject({ isRetryable: false, type: "TIMEOUT" });
      if (stage === "refresh") expect(ready).not.toHaveBeenCalled();
      else expect(ready).toHaveBeenCalledOnce();
      expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
      expect(shutdown).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      now.mockRestore();
    }
  },
);

it.each([true, false])(
  "shutdown retains the captured root until exit is confirmed: %s",
  async (exits) => {
    vi.useFakeTimers();
    const { FileService } = await import("../file.service.js");
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const files = vi
      .spyOn(FileService, "getInstance")
      .mockReturnValue({ cleanupFiles: cleanup } as any);
    try {
      const { service } = fixture();
      EventEmitter.call(service);
      const proc = Object.assign(new EventEmitter(), {
        exitCode: null as number | null,
        signalCode: null as NodeJS.Signals | null,
        kill: vi.fn(() => {
          if (exits) {
            proc.signalCode = "SIGKILL";
            proc.emit("exit", null, "SIGKILL");
          }
          return true;
        }),
      });
      let visible: typeof proc | null = proc;
      const browser = {
        process: () => visible,
        close: vi.fn(async () => {
          visible = null;
        }),
      };
      Object.assign(service, {
        browserInstance: browser,
        chromeSessionService: { invalidate: vi.fn() },
        removeAllHandlers: vi.fn(),
        pluginManager: { onBrowserClose: vi.fn(), onShutdown: vi.fn() },
      });
      const result = service.shutdown("session_end" as any);
      if (exits) {
        await result;
        expect((service as any).browserInstance).toBeNull();
        expect(cleanup).toHaveBeenCalledOnce();
      } else {
        const rejected = expect(result).rejects.toThrow("timed out");
        await vi.advanceTimersByTimeAsync(2001);
        await rejected;
        expect((service as any).browserInstance).toBe(browser);
        expect((service as any).shuttingDown).toBe(true);
        expect(cleanup).not.toHaveBeenCalled();
      }
      expect(proc.kill).toHaveBeenCalledWith("SIGKILL");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      files.mockRestore();
    }
  },
);

it.skipIf(!process.env.BROWSER_EXIT_TEST_EXECUTABLE).each(["graceful", "handle_lost"])(
  "confirms real Chromium exit through CDP shutdown: %s",
  async (mode) => {
    const browser = await puppeteer.launch({
      executablePath: process.env.BROWSER_EXIT_TEST_EXECUTABLE,
      headless: true,
      args: ["--disable-background-networking"],
      timeout: 10000,
    });
    const proc = browser.process()!;
    const { FileService } = await import("../file.service.js");
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const files = vi
      .spyOn(FileService, "getInstance")
      .mockReturnValue({ cleanupFiles: cleanup } as any);
    const watchdog = setTimeout(() => proc.kill("SIGKILL"), 5000);
    try {
      const { service } = fixture();
      EventEmitter.call(service);
      let visible: typeof proc | null = proc;
      const close = vi.fn(async () => {
        visible = null;
        if (mode === "graceful") await browser.close();
      });
      Object.assign(service, {
        browserInstance: { process: () => visible, close },
        chromeSessionService: { invalidate: vi.fn() },
        removeAllHandlers: vi.fn(),
        pluginManager: { onBrowserClose: vi.fn(), onShutdown: vi.fn() },
      });
      await service.shutdown("session_end" as any);
      expect(proc.exitCode !== null || proc.signalCode !== null).toBe(true);
      if (mode === "handle_lost") expect(proc.signalCode).toBe("SIGKILL");
      expect(close).toHaveBeenCalledOnce();
      expect(cleanup).toHaveBeenCalledOnce();
      expect((service as any).browserInstance).toBeNull();
      expect((service as any).shuttingDown).toBe(false);
    } finally {
      clearTimeout(watchdog);
      files.mockRestore();
      if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
      await browser.close();
    }
  },
  20000,
);
