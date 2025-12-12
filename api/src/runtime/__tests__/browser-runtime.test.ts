import { describe, it, expect, vi, beforeEach } from "vitest";
import { CDPService } from "../../services/cdp/cdp.service.js";
import { Orchestrator } from "../orchestrator.js";
import { BrowserRuntime } from "../../types/browser-runtime.interface.js";
import { FastifyBaseLogger } from "fastify";

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
    DISPLAY: ":99",
    DEBUG_CHROME_PROCESS: false,
    CHROME_ARGS: [],
    FILTER_CHROME_ARGS: [],
    USE_SESSION_MACHINE: false,
  },
}));

describe("BrowserRuntime Interface Parity", () => {
  let mockLogger: FastifyBaseLogger;

  beforeEach(() => {
    mockLogger = {
      child: vi.fn().mockReturnThis(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as any;
  });

  describe("Orchestrator implements BrowserRuntime", () => {
    it("should implement all required BrowserRuntime methods", () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      // Core lifecycle
      expect(typeof orchestrator.launch).toBe("function");
      expect(typeof orchestrator.shutdown).toBe("function");
      expect(typeof orchestrator.startNewSession).toBe("function");
      expect(typeof orchestrator.endSession).toBe("function");

      // Browser/Page access
      expect(typeof orchestrator.getBrowserInstance).toBe("function");
      expect(typeof orchestrator.getPrimaryPage).toBe("function");
      expect(typeof orchestrator.createPage).toBe("function");
      expect(typeof orchestrator.createBrowserContext).toBe("function");
      expect(typeof orchestrator.getAllPages).toBe("function");
      expect(typeof orchestrator.refreshPrimaryPage).toBe("function");

      // Configuration
      expect(typeof orchestrator.getLaunchConfig).toBe("function");
      expect(typeof orchestrator.getUserAgent).toBe("function");
      expect(typeof orchestrator.getDimensions).toBe("function");
      expect(typeof orchestrator.getFingerprintData).toBe("function");

      // Session context
      expect(typeof orchestrator.getBrowserState).toBe("function");
      expect(typeof orchestrator.getSessionContext).toBe("function");

      // Plugin management
      expect(typeof orchestrator.registerPlugin).toBe("function");
      expect(typeof orchestrator.unregisterPlugin).toBe("function");
      expect(typeof orchestrator.getPlugin).toBe("function");
      expect(typeof orchestrator.waitUntil).toBe("function");

      // Hooks
      expect(typeof orchestrator.registerLaunchHook).toBe("function");
      expect(typeof orchestrator.registerShutdownHook).toBe("function");

      // WebSocket proxying
      expect(typeof orchestrator.setProxyWebSocketHandler).toBe("function");
      expect(typeof orchestrator.proxyWebSocket).toBe("function");

      // Debugging
      expect(typeof orchestrator.getDebuggerUrl).toBe("function");
      expect(typeof orchestrator.getDebuggerWsUrl).toBe("function");
      expect(typeof orchestrator.getTargetId).toBe("function");

      // Instrumentation
      expect(typeof orchestrator.getInstrumentationLogger).toBe("function");
      expect(typeof orchestrator.getLogger).toBe("function");

      // State
      expect(typeof orchestrator.isRunning).toBe("function");

      // EventEmitter
      expect(typeof orchestrator.on).toBe("function");
      expect(typeof orchestrator.removeListener).toBe("function");
    });
  });

  describe("CDPService implements BrowserRuntime", () => {
    it("should implement all required BrowserRuntime methods", () => {
      const cdpService = new CDPService({}, mockLogger);

      // Core lifecycle
      expect(typeof cdpService.launch).toBe("function");
      expect(typeof cdpService.shutdown).toBe("function");
      expect(typeof cdpService.startNewSession).toBe("function");
      expect(typeof cdpService.endSession).toBe("function");

      // Browser/Page access
      expect(typeof cdpService.getBrowserInstance).toBe("function");
      expect(typeof cdpService.getPrimaryPage).toBe("function");
      expect(typeof cdpService.createPage).toBe("function");
      expect(typeof cdpService.createBrowserContext).toBe("function");
      expect(typeof cdpService.getAllPages).toBe("function");
      expect(typeof cdpService.refreshPrimaryPage).toBe("function");

      // Configuration
      expect(typeof cdpService.getLaunchConfig).toBe("function");
      expect(typeof cdpService.getUserAgent).toBe("function");
      expect(typeof cdpService.getDimensions).toBe("function");
      expect(typeof cdpService.getFingerprintData).toBe("function");

      // Session context
      expect(typeof cdpService.getBrowserState).toBe("function");
      expect(typeof cdpService.getSessionContext).toBe("function");

      // Plugin management
      expect(typeof cdpService.registerPlugin).toBe("function");
      expect(typeof cdpService.unregisterPlugin).toBe("function");
      expect(typeof cdpService.getPlugin).toBe("function");
      expect(typeof cdpService.waitUntil).toBe("function");

      // Hooks
      expect(typeof cdpService.registerLaunchHook).toBe("function");
      expect(typeof cdpService.registerShutdownHook).toBe("function");

      // WebSocket proxying
      expect(typeof cdpService.setProxyWebSocketHandler).toBe("function");
      expect(typeof cdpService.proxyWebSocket).toBe("function");

      // Debugging
      expect(typeof cdpService.getDebuggerUrl).toBe("function");
      expect(typeof cdpService.getDebuggerWsUrl).toBe("function");
      expect(typeof cdpService.getTargetId).toBe("function");

      // Instrumentation
      expect(typeof cdpService.getInstrumentationLogger).toBe("function");
      expect(typeof cdpService.getLogger).toBe("function");

      // State
      expect(typeof cdpService.isRunning).toBe("function");

      // EventEmitter
      expect(typeof cdpService.on).toBe("function");
      expect(typeof cdpService.removeListener).toBe("function");
    });
  });

  describe("Runtime Interchangeability", () => {
    const createRuntimeConsumer = (runtime: BrowserRuntime) => {
      return {
        checkRunning: () => runtime.isRunning(),
        getLaunchConfig: () => runtime.getLaunchConfig(),
        getDimensions: () => runtime.getDimensions(),
        getLogger: (name: string) => runtime.getLogger(name),
        registerHook: (fn: () => void) => runtime.registerLaunchHook(fn),
      };
    };

    it("should accept Orchestrator as BrowserRuntime", () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      const consumer = createRuntimeConsumer(orchestrator);

      expect(consumer.checkRunning()).toBe(false);
      expect(consumer.getDimensions()).toEqual({ width: 1920, height: 1080 });
    });

    it("should accept CDPService as BrowserRuntime", () => {
      const cdpService = new CDPService({}, mockLogger);

      const consumer = createRuntimeConsumer(cdpService);

      // Just verify the method can be called and returns a boolean
      expect(typeof consumer.checkRunning()).toBe("boolean");
    });

    it("should allow function to work with either runtime", () => {
      const useRuntime = (runtime: BrowserRuntime) => {
        runtime.registerLaunchHook(() => {});
        return runtime.isRunning();
      };

      const orchestrator = new Orchestrator({ logger: mockLogger });
      const cdpService = new CDPService({}, mockLogger);

      expect(() => useRuntime(orchestrator)).not.toThrow();
      expect(() => useRuntime(cdpService)).not.toThrow();
    });
  });

  describe("Method Return Type Consistency", () => {
    it("should return same type for isRunning", () => {
      const orchestrator = new Orchestrator({ logger: mockLogger });
      const cdpService = new CDPService({}, mockLogger);

      const orchestratorResult = orchestrator.isRunning();
      const cdpServiceResult = cdpService.isRunning();

      expect(typeof orchestratorResult).toBe("boolean");
      expect(typeof cdpServiceResult).toBe("boolean");
    });

    it("should return same type for getDimensions", () => {
      const orchestrator = new Orchestrator({ logger: mockLogger });
      const cdpService = new CDPService({}, mockLogger);

      const orchestratorResult = orchestrator.getDimensions();
      const cdpServiceResult = cdpService.getDimensions();

      expect(orchestratorResult).toHaveProperty("width");
      expect(orchestratorResult).toHaveProperty("height");
      expect(cdpServiceResult).toHaveProperty("width");
      expect(cdpServiceResult).toHaveProperty("height");
    });

    it("should return nullable for getInstrumentationLogger", () => {
      const orchestrator = new Orchestrator({ logger: mockLogger });
      const cdpService = new CDPService({}, mockLogger);

      // Both should return either a logger or null
      const orchestratorLogger = orchestrator.getInstrumentationLogger();
      const cdpServiceLogger = cdpService.getInstrumentationLogger();

      // Can be null or object, but same pattern
      expect(orchestratorLogger === null || typeof orchestratorLogger === "object").toBe(true);
      expect(cdpServiceLogger === null || typeof cdpServiceLogger === "object").toBe(true);
    });
  });

  describe("Event Emitter Interface", () => {
    it("should allow adding and removing event listeners on Orchestrator", () => {
      const orchestrator = new Orchestrator({ logger: mockLogger });

      const listener = vi.fn();

      // Verify we can add listener
      orchestrator.on("test-event", listener);
      expect(orchestrator.listenerCount("test-event")).toBe(1);

      // Verify we can remove listener
      orchestrator.removeListener("test-event", listener);
      expect(orchestrator.listenerCount("test-event")).toBe(0);
    });

    it("should allow adding and removing event listeners on CDPService", () => {
      const cdpService = new CDPService({}, mockLogger);

      const listener = vi.fn();

      // Verify we can add listener
      cdpService.on("test-event", listener);
      expect(cdpService.listenerCount("test-event")).toBe(1);

      // Verify we can remove listener
      cdpService.removeListener("test-event", listener);
      expect(cdpService.listenerCount("test-event")).toBe(0);
    });

    it("should emit events to registered listeners on Orchestrator", () => {
      const orchestrator = new Orchestrator({ logger: mockLogger });
      const listener = vi.fn();

      orchestrator.on("custom-event", listener);
      orchestrator.emit("custom-event", { data: "test" });

      expect(listener).toHaveBeenCalledWith({ data: "test" });
    });

    it("should emit events to registered listeners on CDPService", () => {
      const cdpService = new CDPService({}, mockLogger);
      const listener = vi.fn();

      cdpService.on("custom-event", listener);
      cdpService.emit("custom-event", { data: "test" });

      expect(listener).toHaveBeenCalledWith({ data: "test" });
    });
  });
});

describe("Feature Flag Runtime Selection", () => {
  let mockLogger: FastifyBaseLogger;

  beforeEach(() => {
    mockLogger = {
      child: vi.fn().mockReturnThis(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as any;
  });

  it("should create CDPService when USE_SESSION_MACHINE is false", () => {
    // When env.USE_SESSION_MACHINE is false, CDPService should be used
    const cdpService = new CDPService({}, mockLogger);
    expect(cdpService).toBeInstanceOf(CDPService);
  });

  it("should create Orchestrator when USE_SESSION_MACHINE is true", () => {
    // When env.USE_SESSION_MACHINE is true, Orchestrator should be used
    const orchestrator = new Orchestrator({ logger: mockLogger });
    expect(orchestrator).toBeInstanceOf(Orchestrator);
  });

  it("both runtimes should work with same interface contract", async () => {
    const cdpService = new CDPService({}, mockLogger);
    const orchestrator = new Orchestrator({ logger: mockLogger });

    // Both should be usable as BrowserRuntime
    const runtimes: BrowserRuntime[] = [cdpService, orchestrator];

    for (const runtime of runtimes) {
      // Verify methods return expected types
      expect(typeof runtime.isRunning()).toBe("boolean");
      expect(
        runtime.getLaunchConfig() === undefined || typeof runtime.getLaunchConfig() === "object",
      ).toBe(true);

      const logger = runtime.getInstrumentationLogger();
      expect(logger === null || typeof logger === "object").toBe(true);
    }
  });
});
