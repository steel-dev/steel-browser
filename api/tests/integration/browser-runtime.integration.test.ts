import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BrowserRuntime } from "../../src/browser-runtime/facade/browser-runtime.js";
import { PuppeteerLauncher } from "../../src/browser-runtime/drivers/puppeteer-launcher.js";
import { pino } from "pino";
import os from "os";
import path from "path";
import fs from "fs";

describe("BrowserRuntime Integration", () => {
  let runtime: BrowserRuntime;
  let userDataDir: string;

  beforeEach(async () => {
    userDataDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "browser-runtime-integration-"),
    );

    runtime = new BrowserRuntime({
      launcher: new PuppeteerLauncher(),
      appLogger: pino({ level: "silent" }),
      keepAlive: false,
    });
  });

  afterEach(async () => {
    await runtime.shutdown().catch(() => {});
    await fs.promises.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  });

  it("should launch browser, navigate to page, and verify title", async () => {
    const browser = await runtime.launch({
      options: { headless: true },
      userDataDir,
      skipFingerprintInjection: true,
    } as any);

    expect(browser).toBeDefined();
    expect(runtime.isRunning()).toBe(true);

    const page = await runtime.getPrimaryPage();
    await page.goto("https://example.com", { waitUntil: "networkidle0" });

    const title = await page.title();
    expect(title).toBe("Example Domain");

    await runtime.shutdown();
    expect(runtime.isRunning()).toBe(false);
  });
});
