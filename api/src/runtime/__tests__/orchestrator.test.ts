import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { Orchestrator } from "../orchestrator.js";
import { FastifyBaseLogger } from "fastify";
import { InvalidStateError } from "../types.js";
import { BasePlugin } from "../../services/cdp/plugins/core/base-plugin.js";

// Mock http-proxy
vi.mock("http-proxy", () => ({
  default: {
    createProxyServer: vi.fn(() => ({
      on: vi.fn(),
      ws: vi.fn(),
    })),
  },
}));

// Mock browser-logger
vi.mock("../../services/cdp/instrumentation/browser-logger.js", () => ({
  createBrowserLogger: vi.fn(() => ({
    on: vi.fn(),
    resetContext: vi.fn(),
  })),
}));

// Mock env
vi.mock("../../env.js", () => ({
  env: {
    HOST: "0.0.0.0",
    PORT: 3000,
    CDP_REDIRECT_PORT: 9222,
    DOMAIN: "localhost",
    CDP_DOMAIN: null,
    USE_SSL: false,
    DEFAULT_TIMEZONE: "UTC",
  },
}));

describe("Orchestrator", () => {
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
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
    };

    mockPage = {
      url: vi.fn().mockReturnValue("about:blank"),
      close: vi.fn().mockResolvedValue(undefined),
      setRequestInterception: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      target: vi.fn().mockReturnValue({ _targetId: "page-123" }),
      createCDPSession: vi.fn().mockResolvedValue({
        send: vi.fn().mockResolvedValue({ cookies: [] }),
        detach: vi.fn().mockResolvedValue(undefined),
      }),
    };

    mockBrowser = {
      pages: vi.fn().mockResolvedValue([mockPage]),
      close: vi.fn().mockResolvedValue(undefined),
      process: vi.fn().mockReturnValue(mockProcess),
      wsEndpoint: vi.fn().mockReturnValue("ws://localhost:9222"),
      newPage: vi.fn().mockResolvedValue(mockPage),
      createBrowserContext: vi.fn().mockResolvedValue({}),
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Initialization", () => {
    it("should initialize with idle state", () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      expect(orchestrator.getSessionState()).toBe("idle");
      expect(orchestrator.isRunning()).toBe(false);
    });

    it("should log initialization", () => {
      new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Initialized with Type State runtime"),
      );
    });

    it("should default keepAlive to true and relaunch after endSession", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        // Not specifying keepAlive - should default to true
      });

      let launchCount = 0;
      (orchestrator as any).driver.launch = vi.fn(async () => {
        launchCount++;
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      (orchestrator as any).driver.close = vi.fn();

      await orchestrator.launch({ options: {} });
      expect(launchCount).toBe(1);

      await orchestrator.endSession();

      // With keepAlive defaulting to true, it should have relaunched
      expect(launchCount).toBe(2);
      expect(orchestrator.isRunning()).toBe(true);
    });
  });

  describe("Concurrency Protection", () => {
    it("should serialize concurrent launch calls and return existing browser (idempotent)", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      // Mock the driver's launch method
      const launchOrder: number[] = [];
      let launchCount = 0;

      (orchestrator as any).driver.launch = vi.fn(async () => {
        const myOrder = ++launchCount;
        launchOrder.push(myOrder);
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      (orchestrator as any).driver.getBrowser = vi.fn().mockReturnValue(mockBrowser);

      // First launch should succeed
      const launch1 = orchestrator.launch({ options: {} });

      // Second launch while first is in progress should wait for first,
      // then return existing browser (idempotent behavior)
      const launch2 = orchestrator.launch({ options: {} });

      const result1 = await launch1;
      expect(result1).toBe(mockBrowser);

      // Second launch should return existing browser (idempotent behavior)
      const result2 = await launch2;
      expect(result2).toBe(mockBrowser);

      // Only one actual launch should have been attempted
      expect(launchOrder).toEqual([1]);
    });

    it("should serialize startNewSession calls", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      const operations: string[] = [];

      (orchestrator as any).driver.launch = vi.fn(async () => {
        operations.push("launch-start");
        await new Promise((resolve) => setTimeout(resolve, 30));
        operations.push("launch-end");
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      (orchestrator as any).driver.close = vi.fn(async () => {
        operations.push("close-start");
        await new Promise((resolve) => setTimeout(resolve, 20));
        operations.push("close-end");
      });

      // Start two sessions concurrently
      const session1 = orchestrator.startNewSession({ options: {} });
      const session2 = orchestrator.startNewSession({ options: {} });

      await Promise.all([session1, session2]);

      // Operations should be serialized, not interleaved
      // First session: launch-start, launch-end
      // Second session: close-start, close-end (end previous), launch-start, launch-end
      expect(operations[0]).toBe("launch-start");
      expect(operations[1]).toBe("launch-end");
      expect(operations[2]).toBe("close-start");
      expect(operations[3]).toBe("close-end");
      expect(operations[4]).toBe("launch-start");
      expect(operations[5]).toBe("launch-end");
    });

    it("should prevent race condition between endSession and startNewSession", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      const operations: string[] = [];

      (orchestrator as any).driver.launch = vi.fn(async () => {
        operations.push("launch");
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      (orchestrator as any).driver.close = vi.fn(async () => {
        operations.push("close-start");
        await new Promise((resolve) => setTimeout(resolve, 50));
        operations.push("close-end");
      });

      // First, launch a session
      await orchestrator.launch({ options: {} });
      operations.length = 0; // Clear operations

      // Now try to end and start new session concurrently
      const endPromise = orchestrator.endSession();
      const startPromise = orchestrator.startNewSession({ options: {} });

      await Promise.all([endPromise, startPromise]);

      // The operations should be serialized
      // Either end completes first, then start
      // Or start acquires lock first and handles the end internally
      expect(operations.filter((op) => op === "close-start").length).toBeGreaterThanOrEqual(1);
    });

    it("should prevent concurrent shutdown calls from double-closing", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      let closeCount = 0;
      (orchestrator as any).driver.close = vi.fn(async () => {
        closeCount++;
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      await orchestrator.launch({ options: {} });

      // Try to shutdown concurrently
      const shutdown1 = orchestrator.shutdown();
      const shutdown2 = orchestrator.shutdown();

      await Promise.all([shutdown1, shutdown2]);

      // Close should only be called once
      expect(closeCount).toBe(1);
    });
  });

  describe("State Transitions", () => {
    it("should report correct session state", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      (orchestrator as any).driver.close = vi.fn();
      (orchestrator as any).driver.forceClose = vi.fn();

      expect(orchestrator.getSessionState()).toBe("idle");

      await orchestrator.launch({ options: {} });
      expect(orchestrator.getSessionState()).toBe("live");

      await orchestrator.shutdown();
      expect(orchestrator.getSessionState()).toBe("closed");
    });

    it("should return existing browser when launching from live state (idempotent)", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      let launchCount = 0;
      (orchestrator as any).driver.launch = vi.fn(async () => {
        launchCount++;
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      const result1 = await orchestrator.launch({ options: {} });
      expect(result1).toBe(mockBrowser);
      expect(launchCount).toBe(1);

      // Second launch should return existing browser without calling driver.launch again
      const result2 = await orchestrator.launch({ options: {} });
      expect(result2).toBe(mockBrowser);
      expect(launchCount).toBe(1); // Still 1, not 2
    });

    it("should throw InvalidStateError when launching from non-idle/non-live state", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      (orchestrator as any).driver.close = vi.fn();

      // Get to closed state
      await orchestrator.launch({ options: {} });
      await orchestrator.shutdown();

      // Now launching from closed should throw
      await expect(orchestrator.launch({ options: {} })).rejects.toThrow(InvalidStateError);
    });
  });

  describe("isRunning", () => {
    it("should return false when idle", () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      expect(orchestrator.isRunning()).toBe(false);
    });

    it("should return true when live", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      await orchestrator.launch({ options: {} });
      expect(orchestrator.isRunning()).toBe(true);
    });

    it("should return false after shutdown", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      (orchestrator as any).driver.close = vi.fn();
      (orchestrator as any).driver.forceClose = vi.fn();

      await orchestrator.launch({ options: {} });
      await orchestrator.shutdown();
      expect(orchestrator.isRunning()).toBe(false);
    });
  });

  describe("Launch Hooks", () => {
    it("should call registered launch hooks before launching", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      const hookOrder: string[] = [];

      orchestrator.registerLaunchHook(async (config) => {
        hookOrder.push("hook1");
        expect(config.options).toBeDefined();
      });

      orchestrator.registerLaunchHook((config) => {
        hookOrder.push("hook2");
      });

      (orchestrator as any).driver.launch = vi.fn(async () => {
        hookOrder.push("launch");
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      await orchestrator.launch({ options: { headless: true } });

      expect(hookOrder).toEqual(["hook1", "hook2", "launch"]);
    });
  });

  describe("Shutdown Hooks", () => {
    it("should call registered shutdown hooks during shutdown", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      const hookCalled = vi.fn();

      orchestrator.registerShutdownHook(async (config) => {
        hookCalled(config);
      });

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      (orchestrator as any).driver.close = vi.fn();

      const launchConfig = { options: { headless: true } };
      await orchestrator.launch(launchConfig);
      await orchestrator.shutdown();

      expect(hookCalled).toHaveBeenCalledWith(launchConfig);
    });
  });

  describe("Plugin Management", () => {
    it("should register plugins", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      const mockPlugin = {
        name: "test-plugin",
        setService: vi.fn(),
        onBrowserLaunch: vi.fn(),
        onBrowserReady: vi.fn(),
        onBrowserClose: vi.fn(),
        onSessionEnd: vi.fn(),
        onShutdown: vi.fn(),
        onBeforePageClose: vi.fn(),
      } as unknown as BasePlugin;

      orchestrator.registerPlugin(mockPlugin);

      expect(mockPlugin.setService).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Registered plugin: test-plugin"),
      );
    });

    it("should warn when overwriting existing plugin", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      const mockPlugin1 = {
        name: "test-plugin",
        setService: vi.fn(),
      } as unknown as BasePlugin;

      const mockPlugin2 = {
        name: "test-plugin",
        setService: vi.fn(),
      } as unknown as BasePlugin;

      orchestrator.registerPlugin(mockPlugin1);
      orchestrator.registerPlugin(mockPlugin2);

      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining("already registered"));
    });

    it("should unregister plugins", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      const mockPlugin = {
        name: "test-plugin",
        setService: vi.fn(),
      } as unknown as BasePlugin;

      orchestrator.registerPlugin(mockPlugin);
      const result = orchestrator.unregisterPlugin("test-plugin");

      expect(result).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Unregistered plugin: test-plugin"),
      );
    });

    it("should return false when unregistering non-existent plugin", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      const result = orchestrator.unregisterPlugin("non-existent");

      expect(result).toBe(false);
    });

    it("should get registered plugin by name", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      const mockPlugin = {
        name: "test-plugin",
        setService: vi.fn(),
      } as unknown as BasePlugin;

      orchestrator.registerPlugin(mockPlugin);

      const retrieved = orchestrator.getPlugin("test-plugin");
      expect(retrieved).toBe(mockPlugin);
    });

    it("should return undefined for non-existent plugin", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      const retrieved = orchestrator.getPlugin("non-existent");
      expect(retrieved).toBeUndefined();
    });

    it("should call plugin lifecycle methods on launch", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      const mockPlugin = {
        name: "test-plugin",
        setService: vi.fn(),
        onBrowserLaunch: vi.fn().mockResolvedValue(undefined),
        onBrowserReady: vi.fn(),
        onBrowserClose: vi.fn(),
        onSessionEnd: vi.fn(),
        onShutdown: vi.fn(),
        onBeforePageClose: vi.fn(),
      } as unknown as BasePlugin;

      orchestrator.registerPlugin(mockPlugin);

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      await orchestrator.launch({ options: {} });

      expect(mockPlugin.onBrowserLaunch).toHaveBeenCalledWith(mockBrowser);
      expect(mockPlugin.onBrowserReady).toHaveBeenCalled();
    });

    it("should handle plugin errors without crashing", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      const mockPlugin = {
        name: "failing-plugin",
        setService: vi.fn(),
        onBrowserLaunch: vi.fn().mockRejectedValue(new Error("Plugin error")),
        onBrowserReady: vi.fn(),
        onBrowserClose: vi.fn(),
        onSessionEnd: vi.fn(),
        onShutdown: vi.fn(),
        onBeforePageClose: vi.fn(),
      } as unknown as BasePlugin;

      orchestrator.registerPlugin(mockPlugin);

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      // Should not throw despite plugin error
      await expect(orchestrator.launch({ options: {} })).resolves.toBeDefined();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining("Plugin failing-plugin"),
      );
    });
  });

  describe("Browser Access", () => {
    it("should return browser instance after launch", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      (orchestrator as any).driver.getBrowser = vi.fn().mockReturnValue(mockBrowser);

      await orchestrator.launch({ options: {} });

      expect(orchestrator.getBrowserInstance()).toBe(mockBrowser);
    });

    it("should return null browser before launch", () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      (orchestrator as any).driver.getBrowser = vi.fn().mockReturnValue(null);

      expect(orchestrator.getBrowserInstance()).toBeNull();
    });
  });

  describe("Primary Page Access", () => {
    it("should return primary page after launch", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      (orchestrator as any).driver.getPrimaryPage = vi.fn().mockReturnValue(mockPage);

      await orchestrator.launch({ options: {} });

      const page = await orchestrator.getPrimaryPage();
      expect(page).toBe(mockPage);
    });

    it("should throw when primary page not available", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      (orchestrator as any).driver.getPrimaryPage = vi.fn().mockReturnValue(null);

      await expect(orchestrator.getPrimaryPage()).rejects.toThrow("Primary page not available");
    });
  });

  describe("Configuration Getters", () => {
    it("should return launch config after launch", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      const config = { options: { headless: true }, userAgent: "Test Agent" };
      await orchestrator.launch(config);

      expect(orchestrator.getLaunchConfig()).toBe(config);
    });

    it("should return undefined config before launch", () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      expect(orchestrator.getLaunchConfig()).toBeUndefined();
    });

    it("should return user agent from config", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      await orchestrator.launch({ options: {}, userAgent: "Custom Agent" });

      expect(orchestrator.getUserAgent()).toBe("Custom Agent");
    });

    it("should return dimensions from config", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      await orchestrator.launch({ options: {}, dimensions: { width: 1280, height: 720 } });

      expect(orchestrator.getDimensions()).toEqual({ width: 1280, height: 720 });
    });

    it("should return default dimensions when not configured", () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      expect(orchestrator.getDimensions()).toEqual({ width: 1920, height: 1080 });
    });

    it("should return fingerprint data from config", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      const fingerprint = { fingerprint: {}, headers: {} } as any;
      await orchestrator.launch({ options: {}, fingerprint });

      expect(orchestrator.getFingerprintData()).toBe(fingerprint);
    });

    it("should return null fingerprint when not configured", () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      expect(orchestrator.getFingerprintData()).toBeNull();
    });
  });

  describe("Page Management", () => {
    it("should create new page", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      (orchestrator as any).driver.getBrowser = vi.fn().mockReturnValue(mockBrowser);

      await orchestrator.launch({ options: {} });

      const newPage = await orchestrator.createPage();
      expect(mockBrowser.newPage).toHaveBeenCalled();
    });

    it("should throw when creating page without browser", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      (orchestrator as any).driver.getBrowser = vi.fn().mockReturnValue(null);

      await expect(orchestrator.createPage()).rejects.toThrow("Browser not initialized");
    });

    it("should create browser context", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      (orchestrator as any).driver.getBrowser = vi.fn().mockReturnValue(mockBrowser);

      await orchestrator.launch({ options: {} });

      await orchestrator.createBrowserContext("http://proxy:8080");
      expect(mockBrowser.createBrowserContext).toHaveBeenCalledWith({
        proxy: { server: "http://proxy:8080" },
      });
    });

    it("should get all pages", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      (orchestrator as any).driver.getBrowser = vi.fn().mockReturnValue(mockBrowser);

      await orchestrator.launch({ options: {} });

      const pages = await orchestrator.getAllPages();
      expect(mockBrowser.pages).toHaveBeenCalled();
    });
  });

  describe("Target ID", () => {
    it("should get target ID from page", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      const targetId = orchestrator.getTargetId(mockPage);
      expect(targetId).toBe("page-123");
    });
  });

  describe("Debugger URLs", () => {
    it("should return debugger URL", () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      const url = orchestrator.getDebuggerUrl();
      expect(url).toContain("devtools/devtools_app.html");
    });

    it("should return debugger WebSocket URL", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      (orchestrator as any).driver.getPrimaryPage = vi.fn().mockReturnValue(mockPage);

      const wsUrl = orchestrator.getDebuggerWsUrl();
      expect(wsUrl).toContain("devtools/page/page-123");
    });

    it("should use provided pageId for debugger WebSocket URL", () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      const wsUrl = orchestrator.getDebuggerWsUrl("custom-page-id");
      expect(wsUrl).toContain("devtools/page/custom-page-id");
    });
  });

  describe("waitUntil", () => {
    it("should delegate to scheduler", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      const mockWaitUntil = vi.fn();
      (orchestrator as any).scheduler.waitUntil = mockWaitUntil;

      const task = Promise.resolve();
      orchestrator.waitUntil(task);

      expect(mockWaitUntil).toHaveBeenCalledWith(expect.any(Function), "external-task");
    });
  });

  describe("WebSocket Proxy", () => {
    it("should set custom proxy handler", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      const customHandler = vi.fn();
      orchestrator.setProxyWebSocketHandler(customHandler);

      (orchestrator as any).driver.getBrowser = vi.fn().mockReturnValue(mockBrowser);

      const req = {} as any;
      const socket = {} as any;
      const head = Buffer.from([]);

      await orchestrator.proxyWebSocket(req, socket, head);

      expect(customHandler).toHaveBeenCalledWith(req, socket, head);
    });

    it("should throw when proxying without browser", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      (orchestrator as any).driver.getBrowser = vi.fn().mockReturnValue(null);

      const req = {} as any;
      const socket = {} as any;
      const head = Buffer.from([]);

      await expect(orchestrator.proxyWebSocket(req, socket, head)).rejects.toThrow(
        "WebSocket endpoint not available",
      );
    });
  });

  describe("Instrumentation", () => {
    it("should return instrumentation logger", () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      const logger = orchestrator.getInstrumentationLogger();
      expect(logger).toBeDefined();
    });

    it("should create child logger", () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      const childLogger = orchestrator.getLogger("test-component");
      expect(mockLogger.child).toHaveBeenCalledWith({ component: "test-component" });
    });
  });

  describe("KeepAlive Behavior", () => {
    it("should relaunch after endSession when keepAlive is true", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: true,
      });

      let launchCount = 0;
      (orchestrator as any).driver.launch = vi.fn(async () => {
        launchCount++;
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      (orchestrator as any).driver.close = vi.fn();

      await orchestrator.launch({ options: { headless: true } });
      expect(launchCount).toBe(1);

      await orchestrator.endSession();

      // Should have relaunched
      expect(launchCount).toBe(2);
      expect(orchestrator.isRunning()).toBe(true);
    });

    it("should NOT relaunch after endSession when keepAlive is false", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      let launchCount = 0;
      (orchestrator as any).driver.launch = vi.fn(async () => {
        launchCount++;
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      (orchestrator as any).driver.close = vi.fn();

      await orchestrator.launch({ options: {} });
      expect(launchCount).toBe(1);

      await orchestrator.endSession();

      expect(launchCount).toBe(1);
      expect(orchestrator.isRunning()).toBe(false);
    });
  });

  describe("Session Context", () => {
    it("should return session context from config", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      const sessionContext = { cookies: [], localStorage: {} };
      await orchestrator.launch({ options: {}, sessionContext: sessionContext as any });

      expect(orchestrator.getSessionContext()).toBe(sessionContext);
    });

    it("should return null session context when not configured", () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      expect(orchestrator.getSessionContext()).toBeNull();
    });
  });

  describe("getBrowserState", () => {
    it("should throw when browser not initialized", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      (orchestrator as any).driver.getBrowser = vi.fn().mockReturnValue(null);
      (orchestrator as any).driver.getPrimaryPage = vi.fn().mockReturnValue(null);

      await expect(orchestrator.getBrowserState()).rejects.toThrow(
        "Browser or primary page not initialized",
      );
    });

    it("should return empty object when userDataDir not set", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      (orchestrator as any).driver.getBrowser = vi.fn().mockReturnValue(mockBrowser);
      (orchestrator as any).driver.getPrimaryPage = vi.fn().mockReturnValue(mockPage);

      // Launch without userDataDir
      await orchestrator.launch({ options: {} });

      const result = await orchestrator.getBrowserState();

      expect(result).toEqual({});
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("No userDataDir specified"),
      );
    });

    it("should handle pages without http URLs", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      // Mock pages with non-http URLs
      const mockChromePages = [
        {
          url: vi.fn().mockReturnValue("chrome://newtab"),
          createCDPSession: mockPage.createCDPSession,
        },
        {
          url: vi.fn().mockReturnValue("about:blank"),
          createCDPSession: mockPage.createCDPSession,
        },
      ];
      mockBrowser.pages.mockResolvedValue(mockChromePages);

      (orchestrator as any).driver.getBrowser = vi.fn().mockReturnValue(mockBrowser);
      (orchestrator as any).driver.getPrimaryPage = vi.fn().mockReturnValue(mockPage);

      // Mock chromeContextService
      (orchestrator as any).chromeContextService.getSessionData = vi.fn().mockResolvedValue({
        localStorage: {},
        sessionStorage: {},
        indexedDB: {},
      });

      await orchestrator.launch({ options: {}, userDataDir: "/tmp/test-data" });

      // Should not throw - gracefully handles non-http pages
      const result = await orchestrator.getBrowserState();

      expect(result).toBeDefined();
      // localStorage extraction for non-http pages should be skipped
      expect(result.localStorage).toBeDefined();
    });

    it("should merge cookie and storage data", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      const mockCookies = [{ name: "session", value: "abc123", domain: "example.com" }];

      // Mock CDP session for getCookies
      const mockCdpSession = {
        send: vi.fn().mockResolvedValue({ cookies: mockCookies }),
        detach: vi.fn().mockResolvedValue(undefined),
      };
      mockPage.createCDPSession.mockResolvedValue(mockCdpSession);

      // Mock page with http URL for storage extraction
      const httpPage = {
        url: vi.fn().mockReturnValue("https://example.com"),
        createCDPSession: vi.fn().mockResolvedValue(mockCdpSession),
        evaluate: vi.fn().mockResolvedValue({}),
      };
      mockBrowser.pages.mockResolvedValue([httpPage]);

      (orchestrator as any).driver.getBrowser = vi.fn().mockReturnValue(mockBrowser);
      (orchestrator as any).driver.getPrimaryPage = vi.fn().mockReturnValue(mockPage);

      // Mock chromeContextService
      (orchestrator as any).chromeContextService.getSessionData = vi.fn().mockResolvedValue({
        localStorage: { "example.com": { key1: "value1" } },
        sessionStorage: {},
        indexedDB: {},
      });

      await orchestrator.launch({ options: {}, userDataDir: "/tmp/test-data" });

      const result = await orchestrator.getBrowserState();

      expect(result.cookies).toEqual(mockCookies);
      expect(result.localStorage).toBeDefined();
    });
  });

  describe("refreshPrimaryPage", () => {
    it("should close old page and set new primary", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      const oldPage = {
        close: vi.fn().mockResolvedValue(undefined),
      };

      const newPage = {
        url: vi.fn().mockReturnValue("about:blank"),
      };

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: oldPage };
      });

      mockBrowser.newPage.mockResolvedValue(newPage);

      (orchestrator as any).driver.getBrowser = vi.fn().mockReturnValue(mockBrowser);
      (orchestrator as any).driver.getPrimaryPage = vi.fn().mockReturnValue(oldPage);

      await orchestrator.launch({ options: {} });
      await orchestrator.refreshPrimaryPage();

      // Old page should be closed
      expect(oldPage.close).toHaveBeenCalled();
      // New page should be created
      expect(mockBrowser.newPage).toHaveBeenCalled();
      // Primary page reference should be updated
      expect((orchestrator as any).driver.primaryPage).toBe(newPage);
    });

    it("should call onBeforePageClose on plugins", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      const oldPage = {
        close: vi.fn().mockResolvedValue(undefined),
      };

      const mockPlugin = {
        name: "test-plugin",
        setService: vi.fn(),
        onBeforePageClose: vi.fn().mockResolvedValue(undefined),
        onBrowserLaunch: vi.fn(),
        onBrowserReady: vi.fn(),
        onBrowserClose: vi.fn(),
        onSessionEnd: vi.fn(),
        onShutdown: vi.fn(),
      } as unknown as BasePlugin;

      orchestrator.registerPlugin(mockPlugin);

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: oldPage };
      });

      const newPage = { url: vi.fn().mockReturnValue("about:blank") };
      mockBrowser.newPage.mockResolvedValue(newPage);

      (orchestrator as any).driver.getBrowser = vi.fn().mockReturnValue(mockBrowser);
      (orchestrator as any).driver.getPrimaryPage = vi.fn().mockReturnValue(oldPage);

      await orchestrator.launch({ options: {} });
      await orchestrator.refreshPrimaryPage();

      expect(mockPlugin.onBeforePageClose).toHaveBeenCalledWith(oldPage);
    });

    it("should handle plugin errors without crashing", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      const oldPage = {
        close: vi.fn().mockResolvedValue(undefined),
      };

      const mockPlugin = {
        name: "failing-plugin",
        setService: vi.fn(),
        onBeforePageClose: vi.fn().mockRejectedValue(new Error("Plugin error")),
        onBrowserLaunch: vi.fn(),
        onBrowserReady: vi.fn(),
        onBrowserClose: vi.fn(),
        onSessionEnd: vi.fn(),
        onShutdown: vi.fn(),
      } as unknown as BasePlugin;

      orchestrator.registerPlugin(mockPlugin);

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: oldPage };
      });

      const newPage = { url: vi.fn().mockReturnValue("about:blank") };
      mockBrowser.newPage.mockResolvedValue(newPage);

      (orchestrator as any).driver.getBrowser = vi.fn().mockReturnValue(mockBrowser);
      (orchestrator as any).driver.getPrimaryPage = vi.fn().mockReturnValue(oldPage);

      await orchestrator.launch({ options: {} });

      // Should not throw despite plugin error
      await expect(orchestrator.refreshPrimaryPage()).resolves.not.toThrow();

      // Error should be logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining("onBeforePageClose"),
      );
    });
  });

  describe("Browser Disconnect Auto-Recovery", () => {
    it("should auto-recover on browser disconnect when keepAlive is true", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: true,
      });

      let launchCount = 0;
      (orchestrator as any).driver.launch = vi.fn(async () => {
        launchCount++;
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      (orchestrator as any).driver.close = vi.fn();

      await orchestrator.launch({ options: {} });
      expect(launchCount).toBe(1);

      // Get the disconnect handler from driver
      const eventHandler = (orchestrator as any).driver.listeners("event")[0];
      expect(eventHandler).toBeDefined();

      // Simulate disconnect event
      await eventHandler({ type: "disconnected", timestamp: Date.now() });

      // Wait for async recovery to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should have relaunched due to auto-recovery
      expect(launchCount).toBe(2);
      expect(orchestrator.isRunning()).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("Auto-recovery complete"),
      );
    });

    it("should call plugin.onSessionEnd on disconnect with keepAlive=true", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: true,
      });

      const mockPlugin = {
        name: "test-plugin",
        setService: vi.fn(),
        onBrowserLaunch: vi.fn(),
        onBrowserReady: vi.fn(),
        onBrowserClose: vi.fn(),
        onSessionEnd: vi.fn().mockResolvedValue(undefined),
        onShutdown: vi.fn(),
        onBeforePageClose: vi.fn(),
      } as unknown as BasePlugin;

      orchestrator.registerPlugin(mockPlugin);

      let launchCount = 0;
      (orchestrator as any).driver.launch = vi.fn(async () => {
        launchCount++;
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      (orchestrator as any).driver.close = vi.fn();
      (orchestrator as any).driver.forceClose = vi.fn();

      const sessionConfig = { options: {} };
      await orchestrator.launch(sessionConfig);
      expect(launchCount).toBe(1);

      // Get the disconnect handler from driver
      const eventHandler = (orchestrator as any).driver.listeners("event")[0];

      // Simulate disconnect event
      await eventHandler({ type: "disconnected", timestamp: Date.now() });

      // Wait for async recovery to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should have called onSessionEnd with the session config
      expect(mockPlugin.onSessionEnd).toHaveBeenCalledWith(sessionConfig);

      // Should have relaunched due to auto-recovery
      expect(launchCount).toBe(2);
    });

    it("should NOT auto-recover on browser disconnect when keepAlive is false", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      let launchCount = 0;
      (orchestrator as any).driver.launch = vi.fn(async () => {
        launchCount++;
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      (orchestrator as any).driver.close = vi.fn();
      (orchestrator as any).driver.forceClose = vi.fn();

      await orchestrator.launch({ options: {} });
      expect(launchCount).toBe(1);

      // Get the disconnect handler from driver
      const eventHandler = (orchestrator as any).driver.listeners("event")[0];

      // Simulate disconnect event
      await eventHandler({ type: "disconnected", timestamp: Date.now() });

      // Wait for async handling
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should NOT have relaunched
      expect(launchCount).toBe(1);
      expect(orchestrator.isRunning()).toBe(false);
    });
  });

  describe("Plugin Lifecycle - onSessionEnd", () => {
    it("should call onSessionEnd before draining during endSession", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      const callOrder: string[] = [];

      const mockPlugin = {
        name: "test-plugin",
        setService: vi.fn(),
        onBrowserLaunch: vi.fn(),
        onBrowserReady: vi.fn(),
        onBrowserClose: vi.fn(),
        onSessionEnd: vi.fn().mockImplementation(() => {
          callOrder.push("onSessionEnd");
        }),
        onShutdown: vi.fn(),
        onBeforePageClose: vi.fn(),
      } as unknown as BasePlugin;

      orchestrator.registerPlugin(mockPlugin);

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      (orchestrator as any).driver.close = vi.fn().mockImplementation(async () => {
        callOrder.push("close");
      });

      await orchestrator.launch({ options: {} });
      await orchestrator.endSession();

      expect(mockPlugin.onSessionEnd).toHaveBeenCalled();
      // onSessionEnd should be called before close
      expect(callOrder.indexOf("onSessionEnd")).toBeLessThan(callOrder.indexOf("close"));
    });

    it("should handle onSessionEnd errors without crashing", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      const mockPlugin = {
        name: "failing-plugin",
        setService: vi.fn(),
        onBrowserLaunch: vi.fn(),
        onBrowserReady: vi.fn(),
        onBrowserClose: vi.fn(),
        onSessionEnd: vi.fn().mockRejectedValue(new Error("Session end error")),
        onShutdown: vi.fn(),
        onBeforePageClose: vi.fn(),
      } as unknown as BasePlugin;

      orchestrator.registerPlugin(mockPlugin);

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      (orchestrator as any).driver.close = vi.fn();

      await orchestrator.launch({ options: {} });

      // Should not throw despite plugin error
      await expect(orchestrator.endSession()).resolves.not.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        expect.stringContaining("onSessionEnd"),
      );
    });
  });

  describe("Plugin Lifecycle - onBrowserClose", () => {
    it("should call onBrowserClose when exiting live state", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      const mockPlugin = {
        name: "test-plugin",
        setService: vi.fn(),
        onBrowserLaunch: vi.fn(),
        onBrowserReady: vi.fn(),
        onBrowserClose: vi.fn().mockResolvedValue(undefined),
        onSessionEnd: vi.fn(),
        onShutdown: vi.fn(),
        onBeforePageClose: vi.fn(),
      } as unknown as BasePlugin;

      orchestrator.registerPlugin(mockPlugin);

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      (orchestrator as any).driver.close = vi.fn();
      (orchestrator as any).driver.forceClose = vi.fn();

      await orchestrator.launch({ options: {} });
      await orchestrator.shutdown();

      expect(mockPlugin.onBrowserClose).toHaveBeenCalledWith(mockBrowser);
    });
  });

  describe("Plugin Lifecycle - onShutdown", () => {
    it("should call onShutdown when session closes", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      const mockPlugin = {
        name: "test-plugin",
        setService: vi.fn(),
        onBrowserLaunch: vi.fn(),
        onBrowserReady: vi.fn(),
        onBrowserClose: vi.fn(),
        onSessionEnd: vi.fn(),
        onShutdown: vi.fn().mockResolvedValue(undefined),
        onBeforePageClose: vi.fn(),
      } as unknown as BasePlugin;

      orchestrator.registerPlugin(mockPlugin);

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      (orchestrator as any).driver.close = vi.fn();
      (orchestrator as any).driver.forceClose = vi.fn();

      await orchestrator.launch({ options: {} });
      await orchestrator.shutdown();

      expect(mockPlugin.onShutdown).toHaveBeenCalled();
    });
  });

  describe("WebSocket Proxy Default Path", () => {
    it("should proxy to browser wsEndpoint by default", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      mockBrowser.wsEndpoint.mockReturnValue("ws://localhost:9222/devtools/browser/abc123");

      (orchestrator as any).driver.getBrowser = vi.fn().mockReturnValue(mockBrowser);

      await orchestrator.launch({ options: {} });

      const mockReq = {} as any;
      const mockSocket = {
        once: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      } as any;
      const mockHead = Buffer.from([]);

      // Should not throw and should use wsProxyServer
      await orchestrator.proxyWebSocket(mockReq, mockSocket, mockHead);

      // Verify wsEndpoint was called
      expect(mockBrowser.wsEndpoint).toHaveBeenCalled();
    });

    it("should set up cleanup listeners on socket", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      mockBrowser.wsEndpoint.mockReturnValue("ws://localhost:9222/devtools/browser/abc123");
      mockBrowser.once = vi.fn();

      (orchestrator as any).driver.getBrowser = vi.fn().mockReturnValue(mockBrowser);

      await orchestrator.launch({ options: {} });

      const mockSocket = {
        once: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
      } as any;

      await orchestrator.proxyWebSocket({} as any, mockSocket, Buffer.from([]));

      // Verify cleanup listeners were attached
      expect(mockSocket.once).toHaveBeenCalledWith("close", expect.any(Function));
      expect(mockSocket.once).toHaveBeenCalledWith("error", expect.any(Function));
      expect(mockBrowser.once).toHaveBeenCalledWith("close", expect.any(Function));
      expect(mockBrowser.once).toHaveBeenCalledWith("disconnected", expect.any(Function));
    });
  });

  describe("Instrumentation Logger Event Forwarding", () => {
    it("should register event forwarding on instrumentation logger", async () => {
      // Capture the callback registered with the instrumentation logger
      let capturedCallback: (event: any) => void = vi.fn();

      const mockInstrumentationLogger = {
        on: vi.fn((event: string, callback: (event: any) => void) => {
          if (event === "log") {
            capturedCallback = callback;
          }
        }),
        resetContext: vi.fn(),
      };

      // Re-mock the browser logger for this specific test
      const createBrowserLoggerMock = await vi.importMock(
        "../../services/cdp/instrumentation/browser-logger.js",
      );
      (createBrowserLoggerMock as any).createBrowserLogger = vi
        .fn()
        .mockReturnValue(mockInstrumentationLogger);

      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      // Verify that the orchestrator registered a listener on the instrumentation logger
      expect(mockInstrumentationLogger.on).toHaveBeenCalledWith("log", expect.any(Function));

      const listener = vi.fn();
      orchestrator.on("log", listener);

      // Simulate the instrumentation logger emitting an event
      capturedCallback({ data: "test-log-data" });

      // The event should be forwarded to the orchestrator
      expect(listener).toHaveBeenCalledWith({ data: "test-log-data" });
    });
  });

  describe("startNewSession Edge Cases", () => {
    it("should recover from error state before starting new session", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      let launchCount = 0;
      (orchestrator as any).driver.launch = vi.fn(async () => {
        launchCount++;
        if (launchCount === 1) {
          // First launch succeeds
          return { browser: mockBrowser, primaryPage: mockPage };
        }
        // Subsequent launches succeed
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      (orchestrator as any).driver.close = vi.fn();
      (orchestrator as any).driver.forceClose = vi.fn();

      await orchestrator.launch({ options: {} });

      // Force into error state by simulating crash
      const eventHandler = (orchestrator as any).driver.listeners("event")[0];
      await eventHandler({ type: "disconnected", timestamp: Date.now() });

      // Wait for state transition
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Now try to start a new session
      const browser = await orchestrator.startNewSession({ options: { headless: true } });

      expect(browser).toBeDefined();
      expect(orchestrator.isRunning()).toBe(true);
    });

    it("should handle starting new session from closed state", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      (orchestrator as any).driver.close = vi.fn();
      (orchestrator as any).driver.forceClose = vi.fn();

      // Launch and then shutdown to get to closed state
      await orchestrator.launch({ options: {} });
      await orchestrator.shutdown();

      expect(orchestrator.getSessionState()).toBe("closed");

      // Start new session from closed state
      const browser = await orchestrator.startNewSession({ options: {} });

      expect(browser).toBeDefined();
      expect(orchestrator.isRunning()).toBe(true);
    });
  });
});
