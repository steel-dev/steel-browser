import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { PuppeteerLauncher } from "../puppeteer-launcher.js";
import puppeteer from "puppeteer-core";
import os from "os";
import fs from "fs";
import { ResolvedConfig } from "../types.js";

// Mock puppeteer
vi.mock("puppeteer-core", () => ({
  default: {
    launch: vi.fn(),
  },
}));

// Mock browser utils
vi.mock("../utils/browser-utils.js", () => ({
  getChromeExecutablePath: vi.fn().mockReturnValue("/usr/bin/chromium"),
  installMouseHelper: vi.fn(),
}));

// Mock validation
vi.mock("../utils/validation.js", () => ({
  validateTimezone: vi.fn().mockResolvedValue("UTC"),
}));

// Mock extensions
vi.mock("../utils/extensions.js", () => ({
  getExtensionPaths: vi.fn().mockResolvedValue([]),
}));

// Mock tracing
vi.mock("../tracing/index.js", () => ({
  traceOperation: vi.fn((name, mode, fn) =>
    fn({ setAttribute: vi.fn(), recordException: vi.fn() }),
  ),
}));

describe("PuppeteerLauncher", () => {
  let launcher: PuppeteerLauncher;
  let mockBrowser: any;
  let mockPage: any;
  let mockProcess: any;

  beforeEach(() => {
    mockProcess = {
      kill: vi.fn(),
      pid: 12345,
    };

    mockPage = {
      url: vi.fn().mockReturnValue("about:blank"),
      close: vi.fn().mockResolvedValue(undefined),
      setRequestInterception: vi.fn().mockResolvedValue(undefined),
      evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: vi.fn(),
      createCDPSession: vi.fn().mockResolvedValue({
        send: vi.fn().mockResolvedValue(undefined),
        detach: vi.fn().mockResolvedValue(undefined),
      }),
    };

    mockBrowser = {
      pages: vi.fn().mockResolvedValue([mockPage]),
      close: vi.fn().mockResolvedValue(undefined),
      process: vi.fn().mockReturnValue(mockProcess),
      wsEndpoint: vi.fn().mockReturnValue("ws://localhost:9222"),
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
      emit: vi.fn(),
      isConnected: vi.fn().mockReturnValue(true),
    };

    (puppeteer.launch as any).mockResolvedValue(mockBrowser);

    launcher = new PuppeteerLauncher();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("File Protocol Detection", () => {
    const defaultConfig: ResolvedConfig = {
      sessionId: "test-session",
      port: 3000,
      host: "localhost",
      headless: true,
      userDataDir: "/tmp/user-data",
      timezone: "UTC",
      fingerprint: null,
      sessionContext: null,
    };

    it("should set up request interception on primary page", async () => {
      await launcher.launch(defaultConfig, null);
      expect(mockPage.setRequestInterception).toHaveBeenCalledWith(true);
      expect(mockPage.on).toHaveBeenCalledWith("request", expect.any(Function));
    });

    it("should block file:// protocol requests", async () => {
      await launcher.launch(defaultConfig, null);

      const requestHandler = mockPage.on.mock.calls.find(
        (call: any[]) => call[0] === "request",
      )?.[1];

      const mockRequest = {
        url: vi.fn().mockReturnValue("file:///etc/passwd"),
        abort: vi.fn().mockResolvedValue(undefined),
        continue: vi.fn().mockResolvedValue(undefined),
      };

      await requestHandler(mockRequest);

      expect(mockRequest.abort).toHaveBeenCalledWith("accessdenied");
      expect(mockRequest.continue).not.toHaveBeenCalled();
      expect(mockBrowser.emit).toHaveBeenCalledWith("fileProtocolViolation", {
        url: "file:///etc/passwd",
      });
    });

    it("should allow non-file:// protocol requests", async () => {
      await launcher.launch(defaultConfig, null);

      const requestHandler = mockPage.on.mock.calls.find(
        (call: any[]) => call[0] === "request",
      )?.[1];

      const mockRequest = {
        url: vi.fn().mockReturnValue("https://example.com"),
        abort: vi.fn().mockResolvedValue(undefined),
        continue: vi.fn().mockResolvedValue(undefined),
      };

      await requestHandler(mockRequest);

      expect(mockRequest.continue).toHaveBeenCalled();
      expect(mockRequest.abort).not.toHaveBeenCalled();
    });

    it("should block file:// protocol responses", async () => {
      await launcher.launch(defaultConfig, null);

      const responseHandler = mockPage.on.mock.calls.find(
        (call: any[]) => call[0] === "response",
      )?.[1];

      // If responseHandler is not found, this test will fail, which is expected
      // because PuppeteerLauncher currently doesn't implement response blocking
      expect(responseHandler).toBeDefined();

      const mockResponse = {
        url: vi.fn().mockReturnValue("file:///etc/passwd"),
      };

      await responseHandler(mockResponse);

      expect(mockBrowser.emit).toHaveBeenCalledWith("fileProtocolViolation", {
        url: "file:///etc/passwd",
      });
    });

    it("should set up detection for new pages", async () => {
      await launcher.launch(defaultConfig, null);

      const targetCreatedHandler = mockBrowser.on.mock.calls.find(
        (call: any[]) => call[0] === "targetcreated",
      )?.[1];

      expect(targetCreatedHandler).toBeDefined();

      const newMockPage = {
        setRequestInterception: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
      };

      const mockTarget = {
        type: vi.fn().mockReturnValue("page"),
        page: vi.fn().mockResolvedValue(newMockPage),
      };

      await targetCreatedHandler(mockTarget);

      expect(newMockPage.setRequestInterception).toHaveBeenCalledWith(true);
      expect(newMockPage.on).toHaveBeenCalledWith("request", expect.any(Function));
    });
  });

  describe("launch", () => {
    const defaultConfig: ResolvedConfig = {
      sessionId: "test-session",
      port: 3000,
      host: "localhost",
      headless: true,
      userDataDir: "/tmp/user-data",
      timezone: "UTC",
      fingerprint: null,
      sessionContext: null,
    };

    it("should launch with correct options", async () => {
      await launcher.launch(defaultConfig, null);

      expect(puppeteer.launch).toHaveBeenCalledWith(
        expect.objectContaining({
          headless: true,
          userDataDir: "/tmp/user-data",
        }),
      );
    });

    it("should include dimensions in args", async () => {
      await launcher.launch(
        {
          ...defaultConfig,
          dimensions: { width: 1280, height: 720 },
        },
        null,
      );

      const args = (puppeteer.launch as any).mock.calls[0][0].args;
      expect(args).toContain("--window-size=1280,720");
    });

    it("should include userAgent in args", async () => {
      await launcher.launch(
        {
          ...defaultConfig,
          userAgent: "CustomAgent",
        },
        null,
      );

      const args = (puppeteer.launch as any).mock.calls[0][0].args;
      expect(args).toContain("--user-agent=CustomAgent");
    });

    it("should include proxy in args", async () => {
      await launcher.launch(defaultConfig, { url: "http://proxy:8080", close: vi.fn() });

      const args = (puppeteer.launch as any).mock.calls[0][0].args;
      expect(args).toContain("--proxy-server=http://proxy:8080");
    });

    it("should add headless specific args", async () => {
      await launcher.launch({ ...defaultConfig, headless: true }, null);

      const args = (puppeteer.launch as any).mock.calls[0][0].args;
      expect(args).toContain("--headless=new");
      expect(args).toContain("--disable-blink-features=AutomationControlled");
    });

    it("should add headful specific args", async () => {
      await launcher.launch({ ...defaultConfig, headless: false }, null);

      const args = (puppeteer.launch as any).mock.calls[0][0].args;
      expect(args).not.toContain("--headless=new");
      expect(args).toContain("--ozone-platform=x11");
    });

    it("should deduplicate and filter chrome args", async () => {
      await launcher.launch(
        {
          ...defaultConfig,
          chromeArgs: ["--custom-arg", "--custom-arg"],
          filterChromeArgs: ["--disable-gpu"],
        },
        null,
      );

      const args = (puppeteer.launch as any).mock.calls[0][0].args;
      const customArgCount = args.filter((a: string) => a === "--custom-arg").length;
      expect(customArgCount).toBe(1);
      expect(args).not.toContain("--disable-gpu");
    });

    it("should handle launch failure and cleanup", async () => {
      (puppeteer.launch as any).mockRejectedValueOnce(new Error("Launch failed"));

      await expect(launcher.launch(defaultConfig, null)).rejects.toThrow("Launch failed");
    });

    it("should cleanup if post-launch setup fails", async () => {
      mockBrowser.pages.mockRejectedValueOnce(new Error("Setup failed"));

      await expect(launcher.launch(defaultConfig, null)).rejects.toThrow("Setup failed");
      expect(mockBrowser.close).toHaveBeenCalled();
    });
  });

  describe("Browser Lifecycle", () => {
    const mockBrowserRef = (id: string) => ({
      id,
      instance: mockBrowser,
      primaryPage: mockPage,
      pid: 12345,
      wsEndpoint: "ws://localhost:9222",
      launchedAt: Date.now(),
    });

    it("should close browser", async () => {
      const ref = mockBrowserRef("test");
      await launcher.close(ref);
      expect(mockBrowser.close).toHaveBeenCalled();
    });

    it("should force close browser and kill process", async () => {
      const ref = mockBrowserRef("test");
      await launcher.forceClose(ref);
      expect(mockBrowser.close).toHaveBeenCalled();
      expect(mockProcess.kill).toHaveBeenCalledWith("SIGKILL");
    });

    it("should get process info", () => {
      const ref = mockBrowserRef("test");
      const proc = launcher.getProcess(ref);
      expect(proc?.pid).toBe(12345);

      proc?.kill("SIGTERM");
      expect(mockProcess.kill).toHaveBeenCalledWith("SIGTERM");
    });
  });

  describe("Events", () => {
    const mockBrowserRef = (id: string) => ({
      id,
      instance: mockBrowser,
      primaryPage: mockPage,
      pid: 12345,
      wsEndpoint: "ws://localhost:9222",
      launchedAt: Date.now(),
    });

    it("should register disconnected listener", () => {
      const ref = mockBrowserRef("test");
      const callback = vi.fn();
      const unregister = launcher.onDisconnected(ref, callback);

      expect(mockBrowser.on).toHaveBeenCalledWith("disconnected", callback);

      unregister();
      expect(mockBrowser.off).toHaveBeenCalledWith("disconnected", callback);
    });

    it("should register targetCreated listener", () => {
      const ref = mockBrowserRef("test");
      const callback = vi.fn();
      const unregister = launcher.onTargetCreated(ref, callback);

      expect(mockBrowser.on).toHaveBeenCalledWith("targetcreated", callback);

      unregister();
      expect(mockBrowser.off).toHaveBeenCalledWith("targetcreated", callback);
    });

    it("should register targetDestroyed listener and extract targetId", () => {
      const ref = mockBrowserRef("test");
      const callback = vi.fn();
      const unregister = launcher.onTargetDestroyed(ref, callback);

      const handler = mockBrowser.on.mock.calls.find(
        (call: any[]) => call[0] === "targetdestroyed",
      )?.[1];

      expect(handler).toBeDefined();

      handler({ _targetId: "target-123" });
      expect(callback).toHaveBeenCalledWith("target-123");

      unregister();
      expect(mockBrowser.off).toHaveBeenCalledWith("targetdestroyed", handler);
    });

    it("should support multiple listeners", () => {
      const ref = mockBrowserRef("test");
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      launcher.onDisconnected(ref, cb1);
      launcher.onDisconnected(ref, cb2);

      expect(mockBrowser.on).toHaveBeenCalledWith("disconnected", cb1);
      expect(mockBrowser.on).toHaveBeenCalledWith("disconnected", cb2);
    });

    it("should support once listeners", () => {
      const ref = mockBrowserRef("test");
      const callback = vi.fn();
      launcher.onDisconnected(ref, callback);

      const handler = mockBrowser.on.mock.calls.find((c) => c[0] === "disconnected")[1];
      handler();
      handler();

      // Currently the launcher just forwards to .on, so it depends on puppeteer
      // But we can verify our wrapper behavior
    });
  });

  describe("Edge Cases", () => {
    it("should handle launch with extensions", async () => {
      const config = {
        sessionId: "test",
        port: 3000,
        host: "localhost",
        headless: true,
        userDataDir: "/tmp",
        timezone: "UTC",
        fingerprint: null,
        sessionContext: null,
        extensions: ["/path/to/ext"],
      };
      await launcher.launch(config, null);
      const args = (puppeteer.launch as any).mock.calls[0][0].args;
      expect(args.some((a: string) => a.includes("--load-extension"))).toBe(true);
    });

    it("should handle launch with userPreferences", async () => {
      const config = {
        sessionId: "test",
        port: 3000,
        host: "localhost",
        headless: true,
        userDataDir: "/tmp",
        timezone: "UTC",
        fingerprint: null,
        sessionContext: null,
        userPreferences: { foo: "bar" },
      };
      await launcher.launch(config, null);
      // Verify preferences are handled - this usually involves write to file which we can mock
    });

    it("should return null for process if not available", () => {
      const ref = { instance: { process: () => null } } as any;
      expect(launcher.getProcess(ref)).toBeNull();
    });

    it("should handle targetCreated for non-page targets", async () => {
      const config = {
        sessionId: "t",
        port: 3000,
        host: "l",
        headless: true,
        userDataDir: "/tmp",
        timezone: "UTC",
        fingerprint: null,
        sessionContext: null,
      };
      await launcher.launch(config, null);

      const handler = mockBrowser.on.mock.calls.find((c) => c[0] === "targetcreated")[1];
      const mockTarget = { type: () => "background_page" };
      await expect(handler(mockTarget)).resolves.not.toThrow();
    });

    it("should handle target with null page", async () => {
      const config = {
        sessionId: "t",
        port: 3000,
        host: "l",
        headless: true,
        userDataDir: "/tmp",
        timezone: "UTC",
        fingerprint: null,
        sessionContext: null,
      };
      await launcher.launch(config, null);

      const handler = mockBrowser.on.mock.calls.find((c) => c[0] === "targetcreated")[1];
      const mockTarget = { type: () => "page", page: vi.fn().mockResolvedValue(null) };
      await expect(handler(mockTarget)).resolves.not.toThrow();
    });

    it("should handle browser close failure", async () => {
      mockBrowser.close.mockRejectedValueOnce(new Error("Close fail"));
      const ref = { id: "t", instance: mockBrowser, pid: 1 } as any;
      await expect(launcher.close(ref)).resolves.not.toThrow();
    });

    it("should handle process kill failure", async () => {
      mockProcess.kill.mockImplementationOnce(() => {
        throw new Error("Kill fail");
      });
      const ref = { id: "t", instance: mockBrowser, pid: 1 } as any;
      await expect(launcher.forceClose(ref)).resolves.not.toThrow();
    });

    it("should handle mobile device config", async () => {
      const config = {
        sessionId: "t",
        port: 3000,
        host: "l",
        headless: true,
        userDataDir: "/tmp",
        timezone: "UTC",
        fingerprint: null,
        sessionContext: null,
        deviceConfig: { device: "mobile" },
      } as any;
      await launcher.launch(config, null);
      // Verify mobile args or UA
    });

    it("should handle fingerprint injection skip", async () => {
      const config = {
        sessionId: "t",
        port: 3000,
        host: "l",
        headless: true,
        userDataDir: "/tmp",
        timezone: "UTC",
        fingerprint: null,
        sessionContext: null,
        skipFingerprintInjection: true,
      } as any;
      await launcher.launch(config, null);
      // Verify no injection args
    });
  });
});
