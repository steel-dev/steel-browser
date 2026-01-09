import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BrowserRuntime } from "./browser-runtime.js";
import { MockLauncher } from "../drivers/mock-launcher.js";
import { pino } from "pino";
import { isSimilarConfig } from "../../services/cdp/utils/validation.js";

vi.mock("../../services/cdp/utils/validation.js", () => ({
  isSimilarConfig: vi.fn().mockResolvedValue(true),
}));

vi.mock("../utils/timezone.js", () => ({
  fetchTimezone: vi.fn().mockResolvedValue("UTC"),
}));

describe("BrowserRuntime Facade", () => {
  const mockLogger = pino({ level: "silent" });
  const mockInstrumentationLogger = {
    record: vi.fn(),
    on: vi.fn(),
    resetContext: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  };
  let launcher: MockLauncher;
  let runtime: BrowserRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    launcher = new MockLauncher();
    runtime = new BrowserRuntime({
      launcher,
      appLogger: mockLogger,
      instrumentationLogger: mockInstrumentationLogger as any,
      keepAlive: false,
    });
  });

  afterEach(async () => {
    await runtime.shutdown().catch(() => {});
  });

  it("should start and stop the browser", async () => {
    expect(runtime.isRunning()).toBe(false);

    const browser = await runtime.launch({ options: { headless: true } } as any);

    expect(browser).toBeDefined();
    expect(runtime.isRunning()).toBe(true);
    expect(runtime.getState()).toContain("ready");

    await runtime.shutdown();
    expect(runtime.isRunning()).toBe(false);
    expect(runtime.getState()).toBe("idle");
  });

  describe("Concurrency Protection", () => {
    it("should serialize concurrent launch calls and return existing browser", async () => {
      const launch1 = runtime.launch({ options: { headless: true } } as any);
      const launch2 = runtime.launch({ options: { headless: true } } as any);

      const [browser1, browser2] = await Promise.all([launch1, launch2]);

      expect(browser1).toBeDefined();
      expect(browser2).toBe(browser1);
    });

    it("should serialize startNewSession calls", async () => {
      const session1 = runtime.startNewSession({ options: { sessionId: "s1" } } as any);
      const session2 = runtime.startNewSession({ options: { sessionId: "s2" } } as any);

      await Promise.all([session1, session2]);
      expect(runtime.isRunning()).toBe(true);
    });
  });

  describe("Config Similarity", () => {
    it("should reuse browser when config is similar", async () => {
      vi.mocked(isSimilarConfig).mockResolvedValue(true);

      const config1 = { options: { headless: true }, userDataDir: "/tmp/1" };
      const config2 = { options: { headless: true }, userDataDir: "/tmp/1" };

      const b1 = await runtime.launch(config1 as any);
      const b2 = await runtime.launch(config2 as any);

      expect(b1).toBe(b2);
    });

    it("should restart session when config differs", async () => {
      vi.mocked(isSimilarConfig).mockResolvedValue(false);

      const config1 = { options: { headless: true }, userDataDir: "/tmp/1" };
      const config2 = { options: { headless: false }, userDataDir: "/tmp/2" };

      const b1 = await runtime.launch(config1 as any);
      const b2 = await runtime.launch(config2 as any);

      expect(b1).not.toBe(b2);
    });
  });

  describe("Plugin Lifecycle", () => {
    it("should call plugin lifecycle methods", async () => {
      const mockPlugin = {
        name: "test-plugin",
        onBrowserLaunch: vi.fn(),
        onBrowserReady: vi.fn(),
        onSessionEnd: vi.fn(),
        onBrowserClose: vi.fn(),
        onShutdown: vi.fn(),
        onPageCreated: vi.fn(),
      };

      runtime.registerPlugin(mockPlugin as any);

      await runtime.launch({ options: { headless: true } } as any);

      // Wait for async initialization
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockPlugin.onBrowserLaunch).toHaveBeenCalled();
      expect(mockPlugin.onBrowserReady).toHaveBeenCalled();

      await runtime.endSession();
      expect(mockPlugin.onSessionEnd).toHaveBeenCalled();
      expect(mockPlugin.onBrowserClose).toHaveBeenCalled();

      await runtime.shutdown();
      expect(mockPlugin.onShutdown).toHaveBeenCalled();
    });
  });
});
