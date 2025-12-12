import { describe, it, expect, beforeEach, vi } from "vitest";
import { FastifyBaseLogger } from "fastify";
import { Orchestrator } from "../orchestrator.js";
import { BasePlugin } from "../../services/cdp/plugins/core/base-plugin.js";

describe("PluginAdapter", () => {
  let logger: FastifyBaseLogger;
  let browser: any;
  let page: any;

  beforeEach(() => {
    logger = {
      child: vi.fn().mockReturnThis(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as any;

    page = {
      close: vi.fn().mockResolvedValue(undefined),
      url: vi.fn().mockReturnValue("about:blank"),
    };
    browser = {
      pages: vi.fn().mockResolvedValue([page]),
      close: vi.fn().mockResolvedValue(undefined),
      process: vi.fn().mockReturnValue({
        kill: vi.fn(),
        setMaxListeners: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        once: vi.fn(),
      }),
      wsEndpoint: vi.fn().mockReturnValue("ws://localhost:9222"),
      newPage: vi.fn().mockResolvedValue(page),
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
    };
  });

  it("should call onBrowserLaunch and onBrowserReady during launch", async () => {
    const orchestrator = new Orchestrator({ logger, keepAlive: false });

    const plugin = {
      name: "test-plugin",
      setService: vi.fn(),
      onBrowserLaunch: vi.fn().mockResolvedValue(undefined),
      onBrowserReady: vi.fn(),
      onBrowserClose: vi.fn(),
      onSessionEnd: vi.fn(),
      onShutdown: vi.fn(),
      onBeforePageClose: vi.fn(),
    } as unknown as BasePlugin;

    orchestrator.registerPlugin(plugin);

    (orchestrator as any).driver.launch = vi.fn(async () => ({ browser, primaryPage: page }));
    (orchestrator as any).driver.close = vi.fn().mockResolvedValue(undefined);

    await orchestrator.launch({ options: {} });

    expect(plugin.onBrowserLaunch).toHaveBeenCalledWith(browser);
    expect(plugin.onBrowserReady).toHaveBeenCalled();
  });

  it("should call onSessionEnd during endSession", async () => {
    const orchestrator = new Orchestrator({ logger, keepAlive: false });

    const plugin = {
      name: "test-plugin",
      setService: vi.fn(),
      onBrowserLaunch: vi.fn().mockResolvedValue(undefined),
      onBrowserReady: vi.fn(),
      onBrowserClose: vi.fn(),
      onSessionEnd: vi.fn().mockResolvedValue(undefined),
      onShutdown: vi.fn(),
      onBeforePageClose: vi.fn(),
    } as unknown as BasePlugin;

    orchestrator.registerPlugin(plugin);

    (orchestrator as any).driver.launch = vi.fn(async () => ({ browser, primaryPage: page }));
    (orchestrator as any).driver.close = vi.fn().mockResolvedValue(undefined);
    (orchestrator as any).driver.forceClose = vi.fn().mockResolvedValue(undefined);

    await orchestrator.launch({ options: {} });
    await orchestrator.endSession();

    expect(plugin.onSessionEnd).toHaveBeenCalled();
  });

  it("should call onBeforePageClose during refreshPrimaryPage", async () => {
    const orchestrator = new Orchestrator({ logger, keepAlive: false });

    const oldPage = { close: vi.fn().mockResolvedValue(undefined) };
    const newPage = { url: vi.fn().mockReturnValue("about:blank") };

    const plugin = {
      name: "test-plugin",
      setService: vi.fn(),
      onBeforePageClose: vi.fn().mockResolvedValue(undefined),
      onBrowserLaunch: vi.fn(),
      onBrowserReady: vi.fn(),
      onBrowserClose: vi.fn(),
      onSessionEnd: vi.fn(),
      onShutdown: vi.fn(),
    } as unknown as BasePlugin;

    orchestrator.registerPlugin(plugin);

    (orchestrator as any).driver.launch = vi.fn(async () => ({ browser, primaryPage: oldPage }));
    (orchestrator as any).driver.getBrowser = vi.fn().mockReturnValue(browser);
    (orchestrator as any).driver.getPrimaryPage = vi.fn().mockReturnValue(oldPage);
    (orchestrator as any).driver.close = vi.fn().mockResolvedValue(undefined);
    (orchestrator as any).driver.forceClose = vi.fn().mockResolvedValue(undefined);

    browser.newPage = vi.fn().mockResolvedValue(newPage);

    await orchestrator.launch({ options: {} });
    await orchestrator.refreshPrimaryPage();

    expect(plugin.onBeforePageClose).toHaveBeenCalledWith(oldPage);
  });
});
