import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { BrowserDriver } from "../browser-driver.js";
import { FastifyBaseLogger } from "fastify";
import puppeteer from "puppeteer-core";

// Mock puppeteer
vi.mock("puppeteer-core", () => ({
  default: {
    launch: vi.fn(),
  },
}));

// Mock browser utils
vi.mock("../../utils/browser.js", () => ({
  getChromeExecutablePath: vi.fn().mockReturnValue("/usr/bin/chromium"),
}));

// Mock env
vi.mock("../../env.js", () => ({
  env: {
    HOST: "0.0.0.0",
    PORT: 3000,
    DEFAULT_TIMEZONE: "UTC",
    DISPLAY: ":99",
    DEBUG_CHROME_PROCESS: false,
    CHROME_ARGS: [],
    FILTER_CHROME_ARGS: [],
  },
}));

describe("BrowserDriver", () => {
  let driver: BrowserDriver;
  let mockLogger: FastifyBaseLogger;
  let mockBrowser: any;
  let mockPage: any;
  let mockProcess: any;

  beforeEach(() => {
    mockLogger = {
      child: vi.fn().mockReturnThis(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as any;

    mockProcess = {
      kill: vi.fn(),
      setMaxListeners: vi.fn(),
    };

    mockPage = {
      url: vi.fn().mockReturnValue("about:blank"),
      close: vi.fn().mockResolvedValue(undefined),
      setRequestInterception: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: vi.fn(),
    };

    mockBrowser = {
      pages: vi.fn().mockResolvedValue([mockPage]),
      close: vi.fn().mockResolvedValue(undefined),
      process: vi.fn().mockReturnValue(mockProcess),
      wsEndpoint: vi.fn().mockReturnValue("ws://localhost:9222"),
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
    };

    (puppeteer.launch as any).mockResolvedValue(mockBrowser);

    driver = new BrowserDriver({ logger: mockLogger });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("emitFileProtocolViolation", () => {
    it("should emit fileProtocolViolation event", () => {
      const listener = vi.fn();
      driver.on("event", listener);

      driver.emitFileProtocolViolation("file:///etc/passwd");

      expect(listener).toHaveBeenCalledWith({
        type: "fileProtocolViolation",
        data: { url: "file:///etc/passwd" },
        timestamp: expect.any(Number),
      });
    });

    it("should include timestamp in event", () => {
      const listener = vi.fn();
      driver.on("event", listener);

      const before = Date.now();
      driver.emitFileProtocolViolation("file:///test");
      const after = Date.now();

      const event = listener.mock.calls[0][0];
      expect(event.timestamp).toBeGreaterThanOrEqual(before);
      expect(event.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe("getBrowser", () => {
    it("should return null initially", () => {
      expect(driver.getBrowser()).toBeNull();
    });

    it("should return browser after launch", async () => {
      await driver.launch({ options: {} });
      expect(driver.getBrowser()).toBe(mockBrowser);
    });
  });

  describe("getPrimaryPage", () => {
    it("should return null initially", () => {
      expect(driver.getPrimaryPage()).toBeNull();
    });

    it("should return primary page after launch", async () => {
      await driver.launch({ options: {} });
      expect(driver.getPrimaryPage()).toBe(mockPage);
    });
  });

  describe("launch", () => {
    it("should launch browser with puppeteer", async () => {
      const result = await driver.launch({ options: {} });

      expect(puppeteer.launch).toHaveBeenCalled();
      expect(result.browser).toBe(mockBrowser);
      expect(result.primaryPage).toBe(mockPage);
    });

    it("should attach browser event listeners", async () => {
      await driver.launch({ options: {} });

      expect(mockBrowser.on).toHaveBeenCalledWith("disconnected", expect.any(Function));
      expect(mockBrowser.on).toHaveBeenCalledWith("targetcreated", expect.any(Function));
      expect(mockBrowser.on).toHaveBeenCalledWith("targetchanged", expect.any(Function));
      expect(mockBrowser.on).toHaveBeenCalledWith("targetdestroyed", expect.any(Function));
    });

    it("should use provided dimensions", async () => {
      await driver.launch({
        options: {},
        dimensions: { width: 1280, height: 720 },
      });

      const launchCall = (puppeteer.launch as any).mock.calls[0][0];
      expect(launchCall.args).toContain("--window-size=1280,720");
    });

    it("should use provided userAgent", async () => {
      await driver.launch({
        options: {},
        userAgent: "Custom User Agent",
      });

      const launchCall = (puppeteer.launch as any).mock.calls[0][0];
      expect(launchCall.args).toContain("--user-agent=Custom User Agent");
    });

    it("should use provided proxy URL", async () => {
      await driver.launch({
        options: { proxyUrl: "http://proxy:8080" },
      });

      const launchCall = (puppeteer.launch as any).mock.calls[0][0];
      expect(launchCall.args).toContain("--proxy-server=http://proxy:8080");
    });

    it("should add headless args when headless is true", async () => {
      await driver.launch({
        options: { headless: true },
      });

      const launchCall = (puppeteer.launch as any).mock.calls[0][0];
      expect(launchCall.args).toContain("--headless=new");
    });

    it("should add headful args when headless is false", async () => {
      await driver.launch({
        options: { headless: false },
      });

      const launchCall = (puppeteer.launch as any).mock.calls[0][0];
      expect(launchCall.args).toContain("--ozone-platform=x11");
      expect(launchCall.args).not.toContain("--headless=new");
    });

    it("should use provided userDataDir", async () => {
      await driver.launch({
        options: {},
        userDataDir: "/custom/data/dir",
      });

      const launchCall = (puppeteer.launch as any).mock.calls[0][0];
      expect(launchCall.userDataDir).toBe("/custom/data/dir");
    });

    it("should deduplicate launch args", async () => {
      await driver.launch({
        options: {
          args: ["--no-sandbox", "--no-sandbox"],
        },
      });

      const launchCall = (puppeteer.launch as any).mock.calls[0][0];
      const noSandboxCount = launchCall.args.filter((arg: string) => arg === "--no-sandbox").length;
      expect(noSandboxCount).toBe(1);
    });

    it("should filter out empty args", async () => {
      await driver.launch({
        options: {
          args: ["", "--custom-arg", ""],
        },
      });

      const launchCall = (puppeteer.launch as any).mock.calls[0][0];
      expect(launchCall.args).not.toContain("");
    });

    it("should throw on puppeteer launch failure", async () => {
      const error = new Error("Chrome not found");
      (puppeteer.launch as any).mockRejectedValueOnce(error);

      await expect(driver.launch({ options: {} })).rejects.toThrow("Chrome not found");
    });

    it("should clean up on post-launch setup failure", async () => {
      mockBrowser.pages.mockRejectedValueOnce(new Error("Pages failed"));

      await expect(driver.launch({ options: {} })).rejects.toThrow("Pages failed");

      // Browser should have been cleaned up
      expect(driver.getBrowser()).toBeNull();
    });

    it("should log launch info", async () => {
      await driver.launch({ options: {} });

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining("Launching browser"));
    });
  });

  describe("Browser Events", () => {
    it("should emit disconnected event when browser disconnects", async () => {
      await driver.launch({ options: {} });

      const listener = vi.fn();
      driver.on("event", listener);

      // Get the disconnected handler and call it
      const disconnectedHandler = mockBrowser.on.mock.calls.find(
        (call: any[]) => call[0] === "disconnected",
      )[1];
      disconnectedHandler();

      expect(listener).toHaveBeenCalledWith({
        type: "disconnected",
        timestamp: expect.any(Number),
      });
    });

    it("should emit targetCreated event", async () => {
      await driver.launch({ options: {} });

      const listener = vi.fn();
      driver.on("event", listener);

      const mockTarget = {
        type: vi.fn().mockReturnValue("page"),
        url: vi.fn().mockReturnValue("https://example.com"),
        page: vi.fn().mockResolvedValue(mockPage),
      };

      // Get the targetcreated handler and call it
      const targetCreatedHandler = mockBrowser.on.mock.calls.find(
        (call: any[]) => call[0] === "targetcreated",
      )[1];
      await targetCreatedHandler(mockTarget);

      expect(listener).toHaveBeenCalledWith({
        type: "targetCreated",
        data: { target: mockTarget },
        timestamp: expect.any(Number),
      });
    });

    it("should emit targetChanged event", async () => {
      await driver.launch({ options: {} });

      const listener = vi.fn();
      driver.on("event", listener);

      const mockTarget = {
        type: vi.fn().mockReturnValue("page"),
        url: vi.fn().mockReturnValue("https://example.com/new"),
      };

      // Get the targetchanged handler and call it
      const targetChangedHandler = mockBrowser.on.mock.calls.find(
        (call: any[]) => call[0] === "targetchanged",
      )[1];
      targetChangedHandler(mockTarget);

      expect(listener).toHaveBeenCalledWith({
        type: "targetChanged",
        data: { target: mockTarget },
        timestamp: expect.any(Number),
      });
    });

    it("should emit targetDestroyed event with targetId", async () => {
      await driver.launch({ options: {} });

      const listener = vi.fn();
      driver.on("event", listener);

      const mockTarget = {
        _targetId: "target-123",
      };

      // Get the targetdestroyed handler and call it
      const targetDestroyedHandler = mockBrowser.on.mock.calls.find(
        (call: any[]) => call[0] === "targetdestroyed",
      )[1];
      targetDestroyedHandler(mockTarget);

      expect(listener).toHaveBeenCalledWith({
        type: "targetDestroyed",
        data: { targetId: "target-123" },
        timestamp: expect.any(Number),
      });
    });
  });

  describe("File Protocol Detection", () => {
    it("should set up request interception on new pages", async () => {
      await driver.launch({ options: {} });

      const mockTarget = {
        type: vi.fn().mockReturnValue("page"),
        url: vi.fn().mockReturnValue("about:blank"),
        page: vi.fn().mockResolvedValue(mockPage),
      };

      const targetCreatedHandler = mockBrowser.on.mock.calls.find(
        (call: any[]) => call[0] === "targetcreated",
      )[1];
      await targetCreatedHandler(mockTarget);

      expect(mockPage.setRequestInterception).toHaveBeenCalledWith(true);
    });

    it("should set up request and response handlers", async () => {
      await driver.launch({ options: {} });

      const mockTarget = {
        type: vi.fn().mockReturnValue("page"),
        url: vi.fn().mockReturnValue("about:blank"),
        page: vi.fn().mockResolvedValue(mockPage),
      };

      const targetCreatedHandler = mockBrowser.on.mock.calls.find(
        (call: any[]) => call[0] === "targetcreated",
      )[1];
      await targetCreatedHandler(mockTarget);

      expect(mockPage.on).toHaveBeenCalledWith("request", expect.any(Function));
      expect(mockPage.on).toHaveBeenCalledWith("response", expect.any(Function));
    });

    it("should handle error when setting up file protocol detection", async () => {
      mockPage.setRequestInterception.mockRejectedValueOnce(new Error("Setup failed"));

      await driver.launch({ options: {} });

      const mockTarget = {
        type: vi.fn().mockReturnValue("page"),
        url: vi.fn().mockReturnValue("about:blank"),
        page: vi.fn().mockResolvedValue(mockPage),
      };

      const targetCreatedHandler = mockBrowser.on.mock.calls.find(
        (call: any[]) => call[0] === "targetcreated",
      )[1];
      await targetCreatedHandler(mockTarget);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining("file protocol detection"),
      );
    });

    it("should not set up detection for non-page targets", async () => {
      await driver.launch({ options: {} });

      // Clear the call count after initial launch
      mockPage.setRequestInterception.mockClear();
      mockPage.on.mockClear();

      const mockTarget = {
        type: vi.fn().mockReturnValue("service_worker"),
        url: vi.fn().mockReturnValue("chrome-extension://abc"),
        page: vi.fn().mockResolvedValue(null), // Non-page targets return null
      };

      const targetCreatedHandler = mockBrowser.on.mock.calls.find(
        (call: any[]) => call[0] === "targetcreated",
      )[1];
      await targetCreatedHandler(mockTarget);

      // For non-page targets, setRequestInterception should NOT be called
      expect(mockPage.setRequestInterception).not.toHaveBeenCalled();
      // Request/response handlers should NOT be attached
      expect(mockPage.on).not.toHaveBeenCalledWith("request", expect.any(Function));
      expect(mockPage.on).not.toHaveBeenCalledWith("response", expect.any(Function));
    });

    it("should block file:// protocol requests and emit violation", async () => {
      await driver.launch({ options: {} });

      const violationListener = vi.fn();
      driver.on("event", violationListener);

      // Get a page target and trigger the request handler setup
      const newMockPage = {
        url: vi.fn().mockReturnValue("about:blank"),
        close: vi.fn().mockResolvedValue(undefined),
        setRequestInterception: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        off: vi.fn(),
      };

      const mockTarget = {
        type: vi.fn().mockReturnValue("page"),
        url: vi.fn().mockReturnValue("about:blank"),
        page: vi.fn().mockResolvedValue(newMockPage),
      };

      const targetCreatedHandler = mockBrowser.on.mock.calls.find(
        (call: any[]) => call[0] === "targetcreated",
      )[1];
      await targetCreatedHandler(mockTarget);

      // Find the request handler that was attached
      const requestHandlerCall = newMockPage.on.mock.calls.find(
        (call: any[]) => call[0] === "request",
      );
      expect(requestHandlerCall).toBeDefined();
      const requestHandler = requestHandlerCall?.[1];

      // Create a mock file:// request
      const mockFileRequest = {
        url: vi.fn().mockReturnValue("file:///etc/passwd"),
        abort: vi.fn().mockResolvedValue(undefined),
        continue: vi.fn().mockResolvedValue(undefined),
      };

      // Trigger the request handler with file:// URL
      requestHandler?.(mockFileRequest);

      // Verify the request was aborted, not continued
      expect(mockFileRequest.abort).toHaveBeenCalled();
      expect(mockFileRequest.continue).not.toHaveBeenCalled();
      // Verify the page was closed
      expect(newMockPage.close).toHaveBeenCalled();
      // Verify the violation event was emitted
      expect(violationListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "fileProtocolViolation",
          data: { url: "file:///etc/passwd" },
        }),
      );
    });

    it("should allow non-file:// protocol requests to continue", async () => {
      await driver.launch({ options: {} });

      const newMockPage = {
        url: vi.fn().mockReturnValue("about:blank"),
        close: vi.fn().mockResolvedValue(undefined),
        setRequestInterception: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        off: vi.fn(),
      };

      const mockTarget = {
        type: vi.fn().mockReturnValue("page"),
        url: vi.fn().mockReturnValue("about:blank"),
        page: vi.fn().mockResolvedValue(newMockPage),
      };

      const targetCreatedHandler = mockBrowser.on.mock.calls.find(
        (call: any[]) => call[0] === "targetcreated",
      )[1];
      await targetCreatedHandler(mockTarget);

      // Find the request handler
      const requestHandlerCall = newMockPage.on.mock.calls.find(
        (call: any[]) => call[0] === "request",
      );
      const requestHandler = requestHandlerCall?.[1];

      // Create a mock https:// request
      const mockHttpsRequest = {
        url: vi.fn().mockReturnValue("https://example.com/page"),
        abort: vi.fn().mockResolvedValue(undefined),
        continue: vi.fn().mockResolvedValue(undefined),
      };

      // Trigger the request handler with https:// URL
      requestHandler(mockHttpsRequest);

      // Verify the request was continued, not aborted
      expect(mockHttpsRequest.continue).toHaveBeenCalled();
      expect(mockHttpsRequest.abort).not.toHaveBeenCalled();
      // Page should NOT be closed
      expect(newMockPage.close).not.toHaveBeenCalled();
    });

    it("should block file:// protocol responses and emit violation", async () => {
      await driver.launch({ options: {} });

      const violationListener = vi.fn();
      driver.on("event", violationListener);

      const newMockPage = {
        url: vi.fn().mockReturnValue("about:blank"),
        close: vi.fn().mockResolvedValue(undefined),
        setRequestInterception: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        off: vi.fn(),
      };

      const mockTarget = {
        type: vi.fn().mockReturnValue("page"),
        url: vi.fn().mockReturnValue("about:blank"),
        page: vi.fn().mockResolvedValue(newMockPage),
      };

      const targetCreatedHandler = mockBrowser.on.mock.calls.find(
        (call: any[]) => call[0] === "targetcreated",
      )[1];
      await targetCreatedHandler(mockTarget);

      // Find the response handler
      const responseHandlerCall = newMockPage.on.mock.calls.find(
        (call: any[]) => call[0] === "response",
      );
      expect(responseHandlerCall).toBeDefined();
      const responseHandler = responseHandlerCall?.[1];

      // Create a mock file:// response
      const mockFileResponse = {
        url: vi.fn().mockReturnValue("file:///etc/shadow"),
      };

      // Trigger the response handler with file:// URL
      responseHandler(mockFileResponse);

      // Verify the page was closed
      expect(newMockPage.close).toHaveBeenCalled();
      // Verify the violation event was emitted
      expect(violationListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "fileProtocolViolation",
          data: { url: "file:///etc/shadow" },
        }),
      );
    });
  });

  describe("close", () => {
    it("should handle close when browser is null", async () => {
      await expect(driver.close()).resolves.not.toThrow();
    });

    it("should close browser and kill process", async () => {
      await driver.launch({ options: {} });
      await driver.close();

      expect(mockBrowser.close).toHaveBeenCalled();
      expect(mockProcess.kill).toHaveBeenCalled();
      expect(driver.getBrowser()).toBeNull();
      expect(driver.getPrimaryPage()).toBeNull();
    });

    it("should handle browser.close() failure gracefully", async () => {
      mockBrowser.close.mockRejectedValueOnce(new Error("Close failed"));

      await driver.launch({ options: {} });
      await driver.close();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining("browser.close()"),
      );
      // Should still try to kill process
      expect(mockProcess.kill).toHaveBeenCalled();
    });

    it("should handle process.kill() failure gracefully", async () => {
      mockProcess.kill.mockImplementation(() => {
        throw new Error("Kill failed");
      });

      await driver.launch({ options: {} });
      await driver.close();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining("process.kill()"),
      );
    });

    it("should set browser and page to null after close", async () => {
      await driver.launch({ options: {} });

      expect(driver.getBrowser()).not.toBeNull();
      expect(driver.getPrimaryPage()).not.toBeNull();

      await driver.close();

      expect(driver.getBrowser()).toBeNull();
      expect(driver.getPrimaryPage()).toBeNull();
    });
  });

  describe("forceClose", () => {
    it("should handle forceClose when browser is null", async () => {
      await expect(driver.forceClose()).resolves.not.toThrow();
    });

    it("should close browser and SIGKILL process", async () => {
      await driver.launch({ options: {} });
      await driver.forceClose();

      expect(mockBrowser.close).toHaveBeenCalled();
      expect(mockProcess.kill).toHaveBeenCalledWith("SIGKILL");
    });

    it("should log force close action", async () => {
      await driver.launch({ options: {} });
      await driver.forceClose();

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Force closing browser"),
      );
    });

    it("should handle browser.close() failure in forceClose", async () => {
      mockBrowser.close.mockRejectedValueOnce(new Error("Force close failed"));

      await driver.launch({ options: {} });
      await driver.forceClose();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining("forceClose"),
      );
      // Should still try to kill process
      expect(mockProcess.kill).toHaveBeenCalledWith("SIGKILL");
    });

    it("should handle missing process in forceClose", async () => {
      mockBrowser.process.mockReturnValue(null);

      await driver.launch({ options: {} });
      await expect(driver.forceClose()).resolves.not.toThrow();
    });

    it("should set browser and page to null after forceClose", async () => {
      await driver.launch({ options: {} });
      await driver.forceClose();

      expect(driver.getBrowser()).toBeNull();
      expect(driver.getPrimaryPage()).toBeNull();
    });
  });

  describe("EventEmitter", () => {
    it("should support multiple event listeners", async () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      driver.on("event", listener1);
      driver.on("event", listener2);

      driver.emitFileProtocolViolation("file:///test");

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });

    it("should support removeListener", async () => {
      const listener = vi.fn();

      driver.on("event", listener);
      driver.emitFileProtocolViolation("file:///test1");

      driver.removeListener("event", listener);
      driver.emitFileProtocolViolation("file:///test2");

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
});
