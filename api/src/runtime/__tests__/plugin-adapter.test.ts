import { describe, it, expect, beforeEach, vi } from "vitest";
import { PluginAdapter } from "../plugin-adapter.js";
import { SessionState } from "../types.js";
import { BasePlugin } from "../../services/cdp/plugins/core/base-plugin.js";
import { TaskScheduler } from "../task-scheduler.js";
import { FastifyBaseLogger } from "fastify";

class TestPlugin extends BasePlugin {
  constructor(name: string) {
    super({ name });
  }

  onBrowserLaunch = vi.fn();
  onBrowserReady = vi.fn();
  onSessionEnd = vi.fn();
  onBrowserClose = vi.fn();
  onBeforePageClose = vi.fn();
}

describe("PluginAdapter", () => {
  let adapter: PluginAdapter;
  let mockScheduler: TaskScheduler;
  let mockLogger: FastifyBaseLogger;

  beforeEach(() => {
    mockLogger = {
      child: vi.fn().mockReturnThis(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as any;

    mockScheduler = {
      waitUntil: vi.fn(),
    } as any;

    adapter = new PluginAdapter(mockLogger, mockScheduler);
  });

  describe("plugin registration", () => {
    it("should register a plugin", () => {
      const plugin = new TestPlugin("test-plugin");
      adapter.register(plugin);

      expect(adapter.getPlugin("test-plugin")).toBe(plugin);
    });

    it("should unregister a plugin", () => {
      const plugin = new TestPlugin("test-plugin");
      adapter.register(plugin);

      const result = adapter.unregister("test-plugin");

      expect(result).toBe(true);
      expect(adapter.getPlugin("test-plugin")).toBeUndefined();
    });

    it("should return false when unregistering non-existent plugin", () => {
      const result = adapter.unregister("non-existent");
      expect(result).toBe(false);
    });
  });

  describe("onEnter hooks", () => {
    it("should call onBrowserLaunch when entering Launching state", async () => {
      const plugin = new TestPlugin("test-plugin");
      adapter.register(plugin);

      const ctx = { browser: {} as any };
      await adapter.onEnter(SessionState.Launching, ctx);

      expect(plugin.onBrowserLaunch).toHaveBeenCalledWith(ctx.browser);
    });

    it("should schedule onBrowserReady via TaskScheduler when entering Ready state", async () => {
      const plugin = new TestPlugin("test-plugin");
      adapter.register(plugin);

      const ctx = { config: { options: {} } };
      await adapter.onEnter(SessionState.Ready, ctx);

      // Wait for async scheduling
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockScheduler.waitUntil).toHaveBeenCalled();
    });
  });

  describe("invokeOnSessionEnd", () => {
    it("should call onSessionEnd on all plugins", async () => {
      const plugin1 = new TestPlugin("plugin1");
      const plugin2 = new TestPlugin("plugin2");

      adapter.register(plugin1);
      adapter.register(plugin2);

      const config = { options: {} };
      await adapter.invokeOnSessionEnd(config);

      expect(plugin1.onSessionEnd).toHaveBeenCalledWith(config);
      expect(plugin2.onSessionEnd).toHaveBeenCalledWith(config);
    });

    it("should handle plugin errors gracefully", async () => {
      const plugin = new TestPlugin("test-plugin");
      plugin.onSessionEnd.mockRejectedValue(new Error("Plugin error"));

      adapter.register(plugin);

      const config = { options: {} };
      await adapter.invokeOnSessionEnd(config);

      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("invokeOnBeforePageClose", () => {
    it("should call onBeforePageClose on all plugins", async () => {
      const plugin1 = new TestPlugin("plugin1");
      const plugin2 = new TestPlugin("plugin2");

      adapter.register(plugin1);
      adapter.register(plugin2);

      const page = {};
      await adapter.invokeOnBeforePageClose(page);

      expect(plugin1.onBeforePageClose).toHaveBeenCalledWith(page);
      expect(plugin2.onBeforePageClose).toHaveBeenCalledWith(page);
    });
  });

  describe("onExit hooks", () => {
    it("should call onBrowserClose when exiting Draining state", async () => {
      const plugin = new TestPlugin("test-plugin");
      adapter.register(plugin);

      const ctx = { browser: {} as any };
      await adapter.onExit(SessionState.Draining, ctx);

      expect(plugin.onBrowserClose).toHaveBeenCalledWith(ctx.browser);
    });
  });
});
