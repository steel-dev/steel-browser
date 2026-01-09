import { describe, it, expect, vi, beforeEach } from "vitest";
import { BrowserRuntime } from "../facade/browser-runtime.js";
import { MockLauncher } from "../drivers/mock-launcher.js";
import { pino } from "pino";

import { BasePlugin } from "../../services/cdp/plugins/core/base-plugin.js";

class MockTestPlugin extends BasePlugin {
  constructor(name: string) {
    super({ name });
  }
}

describe("BrowserRuntime with MockLauncher", () => {
  let launcher: MockLauncher;
  let runtime: BrowserRuntime;
  const mockLogger = pino({ level: "silent" });
  const mockInstrumentationLogger = { record: vi.fn(), on: vi.fn(), resetContext: vi.fn() };

  beforeEach(() => {
    launcher = new MockLauncher();
    runtime = new BrowserRuntime({
      launcher,
      appLogger: mockLogger,
      instrumentationLogger: mockInstrumentationLogger as any,
      keepAlive: false,
    });
  });

  it("should start and stop normally", async () => {
    const config = { sessionId: "test-session", port: 9222 };
    const browserRef = await runtime.start(config);

    expect(browserRef).toBeDefined();
    expect(launcher.launchCalls.length).toBe(1);
    expect(launcher.launchCalls[0].sessionId).toBe("test-session");
    expect(runtime.isRunning()).toBe(true);

    await runtime.stop();
    expect(launcher.closeCalls.length).toBe(1);
    expect(runtime.isRunning()).toBe(false);
  });

  it("should handle launch failure", async () => {
    launcher = new MockLauncher({ shouldFail: true });
    runtime = new BrowserRuntime({ launcher, keepAlive: false });

    const config = { sessionId: "fail-session", port: 9222 };
    await expect(runtime.start(config)).rejects.toThrow("Mock launch failure");

    // Wait for cleanup to complete and reach idle
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(runtime.isRunning()).toBe(false);
    expect(runtime.getState()).toBe("idle");
  });

  it("should handle browser crash", async () => {
    const config = { sessionId: "crash-session", port: 9222 };
    const browserRef = await runtime.start(config);

    expect(runtime.isRunning()).toBe(true);

    // Simulate crash
    launcher.simulateCrash(browserRef);

    // Wait for machine to transition to idle
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(runtime.isRunning()).toBe(false);
    expect(runtime.getState()).toBe("idle");
    expect(launcher.closeCalls.length).toBe(1); // Cleanup should run on crash
  });

  it("should handle slow launch", async () => {
    launcher = new MockLauncher({ launchDelay: 500 });
    runtime = new BrowserRuntime({ launcher, keepAlive: false });

    const config = { sessionId: "slow-session", port: 9222 };
    const startTime = Date.now();
    await runtime.start(config);
    const duration = Date.now() - startTime;

    expect(runtime.isRunning()).toBe(true);

    await runtime.stop();
  });

  it("should handle endSession with draining and phased cleanup", async () => {
    const config = { sessionId: "drain-session", port: 9222 };
    await runtime.start(config);

    expect(runtime.isRunning()).toBe(true);

    await runtime.endSession();

    expect(launcher.closeCalls.length).toBe(1);
    expect(runtime.getState()).toBe("idle");
  });

  it("should notify plugins during endSession", async () => {
    const mockPlugin = new MockTestPlugin("test-plugin");
    const onSessionEndSpy = vi.spyOn(mockPlugin, "onSessionEnd").mockResolvedValue(undefined);
    runtime.registerPlugin(mockPlugin);

    const config = { sessionId: "plugin-session", port: 9222 };
    await runtime.start(config);

    await runtime.endSession();

    expect(onSessionEndSpy).toHaveBeenCalled();
  });

  it("should bypass draining on stop", async () => {
    const mockPlugin = new MockTestPlugin("slow-plugin");
    const onSessionEndSpy = vi
      .spyOn(mockPlugin, "onSessionEnd")
      .mockImplementation(() => new Promise((r) => setTimeout(r, 1000)));
    runtime.registerPlugin(mockPlugin);

    await runtime.start({ sessionId: "stop-session", port: 9222 });

    const startTime = Date.now();
    await runtime.stop();
    const duration = Date.now() - startTime;

    // stop() should be fast as it bypasses draining
    expect(duration).toBeLessThan(500);
    expect(onSessionEndSpy).not.toHaveBeenCalled();
  });
});
