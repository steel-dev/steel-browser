import { once } from "node:events";
import puppeteer from "puppeteer-core";
import { expect, it, vi } from "vitest";
import { LaunchShutdownGate } from "./launch-shutdown-gate.js";
it.skipIf(!process.env.BROWSER_EXIT_TEST_EXECUTABLE)(
  "rejects a late real Chromium launch and observes its process exit",
  async () => {
    const gate = new LaunchShutdownGate(vi.fn());
    const launching = puppeteer.launch({
      executablePath: process.env.BROWSER_EXIT_TEST_EXECUTABLE,
      headless: true,
      args: ["--disable-background-networking"],
      timeout: 10000,
    });
    gate.seal();
    const browser = await launching;
    const proc = browser.process()!;
    try {
      const exited = once(proc, "exit", { signal: AbortSignal.timeout(3000) });
      expect(() => gate.accept(browser)).toThrow("Application shutdown prevents browser launch");
      expect(await exited).toEqual([null, "SIGKILL"]);
      expect(proc.signalCode).toBe("SIGKILL");
    } finally {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL");
      await browser.close();
    }
  },
  20000,
);
