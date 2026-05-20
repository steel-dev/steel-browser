import { describe, it, expect, vi, beforeEach } from "vitest";
import { startPluginManager, startPluginStartup } from "../plugin-manager.actor.js";

describe("Plugin Manager Actor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call startup lifecycle hooks", async () => {
    const browser = {
      instance: {},
    } as any;
    const plugin = {
      name: "test",
      onBrowserLaunch: vi.fn().mockResolvedValue(undefined),
      onBrowserReady: vi.fn().mockResolvedValue(undefined),
    };

    await startPluginStartup({
      browser,
      config: {} as any,
      plugins: [plugin as any],
    });

    expect(plugin.onBrowserLaunch).toHaveBeenCalledWith(browser.instance);
    expect(plugin.onBrowserReady).toHaveBeenCalled();
  });

  it("should register page event hooks", () => {
    const browser = {
      instance: {
        on: vi.fn(),
        off: vi.fn(),
      },
    } as any;

    const stop = startPluginManager(
      {
        browser,
        config: {} as any,
        plugins: [],
      },
      vi.fn(),
    );

    expect(browser.instance.on).toHaveBeenCalledWith("targetcreated", expect.any(Function));
    stop();
    expect(browser.instance.off).toHaveBeenCalledWith("targetcreated", expect.any(Function));
  });

  it("should handle startup hook errors without crashing", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const browser = {
      instance: {},
    } as any;
    const failingPlugin = {
      name: "fail",
      onBrowserReady: vi.fn().mockRejectedValue(new Error("Fail")),
    };

    await startPluginStartup({
      browser,
      config: {} as any,
      plugins: [failingPlugin as any],
    });

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("should handle onPageCreated when a target is created", async () => {
    const browser = {
      instance: {
        on: vi.fn(),
        off: vi.fn(),
      },
    } as any;
    const plugin = {
      name: "test",
      onPageCreated: vi.fn().mockResolvedValue(undefined),
    };

    startPluginManager(
      {
        browser,
        config: {} as any,
        plugins: [plugin as any],
      },
      vi.fn(),
    );

    const handler = browser.instance.on.mock.calls.find((c) => c[0] === "targetcreated")[1];

    const mockPage = { id: "p1" };
    const mockTarget = {
      type: () => "page",
      page: vi.fn().mockResolvedValue(mockPage),
    };

    await handler(mockTarget);

    expect(plugin.onPageCreated).toHaveBeenCalledWith(mockPage);
  });
});
