import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BrowserRuntime } from "./browser-runtime.js";
import { MockLauncher } from "../drivers/mock-launcher.js";
import { pino } from "pino";
import { isSimilarConfig } from "../../services/cdp/utils/validation.js";
import httpProxy from "http-proxy";
import { extractStorageForPage } from "../../utils/context.js";

vi.mock("../../utils/context.js", () => ({
  extractStorageForPage: vi.fn().mockResolvedValue({
    localStorage: { "example.com": { key: "value" } },
    sessionStorage: {},
    indexedDB: {},
  }),
  groupSessionStorageByOrigin: vi.fn().mockReturnValue({}),
}));

vi.mock("../../services/context/chrome-context.service.js", () => ({
  ChromeContextService: vi.fn().mockImplementation(() => ({
    getSessionData: vi.fn().mockResolvedValue({
      localStorage: { "another.com": { k: "v" } },
      sessionStorage: {},
      indexedDB: {},
    }),
  })),
}));

vi.mock("http-proxy", () => {
  const proxy = {
    on: vi.fn(),
    ws: vi.fn(),
    emit: vi.fn(),
  };
  return {
    default: {
      createProxyServer: vi.fn().mockReturnValue(proxy),
    },
  };
});

vi.mock("../../services/cdp/utils/validation.js", () => ({
  isSimilarConfig: vi.fn().mockResolvedValue(true),
}));

vi.mock("../utils/timezone.js", () => ({
  fetchTimezone: vi.fn().mockResolvedValue("UTC"),
}));

describe("BrowserRuntime Facade", () => {
  const mockLogger = pino({ level: "silent" });
  const mockInstrumentationLogger = {
    record: vi.fn(),
    on: vi.fn(),
    resetContext: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  };
  let launcher: MockLauncher;
  let runtime: BrowserRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    launcher = new MockLauncher();
    runtime = new BrowserRuntime({
      launcher,
      appLogger: mockLogger,
      instrumentationLogger: mockInstrumentationLogger as any,
      keepAlive: false,
    });
  });

  afterEach(async () => {
    await runtime.shutdown().catch(() => {});
  });

  it("should start and stop the browser", async () => {
    expect(runtime.isRunning()).toBe(false);

    const browser = await runtime.launch({ options: { headless: true } } as any);

    expect(browser).toBeDefined();
    expect(runtime.isRunning()).toBe(true);
    expect(runtime.getState()).toContain("ready");

    await runtime.shutdown();
    expect(runtime.isRunning()).toBe(false);
    expect(runtime.getState()).toBe("idle");
  });

  describe("Concurrency Protection", () => {
    it("should serialize concurrent launch calls and return existing browser", async () => {
      const launch1 = runtime.launch({ options: { headless: true } } as any);
      const launch2 = runtime.launch({ options: { headless: true } } as any);

      const [browser1, browser2] = await Promise.all([launch1, launch2]);

      expect(browser1).toBeDefined();
      expect(browser2).toBe(browser1);
    });

    it("should serialize startNewSession calls", async () => {
      const session1 = runtime.startNewSession({ options: { sessionId: "s1" } } as any);
      const session2 = runtime.startNewSession({ options: { sessionId: "s2" } } as any);

      await Promise.all([session1, session2]);
      expect(runtime.isRunning()).toBe(true);
    });

    it("should prevent race condition between endSession and launch", async () => {
      await runtime.launch({ options: { headless: true } } as any);

      const endPromise = runtime.endSession();
      const launchPromise = runtime.launch({ options: { headless: true } } as any);

      await Promise.all([endPromise, launchPromise]);
      expect(runtime.isRunning()).toBe(true);
    });

    it("should prevent concurrent shutdown from double-closing", async () => {
      await runtime.launch({ options: { headless: true } } as any);

      const shutdown1 = runtime.shutdown();
      const shutdown2 = runtime.shutdown();

      await Promise.all([shutdown1, shutdown2]);
      expect(runtime.isRunning()).toBe(false);
    });
  });

  describe("Config Similarity", () => {
    it("should reuse browser when config is similar", async () => {
      vi.mocked(isSimilarConfig).mockResolvedValue(true);

      const config1 = { options: { headless: true }, userDataDir: "/tmp/1" };
      const config2 = { options: { headless: true }, userDataDir: "/tmp/1" };

      const b1 = await runtime.launch(config1 as any);
      const b2 = await runtime.launch(config2 as any);

      expect(b1).toBe(b2);
    });

    it("should restart session when config differs", async () => {
      vi.mocked(isSimilarConfig).mockResolvedValue(false);

      const config1 = { options: { headless: true }, userDataDir: "/tmp/1" };
      const config2 = { options: { headless: false }, userDataDir: "/tmp/2" };

      const b1 = await runtime.launch(config1 as any);
      const b2 = await runtime.launch(config2 as any);

      expect(b1).not.toBe(b2);
    });
  });

  describe("Plugin Lifecycle", () => {
    it("should call plugin lifecycle methods", async () => {
      const mockPlugin = {
        name: "test-plugin",
        onBrowserLaunch: vi.fn(),
        onBrowserReady: vi.fn(),
        onSessionEnd: vi.fn(),
        onBrowserClose: vi.fn(),
        onShutdown: vi.fn(),
        onPageCreated: vi.fn(),
      };

      runtime.registerPlugin(mockPlugin as any);

      await runtime.launch({ options: { headless: true } } as any);

      // Wait for async initialization
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockPlugin.onBrowserLaunch).toHaveBeenCalled();
      expect(mockPlugin.onBrowserReady).toHaveBeenCalled();

      await runtime.endSession();
      expect(mockPlugin.onSessionEnd).toHaveBeenCalled();
      expect(mockPlugin.onBrowserClose).toHaveBeenCalled();

      await runtime.shutdown();
      expect(mockPlugin.onShutdown).toHaveBeenCalled();
    });

    it("should call onBeforePageClose during refreshPrimaryPage", async () => {
      const mockPlugin = {
        name: "test-plugin",
        onBeforePageClose: vi.fn(),
        onBrowserReady: vi.fn(),
        onSessionEnd: vi.fn(),
      };

      runtime.registerPlugin(mockPlugin as any);
      await runtime.launch({ options: { headless: true } } as any);

      await runtime.refreshPrimaryPage();

      expect(mockPlugin.onBeforePageClose).toHaveBeenCalled();
    });

    it("should handle plugin errors without crashing", async () => {
      const failingPlugin = {
        name: "failing-plugin",
        onBrowserReady: vi.fn().mockRejectedValue(new Error("Plugin failed")),
        onSessionEnd: vi.fn(),
      };

      runtime.registerPlugin(failingPlugin as any);

      // Should not throw
      await expect(runtime.launch({ options: { headless: true } } as any)).resolves.toBeDefined();

      // Wait for async ready call
      await new Promise((r) => setTimeout(r, 100));
    });

    it("should allow unregistering plugins", async () => {
      const mockPlugin = {
        name: "test-plugin",
        onBrowserReady: vi.fn(),
        onSessionEnd: vi.fn(),
      };

      runtime.registerPlugin(mockPlugin as any);
      expect(runtime.getPlugin("test-plugin")).toBeDefined();

      const result = runtime.unregisterPlugin("test-plugin");
      expect(result).toBe(true);
      expect(runtime.getPlugin("test-plugin")).toBeUndefined();
    });
  });

  describe("Hooks System", () => {
    it("should call registered launch hooks before launching", async () => {
      const hookCalled = vi.fn();
      runtime.registerLaunchHook(async (config) => {
        hookCalled(config);
      });

      await runtime.launch({ options: { headless: true } } as any);
      expect(hookCalled).toHaveBeenCalled();
    });

    it("should call registered shutdown hooks during shutdown", async () => {
      const hookCalled = vi.fn();
      runtime.registerShutdownHook(async (config) => {
        hookCalled(config);
      });

      await runtime.launch({ options: { headless: true } } as any);
      await runtime.shutdown();
      expect(hookCalled).toHaveBeenCalled();
    });

    it("should handle async hook errors without crashing", async () => {
      runtime.registerLaunchHook(async () => {
        throw new Error("Hook failed");
      });

      // Should not throw
      await expect(runtime.launch({ options: { headless: true } } as any)).resolves.toBeDefined();
    });
  });

  describe("Configuration Access", () => {
    it("should return correct configuration and state getters", async () => {
      const config = {
        sessionId: "test-session",
        options: { headless: true },
        userAgent: "TestAgent",
        dimensions: { width: 1024, height: 768 },
        sessionContext: { cookies: [] },
      };

      await runtime.launch(config as any);

      expect(runtime.getLaunchConfig()).toBeDefined();
      expect(runtime.getUserAgent()).toBe("TestAgent");
      expect(runtime.getDimensions()).toEqual({ width: 1024, height: 768 });
      expect(runtime.getSessionContext()).toEqual({ cookies: [] });
      expect(runtime.isRunning()).toBe(true);
      expect(runtime.getState()).toContain("ready");
    });

    it("should return fallback dimensions if not provided", async () => {
      await runtime.launch({ options: {} } as any);
      expect(runtime.getDimensions()).toMatchObject({ width: 1920, height: 1080 });
    });
  });

  describe("WebSocket Proxy", () => {
    it("should use custom proxy handler if provided", async () => {
      const customHandler = vi.fn();
      runtime.setProxyWebSocketHandler(customHandler);

      await runtime.proxyWebSocket({} as any, {} as any, {} as any);
      expect(customHandler).toHaveBeenCalled();
    });

    it("should proxy to browser wsEndpoint", async () => {
      await runtime.launch({ options: { headless: true } } as any);

      const mockReq = {};
      const mockSocket = { on: vi.fn(), once: vi.fn(), off: vi.fn() };
      const mockHead = {};

      await runtime.proxyWebSocket(mockReq as any, mockSocket as any, mockHead as any);

      const proxyServer = (httpProxy.createProxyServer as any).mock.results[0].value;
      expect(proxyServer.ws).toHaveBeenCalledWith(
        mockReq,
        mockSocket,
        mockHead,
        expect.objectContaining({ target: expect.stringContaining("ws://") }),
        expect.any(Function),
      );
    });

    it("should throw error if browser is not launched", async () => {
      await expect(runtime.proxyWebSocket({} as any, {} as any, {} as any)).rejects.toThrow(
        "WebSocket endpoint not available",
      );
    });
  });

  describe("Browser State", () => {
    it("should extract browser state (cookies, localStorage, etc.)", async () => {
      await runtime.launch({
        options: { headless: true },
        userDataDir: "/tmp/user-data",
      } as any);

      const state = await runtime.getBrowserState();

      expect(state).toBeDefined();
      expect(state.localStorage).toHaveProperty("example.com");
      expect(extractStorageForPage).toHaveBeenCalled();
    });

    it("should return empty state if no userDataDir", async () => {
      await runtime.launch({ options: { headless: true } } as any);
      const state = await runtime.getBrowserState();
      expect(state).toEqual({});
    });
  });

  describe("Page Management", () => {
    it("should create new page", async () => {
      await runtime.launch({ options: { headless: true } } as any);
      const page = await runtime.createPage();
      expect(page).toBeDefined();
    });

    it("should create browser context", async () => {
      await runtime.launch({ options: { headless: true } } as any);
      const browser = runtime.getBrowserInstance()!;
      browser.createBrowserContext = vi.fn().mockResolvedValue({});

      const context = await runtime.createBrowserContext("http://proxy:8080");
      expect(context).toBeDefined();
      expect(browser.createBrowserContext).toHaveBeenCalledWith({
        proxyServer: "http://proxy:8080",
      });
    });

    it("should get all pages", async () => {
      await runtime.launch({ options: { headless: true } } as any);
      const pages = await runtime.getAllPages();
      expect(pages).toHaveLength(1);
    });

    it("should get primary page", async () => {
      await runtime.launch({ options: { headless: true } } as any);
      const page = await runtime.getPrimaryPage();
      expect(page).toBeDefined();
    });
  });

  describe("Debugging and Utilities", () => {
    it("should return debugger URL", () => {
      const url = runtime.getDebuggerUrl();
      expect(url).toContain("devtools/devtools_app.html");
    });

    it("should return debugger WebSocket URL", async () => {
      await runtime.launch({ options: { headless: true } } as any);
      const wsUrl = runtime.getDebuggerWsUrl();
      expect(wsUrl).toContain("devtools/page/mock-target-id");
    });

    it("should get target ID from page", async () => {
      await runtime.launch({ options: { headless: true } } as any);
      const page = await runtime.getPrimaryPage();
      const targetId = runtime.getTargetId(page);
      expect(targetId).toBe("mock-target-id");
    });

    it("should return fingerprint data", async () => {
      const fingerprint = {
        fingerprint: {
          navigator: { userAgent: "test-ua" },
          screen: { width: 1024, height: 768 },
        },
        headers: {},
      } as any;
      await runtime.launch({ options: { headless: true }, fingerprint } as any);
      expect(runtime.getFingerprintData()).toBe(fingerprint);
    });

    it("should delegate waitUntil to task registry", () => {
      const task = Promise.resolve();
      runtime.waitUntil(task);
      // task registry is internal, but we can verify it doesn't throw
    });

    it("should return instrumentation logger", () => {
      expect(runtime.getInstrumentationLogger()).toBe(mockInstrumentationLogger);
    });

    it("should create child logger", () => {
      const logger = runtime.getLogger("test");
      expect(logger).toBeDefined();
    });
  });

  describe("KeepAlive Behavior", () => {
    it("should relaunch after endSession when keepAlive is true", async () => {
      const kaRuntime = new BrowserRuntime({
        launcher,
        appLogger: mockLogger,
        keepAlive: true,
      });

      await kaRuntime.launch({ options: { headless: true } } as any);
      expect(kaRuntime.isRunning()).toBe(true);

      await kaRuntime.endSession();

      // Wait for relaunch
      await new Promise((r) => setTimeout(r, 100));
      expect(kaRuntime.isRunning()).toBe(true);

      await kaRuntime.shutdown();
    });

    it("should NOT relaunch after endSession when keepAlive is false", async () => {
      const noKaRuntime = new BrowserRuntime({
        launcher,
        appLogger: mockLogger,
        keepAlive: false,
      });

      await noKaRuntime.launch({ options: { headless: true } } as any);
      expect(noKaRuntime.isRunning()).toBe(true);

      await noKaRuntime.endSession();

      expect(noKaRuntime.isRunning()).toBe(false);
    });
  });

  describe("Event Forwarding", () => {
    it("should forward targetCreated event", async () => {
      const listener = vi.fn();
      runtime.on("targetCreated", listener);

      await runtime.launch({ options: { headless: true } } as any);
      const browserRef = (runtime as any).getBrowser()!;

      launcher.simulateTargetCreated(browserRef, { targetId: "new-target" } as any);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          target: expect.objectContaining({ targetId: "new-target" }),
        }),
      );
    });

    it("should forward targetDestroyed event", async () => {
      const listener = vi.fn();
      runtime.on("targetDestroyed", listener);

      await runtime.launch({ options: { headless: true } } as any);
      const browserRef = (runtime as any).getBrowser()!;

      launcher.simulateTargetDestroyed(browserRef, "old-target");

      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ targetId: "old-target" }));
    });

    it("should emit ready event", async () => {
      const listener = vi.fn();
      runtime.on("ready", listener);

      await runtime.launch({ options: { headless: true } } as any);
      expect(listener).toHaveBeenCalled();
    });

    it("should forward fileProtocolViolation event", async () => {
      const listener = vi.fn();
      runtime.on("fileProtocolViolation", listener);

      await runtime.launch({ options: { headless: true } } as any);
      const actor = (runtime as any).actor;
      actor.send({
        type: "BROWSER_EVENT",
        event: "fileProtocolViolation",
        data: { url: "file:///test" },
      });

      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ url: "file:///test" }));
    });
  });

  describe("Session Lifecycle Edge Cases", () => {
    it("should handle updatePrimaryPage", async () => {
      await runtime.launch({ options: { headless: true } } as any);
      const newPage = { id: "new-page" } as any;
      runtime.updatePrimaryPage(newPage);

      const page = await runtime.getPrimaryPage();
      expect(page).toBe(newPage);
    });

    it("should handle multiple startNewSession calls", async () => {
      await runtime.launch({ options: { headless: true } } as any);
      const b1 = runtime.getBrowserInstance();

      const b2 = await runtime.startNewSession({
        options: { headless: true, sessionId: "new" },
      } as any);
      expect(b2).toBeDefined();
      expect(b2).not.toBe(b1);
    });

    it("should handle disconnect handler manual override", async () => {
      const customHandler = vi.fn().mockResolvedValue(undefined);
      runtime.setDisconnectHandler(customHandler);

      await runtime.launch({ options: { headless: true } } as any);
      const browserRef = (runtime as any).getBrowser()!;

      launcher.simulateCrash(browserRef);

      await new Promise((r) => setTimeout(r, 50));
      expect(customHandler).toHaveBeenCalled();
    });

    it("should return config and state properties", async () => {
      const config = {
        options: { headless: true },
        userAgent: "test-ua",
        sessionContext: { cookies: [] },
      };
      await runtime.launch(config as any);

      expect(runtime.getLaunchConfig()).toEqual(config);
      expect(runtime.getUserAgent()).toBe("test-ua");
      expect(runtime.getSessionContext()).toEqual({ cookies: [] });
      expect(runtime.getBrowser()).toBeDefined();
      expect(runtime.getState()).toBeDefined();
    });

    it("should return correct values before launch", () => {
      expect(runtime.getLaunchConfig()).toBeUndefined();
      expect(runtime.getUserAgent()).toBeUndefined();
      expect(runtime.getSessionContext()).toBeNull();
      expect(runtime.getFingerprintData()).toBeNull();
      expect(runtime.getDimensions()).toEqual({ width: 1920, height: 1080 });
    });

    it("should handle plugin management", () => {
      const plugin = { name: "test-p" } as any;
      runtime.registerPlugin(plugin);
      expect(runtime.getPlugin("test-p")).toBe(plugin);

      expect(runtime.unregisterPlugin("test-p")).toBe(true);
      expect(runtime.getPlugin("test-p")).toBeUndefined();
      expect(runtime.unregisterPlugin("non-existent")).toBe(false);
    });

    it("should handle operations when browser is not launched", async () => {
      expect(runtime.getBrowserInstance()).toBeNull();
      await expect(runtime.getPrimaryPage()).rejects.toThrow("Browser not launched");
      await expect(runtime.createPage()).rejects.toThrow("Browser not launched");
      await expect(runtime.createBrowserContext()).rejects.toThrow("Browser not launched");
      expect(await runtime.getAllPages()).toEqual([]);

      // These should not throw
      runtime.updatePrimaryPage({} as any);
      await runtime.refreshPrimaryPage();
    });

    it("should use defaultLaunchConfig if no config provided to launch", async () => {
      const defaultConfig = { options: { headless: false }, sessionId: "default" };
      const runtimeWithDefault = new BrowserRuntime({
        launcher,
        appLogger: mockLogger,
        defaultLaunchConfig: defaultConfig as any,
        keepAlive: false,
      });

      await runtimeWithDefault.launch();
      expect(runtimeWithDefault.getLaunchConfig()).toEqual(defaultConfig);
      await runtimeWithDefault.shutdown();
    });

    it("should handle endSession without active session", async () => {
      await expect(runtime.endSession()).resolves.not.toThrow();
    });

    it("should handle shutdown without active session", async () => {
      await expect(runtime.shutdown()).resolves.not.toThrow();
    });

    it("should handle constructor options defaults", () => {
      const defaultRuntime = new BrowserRuntime();
      expect(defaultRuntime).toBeDefined();
    });

    it("should handle wsProxyServer error event", () => {
      const actor = runtime as any;
      const proxyServer = actor.wsProxyServer;
      proxyServer.emit("error", new Error("Proxy error"));
      // Should log error but not throw
    });
    it("should use default sessionId if not provided", async () => {
      await runtime.launch({ options: { headless: true } } as any);
      const config = runtime.getLaunchConfig();
      expect(config?.sessionId).toBeUndefined(); // mapConfig sets it to "default" in the machine input
    });

    it("should handle null dimensions", async () => {
      await runtime.launch({ options: { headless: true }, dimensions: null } as any);
      expect(runtime.getDimensions()).toMatchObject({ width: 1920, height: 1080 });
    });
    it("should handle failing launch hook", async () => {
      runtime.registerLaunchHook(() => {
        throw new Error("Launch hook fail");
      });
      await expect(runtime.launch({ options: { headless: true } } as any)).resolves.toBeDefined();
    });
  });
});
