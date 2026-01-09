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

  describe("Session State Extraction", () => {
    it("should extract cookies and localStorage after visiting a site", async () => {
      await runtime.launch({
        options: { headless: true },
        userDataDir,
        skipFingerprintInjection: true,
      } as any);

      const page = await runtime.getPrimaryPage();
      await page.goto("https://example.com", { waitUntil: "networkidle0" });

      // Set a cookie
      await page.evaluate(() => {
        document.cookie = "test-cookie=test-value; path=/";
        localStorage.setItem("test-local", "test-local-value");
        sessionStorage.setItem("test-session", "test-session-value");
      });

      const state = await runtime.getBrowserState();

      expect(state.cookies).toBeDefined();
      expect(state.cookies?.some((c) => c.name === "test-cookie")).toBe(true);
      
      const domain = "example.com";
      expect(state.localStorage?.[domain]).toBeDefined();
      expect(state.localStorage?.[domain]?.["test-local"]).toBe("test-local-value");
      
      expect(state.sessionStorage?.[domain]).toBeDefined();
      expect(state.sessionStorage?.[domain]?.["test-session"]).toBe("test-session-value");
    });

    it("should merge storage data from multiple pages", async () => {
      await runtime.launch({
        options: { headless: true },
        userDataDir,
        skipFingerprintInjection: true,
      } as any);

      const page1 = await runtime.getPrimaryPage();
      await page1.goto("https://example.com", { waitUntil: "networkidle0" });
      const domain1 = new URL(page1.url()).hostname;
      await page1.evaluate(() => localStorage.setItem("p1", "v1"));

      const page2 = await runtime.createPage();
      // Use another domain that is unlikely to redirect to the first one
      await page2.goto("https://example.org", { waitUntil: "networkidle0" });
      const domain2 = new URL(page2.url()).hostname;
      await page2.evaluate(() => localStorage.setItem("p2", "v2"));

      const state = await runtime.getBrowserState();

      expect(state.localStorage?.[domain1]?.["p1"]).toBe("v1");
      expect(state.localStorage?.[domain2]?.["p2"]).toBe("v2");
    });
  });

  describe("Session Context Restoration", () => {
    it("should restore cookies from sessionContext on launch", async () => {
      const initialCookies = [
        {
          name: "restored-cookie",
          value: "restored-value",
          domain: "example.com",
          path: "/",
          expires: Date.now() / 1000 + 3600,
        },
      ];

      await runtime.launch({
        options: { headless: true },
        userDataDir,
        skipFingerprintInjection: true,
        sessionContext: {
          cookies: initialCookies as any,
        },
      } as any);

      const page = await runtime.getPrimaryPage();
      await page.goto("https://example.com", { waitUntil: "networkidle0" });

      const cookies = await (await page.target().createCDPSession()).send("Network.getAllCookies");
      expect(cookies.cookies.some((c: any) => c.name === "restored-cookie")).toBe(true);
    });
  });

  describe("Config Reuse", () => {
    it("should reuse browser when launching with identical config", async () => {
      const config = {
        options: { headless: true },
        userDataDir,
        skipFingerprintInjection: true,
      };

      const b1 = await runtime.launch(config as any);
      const b2 = await runtime.launch(config as any);

      expect(b1).toBe(b2);
    });

    it("should restart browser when userDataDir changes", async () => {
      const b1 = await runtime.launch({
        options: { headless: true },
        userDataDir,
        skipFingerprintInjection: true,
      } as any);

      const otherDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "other-dir-"));
      try {
        const b2 = await runtime.launch({
          options: { headless: true },
          userDataDir: otherDir,
          skipFingerprintInjection: true,
        } as any);

        expect(b1).not.toBe(b2);
      } finally {
        await fs.promises.rm(otherDir, { recursive: true, force: true }).catch(() => {});
      }
    });
  });

  describe("keepAlive Behavior", () => {
    it("should restart browser with default config after endSession when keepAlive=true", async () => {
      const keepAliveRuntime = new BrowserRuntime({
        launcher: new PuppeteerLauncher(),
        appLogger: pino({ level: "silent" }),
        keepAlive: true,
        defaultLaunchConfig: {
          options: { headless: true },
          userDataDir,
          skipFingerprintInjection: true,
        } as any,
      });

      try {
        await keepAliveRuntime.launch();
        const b1 = keepAliveRuntime.getBrowserInstance();
        expect(b1).toBeDefined();

        await keepAliveRuntime.endSession();
        // Wait for restart
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const b2 = keepAliveRuntime.getBrowserInstance();
        expect(b2).toBeDefined();
        expect(b1).not.toBe(b2);
        expect(keepAliveRuntime.isRunning()).toBe(true);
      } finally {
        await keepAliveRuntime.shutdown().catch(() => {});
      }
    });
  });

  describe("Page Management", () => {
    beforeEach(async () => {
      await runtime.launch({
        options: { headless: true },
        userDataDir,
        skipFingerprintInjection: true,
      } as any);
    });

    it("should create additional pages via createPage", async () => {
      const page = await runtime.createPage();
      expect(page).toBeDefined();
      const pages = await runtime.getAllPages();
      expect(pages.length).toBeGreaterThan(1);
    });

    it("should return all open pages via getAllPages", async () => {
      const initialPages = await runtime.getAllPages();
      await runtime.createPage();
      const finalPages = await runtime.getAllPages();
      expect(finalPages.length).toBe(initialPages.length + 1);
    });

    it("should close old page and create new one via refreshPrimaryPage", async () => {
      const oldPage = await runtime.getPrimaryPage();
      const oldTargetId = (oldPage.target() as any)._targetId;

      await runtime.refreshPrimaryPage();

      const newPage = await runtime.getPrimaryPage();
      const newTargetId = (newPage.target() as any)._targetId;

      expect(newTargetId).not.toBe(oldTargetId);
      
      const allPages = await runtime.getAllPages();
      expect(allPages.some(p => (p.target() as any)._targetId === oldTargetId)).toBe(false);
    });
  });

  describe("Browser Events", () => {
    it("should emit targetCreated when opening a new tab", async () => {
      await runtime.launch({
        options: { headless: true },
        userDataDir,
        skipFingerprintInjection: true,
      } as any);

      const events: any[] = [];
      runtime.on("targetCreated", (event) => events.push(event));

      await runtime.createPage();

      // Wait for event propagation
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe("targetCreated");
    });

    it("should emit targetDestroyed when closing a tab", async () => {
      await runtime.launch({
        options: { headless: true },
        userDataDir,
        skipFingerprintInjection: true,
      } as any);

      const page = await runtime.createPage();
      const events: any[] = [];
      runtime.on("targetDestroyed", (event) => events.push(event));

      await page.close();

      // Wait for event propagation
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe("targetDestroyed");
    });
  });

  describe("Security", () => {
    it("should block file:// protocol navigation and emit violation event", async () => {
      await runtime.launch({
        options: { headless: true },
        userDataDir,
        skipFingerprintInjection: true,
      } as any);

      const events: any[] = [];
      runtime.on("fileProtocolViolation", (event) => events.push(event));

      const page = await runtime.getPrimaryPage();
      
      // Attempt to navigate to a file URL. This should be blocked.
      // We catch the error because puppeteer might throw when navigation is aborted
      await page.goto("file:///etc/passwd").catch(() => {});

      // Wait for event propagation
      await new Promise((resolve) => setTimeout(resolve, 500));
      
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe("fileProtocolViolation");
      expect(events[0].url).toBe("file:///etc/passwd");
    });
  });
});
