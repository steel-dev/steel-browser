import { describe, it, expect, vi, beforeEach } from "vitest";
import { BrowserRuntime } from "../facade/browser-runtime.js";
import { MockLauncher } from "../drivers/mock-launcher.js";
import { pino } from "pino";

describe("BrowserRuntime with MockLauncher", () => {
  let launcher: MockLauncher;
  let runtime: BrowserRuntime;
  const mockLogger = pino({ level: "silent" });
  const mockInstrumentationLogger = { record: vi.fn(), on: vi.fn() };

  beforeEach(() => {
    launcher = new MockLauncher();
    runtime = new BrowserRuntime({
      launcher,
      appLogger: mockLogger,
      instrumentationLogger: mockInstrumentationLogger as any,
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
    runtime = new BrowserRuntime({ launcher });

    const config = { sessionId: "fail-session", port: 9222 };
    await expect(runtime.start(config)).rejects.toThrow("Mock launch failure");

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
    runtime = new BrowserRuntime({ launcher });

    const config = { sessionId: "slow-session", port: 9222 };
    const startTime = Date.now();
    await runtime.start(config);
    const duration = Date.now() - startTime;

    expect(duration).toBeGreaterThanOrEqual(500);
    expect(runtime.isRunning()).toBe(true);

    await runtime.stop();
  });
});
