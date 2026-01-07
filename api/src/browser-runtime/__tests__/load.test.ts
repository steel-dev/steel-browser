import { describe, it, expect } from "vitest";
import { BrowserRuntime } from "../facade/browser-runtime.js";
import { SimulatedLauncher } from "../drivers/simulated-launcher.js";

describe("Load testing with SimulatedLauncher", () => {
  it("should handle 10 concurrent browser sessions", async () => {
    const launcher = new SimulatedLauncher({
      avgLaunchTimeMs: 100,
      crashProbability: 0.1,
    });

    const runtimes = Array.from({ length: 10 }, () => new BrowserRuntime({ launcher }));

    console.log("Starting 10 concurrent sessions...");
    const startPromises = runtimes.map((r, i) =>
      r.start({ sessionId: `session-${i}`, port: 9000 + i }),
    );

    const results = await Promise.allSettled(startPromises);
    const successful = results.filter((r) => r.status === "fulfilled").length;
    console.log(`Successfully started ${successful}/10 sessions`);

    expect(successful).toBeGreaterThan(0);

    // Get metrics
    const metrics = launcher.getMetrics();
    console.log("Launcher Metrics:", metrics);

    expect(metrics.totalLaunched).toBe(10);

    // Stop all
    console.log("Stopping all sessions...");
    await Promise.all(runtimes.map((r) => r.stop().catch(() => {})));

    const finalMetrics = launcher.getMetrics();
    console.log("Final Metrics:", finalMetrics);
    expect(finalMetrics.currentActive).toBe(0);
  });

  it("should scale to 20 sequential sessions quickly", async () => {
    const launcher = new SimulatedLauncher({ avgLaunchTimeMs: 10 });
    const runtime = new BrowserRuntime({ launcher });

    console.log("Starting 20 sequential sessions...");
    for (let i = 0; i < 20; i++) {
      await runtime.start({ sessionId: `seq-${i}`, port: 9222 });
      await runtime.stop();
    }

    const metrics = launcher.getMetrics();
    console.log("Sequential Metrics:", metrics);
    expect(metrics.totalLaunched).toBe(20);
  });
});
