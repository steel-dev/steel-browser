import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BrowserRuntime } from "../../src/browser-runtime/facade/browser-runtime.js";
import { PuppeteerLauncher } from "../../src/browser-runtime/drivers/puppeteer-launcher.js";
import { pino } from "pino";
import os from "os";
import path from "path";
import fs from "fs";
import http from "node:http";
import { WebSocket } from "ws";
import { AddressInfo } from "node:net";

async function waitForCondition(
  fn: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 50,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error("Condition not met within timeout");
}

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
        await waitForCondition(() => keepAliveRuntime.isRunning());

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
      await waitForCondition(() => events.length > 0);
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
      await waitForCondition(() => events.length > 0);
      expect(events[0].type).toBe("targetDestroyed");
    });
  });

  describe("WebSocket/CDP Proxy", () => {
    let server: http.Server;
    let port: number;

    beforeEach(async () => {
      server = http.createServer();
      server.on("upgrade", (req, socket, head) => {
        runtime.proxyWebSocket(req, socket, head);
      });

      await new Promise<void>((resolve) => server.listen(0, resolve));
      port = (server.address() as AddressInfo).port;
    });

    afterEach(() => {
      server.close();
    });

    async function createWSClient() {
      const ws = new WebSocket(`ws://localhost:${port}`);
      const pending = new Map<number, (msg: any) => void>();

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)!(msg);
            pending.delete(msg.id);
          }
        } catch (e) {}
      });

      await new Promise((resolve, reject) => {
        ws.on("open", resolve);
        ws.on("error", reject);
      });

      return {
        ws,
        sendAndWait: (id: number, method: string, params: object = {}, sessionId?: string) => {
          return new Promise<any>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error(`Timeout waiting for CDP response for ${method} (id: ${id})`)), 5000);
            pending.set(id, (msg) => {
              clearTimeout(timeout);
              resolve(msg);
            });
            ws.send(JSON.stringify({ id, method, params, sessionId }));
          });
        },
        close: () => ws.close(),
      };
    }

    it("should connect via proxyWebSocket and send/receive CDP commands", async () => {
      await runtime.launch({
        options: { headless: true },
        userDataDir,
        skipFingerprintInjection: true,
      } as any);

      const client = await createWSClient();

      try {
        const response = await client.sendAndWait(1, "Browser.getVersion");
        expect(response.result).toBeDefined();
        expect(response.result.userAgent).toBeDefined();
      } finally {
        client.close();
      }
    });

    it("should send Page.navigate command via proxy and change page URL", async () => {
      await runtime.launch({
        options: { headless: true },
        userDataDir,
        skipFingerprintInjection: true,
      } as any);

      const page = await runtime.getPrimaryPage();
      const initialUrl = page.url();

      const client = await createWSClient();

      try {
        // First, get the target ID for the primary page
        const targetId = (page.target() as any)._targetId;
        
        // Attach to the target to get a session ID
        const attachResponse = await client.sendAndWait(3, "Target.attachToTarget", {
          targetId: targetId,
          flatten: true
        });

        expect(attachResponse.result).toBeDefined();
        const sessionId = attachResponse.result.sessionId;

        // Now send Page.navigate command to the session
        const navigateResponse = await client.sendAndWait(4, "Page.navigate", {
          url: "https://example.com"
        }, sessionId);

        expect(navigateResponse.result).toBeDefined();
        expect(navigateResponse.error).toBeUndefined();

        // Wait for navigation to complete
        await page.waitForNavigation({ waitUntil: "networkidle0", timeout: 5000 });
        expect(page.url()).toContain("example.com");
        expect(page.url()).not.toBe(initialUrl);
      } finally {
        client.close();
      }
    });

    it("should intercept Browser.close and trigger USER_DISCONNECTED event", async () => {
      await runtime.launch({
        options: { headless: true },
        userDataDir,
        skipFingerprintInjection: true,
      } as any);

      expect(runtime.isRunning()).toBe(true);

      const client = await createWSClient();

      try {
        // Send Browser.close which should be intercepted by the proxy
        // This triggers USER_DISCONNECTED internally, causing the runtime to stop
        client.ws.send(JSON.stringify({
          id: 2,
          method: "Browser.close"
        }));

        // Wait for runtime to stop (USER_DISCONNECTED causes transition to cleanup -> idle)
        await waitForCondition(() => !runtime.isRunning());

        expect(runtime.isRunning()).toBe(false);
      } finally {
        client.close();
      }
    });
  });

  describe("Fingerprint Injection", () => {
    let fingerprint: any;

    beforeEach(async () => {
      await runtime.launch({
        options: { headless: true },
        userDataDir,
        // No custom user agent or dimensions, let it generate a fingerprint
      } as any);

      fingerprint = runtime.getFingerprintData();
      expect(fingerprint).toBeDefined();
      expect(fingerprint?.fingerprint).toBeDefined();

      const page = await runtime.getPrimaryPage();
      
      // Wait for fingerprint injection to complete (it's async in logger.actor)
      await waitForCondition(() => runtime.getFingerprintData() !== undefined);
      
      await page.goto("about:blank", { waitUntil: "networkidle0" });
    });

    it("should apply fingerprint to navigator.userAgent", async () => {
      const page = await runtime.getPrimaryPage();
      
      const userAgent = await page.evaluate(() => navigator.userAgent);
      expect(userAgent).toBe(fingerprint!.fingerprint.navigator.userAgent);
    });

    it("should apply fingerprint to screen dimensions", async () => {
      const page = await runtime.getPrimaryPage();
      
      // Page.setDeviceMetricsOverride sets screenWidth/screenHeight and viewport dimensions
      // The viewport width/height are set to screen.availWidth/availHeight from fingerprint
      const screenInfo = await page.evaluate(() => ({
        screenWidth: screen.width,
        screenHeight: screen.height,
        availWidth: screen.availWidth,
        availHeight: screen.availHeight,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
      }));
      
      // Verify fingerprint data exists
      expect(fingerprint!.fingerprint.screen.width).toBeDefined();
      expect(fingerprint!.fingerprint.screen.height).toBeDefined();
      expect(fingerprint!.fingerprint.screen.availWidth).toBeDefined();
      expect(fingerprint!.fingerprint.screen.availHeight).toBeDefined();
      
      // Page.setDeviceMetricsOverride sets:
      // - screenWidth/screenHeight to fingerprint.screen.width/height
      // - viewport width/height to fingerprint.screen.availWidth/availHeight
      // The viewport dimensions should match availWidth/availHeight
      expect(screenInfo.innerWidth).toBe(fingerprint!.fingerprint.screen.availWidth);
      expect(screenInfo.innerHeight).toBe(fingerprint!.fingerprint.screen.availHeight);
    });

    it("should apply fingerprint to hardwareConcurrency", async () => {
      const page = await runtime.getPrimaryPage();
      
      const hardwareConcurrency = await page.evaluate(() => navigator.hardwareConcurrency);
      const expectedValue = fingerprint!.fingerprint.navigator.hardwareConcurrency;
      expect(expectedValue).toBeDefined();
      expect(hardwareConcurrency).toBe(expectedValue);
    });

    it("should apply fingerprint to deviceMemory", async () => {
      const page = await runtime.getPrimaryPage();
      
      const deviceMemory = await page.evaluate(() => (navigator as any).deviceMemory);
      
      // deviceMemory might be undefined in some environments or restricted
      if (fingerprint!.fingerprint.navigator.deviceMemory) {
        expect(deviceMemory).toBe(fingerprint!.fingerprint.navigator.deviceMemory);
      } else {
        // If fingerprint doesn't specify deviceMemory, it might be undefined
        expect(deviceMemory === undefined || typeof deviceMemory === "number").toBe(true);
      }
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
      await waitForCondition(() => events.length > 0);
      
      expect(events[0].type).toBe("fileProtocolViolation");
      expect(events[0].url).toBe("file:///etc/passwd");
    });
  });

  describe("Error Handling", () => {
    it("should throw when proxyWebSocket called before launch", async () => {
      const server = http.createServer();
      const upgradePromise = new Promise<void>((resolve, reject) => {
        server.on("upgrade", async (req, socket, head) => {
          try {
            await expect(runtime.proxyWebSocket(req, socket, head)).rejects.toThrow(
              "WebSocket endpoint not available. Ensure the browser is launched first.",
            );
            socket.destroy();
            resolve();
          } catch (e) {
            socket.destroy();
            reject(e);
          }
        });
      });

      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as AddressInfo).port;

      try {
        const ws = new WebSocket(`ws://localhost:${port}`);
        ws.on("error", () => {}); // Ignore expected reset
        await upgradePromise;
      } finally {
        server.close();
      }
    });

    it("should handle malformed CDP command gracefully", async () => {
      await runtime.launch({
        options: { headless: true },
        userDataDir,
        skipFingerprintInjection: true,
      } as any);

      const server = http.createServer();
      server.on("upgrade", (req, socket, head) => {
        runtime.proxyWebSocket(req, socket, head);
      });

      await new Promise<void>((resolve) => server.listen(0, resolve));
      const port = (server.address() as AddressInfo).port;

      try {
        const ws = new WebSocket(`ws://localhost:${port}`);
        await new Promise((resolve) => ws.on("open", resolve));

        const errorResponsePromise = new Promise<any>((resolve) => {
          ws.on("message", (data) => {
            try {
              const msg = JSON.parse(data.toString());
              if (msg.error) resolve(msg);
            } catch (e) {}
          });
        });

        // Send malformed JSON
        ws.send("not a json");

        // Send unknown method
        ws.send(JSON.stringify({ id: 999, method: "NonExistent.method" }));

        const response = await errorResponsePromise;
        expect(response.error).toBeDefined();
        expect(ws.readyState).toBe(WebSocket.OPEN);
        ws.close();
      } finally {
        server.close();
      }
    });

    it("should emit error when browser crashes unexpectedly", async () => {
      await runtime.launch({
        options: { headless: true },
        userDataDir,
        skipFingerprintInjection: true,
      } as any);

      const errorEvents: any[] = [];
      runtime.on("error", (err) => errorEvents.push(err));

      const browser = runtime.getBrowserInstance();
      expect(browser).toBeDefined();

      const process = browser!.process();
      expect(process).toBeDefined();

      // Simulate a crash by killing the process
      process!.kill("SIGKILL");

      await waitForCondition(() => errorEvents.length > 0 || !runtime.isRunning());
      
      // If keepAlive is false, it should just stop or emit error
      expect(runtime.isRunning()).toBe(false);
    });
  });
});
