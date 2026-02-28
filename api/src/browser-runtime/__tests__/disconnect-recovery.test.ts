import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BrowserRuntime } from "../facade/browser-runtime.js";
import { MockLauncher } from "../drivers/mock-launcher.js";
import { pino } from "pino";

describe("BrowserRuntime Disconnect Recovery", () => {
  const mockLogger = pino({ level: "silent" });
  let launcher: MockLauncher;
  let runtime: BrowserRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    launcher = new MockLauncher();
  });

  afterEach(async () => {
    if (runtime) {
      await runtime.shutdown().catch(() => {});
    }
  });

  it("should NOT auto-recover on browser disconnect by default (if not configured)", async () => {
    runtime = new BrowserRuntime({
      launcher,
      appLogger: mockLogger,
      keepAlive: false,
    });

    const browser = await runtime.launch({ options: { headless: true } } as any);
    const browserRef = runtime.getBrowser();
    expect(browserRef).toBeDefined();

    // Simulate crash
    launcher.simulateCrash(browserRef!);

    // Wait for machine to reach idle
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(runtime.isRunning()).toBe(false);
    expect(runtime.getState()).toBe("idle");
  });

  it("should auto-recover on browser disconnect when keepAlive is true", async () => {
    // Note: This test might fail if auto-recovery isn't implemented in the new runtime yet
    runtime = new BrowserRuntime({
      launcher,
      appLogger: mockLogger,
      keepAlive: true,
      defaultLaunchConfig: { options: { headless: true } } as any,
    });

    await runtime.launch({ options: { headless: true } } as any);
    const browserRef1 = runtime.getBrowser();
    expect(browserRef1).toBeDefined();

    // Simulate crash
    launcher.simulateCrash(browserRef1!);

    // Wait for it to become running again
    await new Promise((resolve) => {
      const check = () => {
        if (runtime.isRunning()) {
          resolve(true);
        } else {
          setTimeout(check, 100);
        }
      };
      check();
      // Timeout after 5s
      setTimeout(() => resolve(false), 5000);
    });

    expect(runtime.isRunning()).toBe(true);
    const browserRef2 = runtime.getBrowser();
    expect(browserRef2).toBeDefined();
    expect(browserRef2?.id).toBe(browserRef1?.id); // Should use same sessionId if not specified
    expect(browserRef2?.launchedAt).toBeGreaterThan(browserRef1?.launchedAt || 0);
  });

  it("should NOT auto-recover when intentional shutdown is in progress", async () => {
    runtime = new BrowserRuntime({
      launcher,
      appLogger: mockLogger,
      keepAlive: true,
    });

    await runtime.launch({ options: { headless: true } } as any);

    const shutdownPromise = runtime.shutdown();

    // Simulate crash during shutdown
    const browserRef = runtime.getBrowser();
    launcher.simulateCrash(browserRef!);

    await shutdownPromise;

    expect(runtime.isRunning()).toBe(false);
    expect(runtime.getState()).toBe("idle");
  });
});
