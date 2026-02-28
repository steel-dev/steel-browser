import { describe, it, expect, vi, beforeEach } from "vitest";
import { drain } from "../drain.actor.js";

describe("Drain Actor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should drain tasks if registry is provided", async () => {
    const taskRegistryRef = {
      send: vi.fn(({ type, resolve }) => {
        if (type === "DRAIN") resolve();
      }),
    };

    await drain({
      taskRegistryRef,
      plugins: [],
      config: {} as any,
      browser: null,
    });

    expect(taskRegistryRef.send).toHaveBeenCalledWith(expect.objectContaining({ type: "DRAIN" }));
    expect(taskRegistryRef.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "CANCEL_ALL" }),
    );
  });

  it("should notify plugins of browser close", async () => {
    const plugin = {
      name: "test",
      onBrowserClose: vi.fn().mockResolvedValue(undefined),
    };
    const browser = { instance: { id: "b1" } } as any;

    await drain({
      plugins: [plugin as any],
      config: {} as any,
      browser,
    });

    expect(plugin.onBrowserClose).toHaveBeenCalledWith(browser.instance);
  });

  it("should notify plugins of session end", async () => {
    const plugin = {
      name: "test",
      onSessionEnd: vi.fn().mockResolvedValue(undefined),
    };
    const config = { sessionId: "s1" } as any;

    await drain({
      plugins: [plugin as any],
      config,
      browser: null,
    });

    expect(plugin.onSessionEnd).toHaveBeenCalledWith(config);
  });

  it("should flush instrumentation logger", async () => {
    const logger = { flush: vi.fn().mockResolvedValue(undefined) };

    await drain({
      instrumentationLogger: logger as any,
      plugins: [],
      config: {} as any,
      browser: null,
    });

    expect(logger.flush).toHaveBeenCalled();
  });

  it("should handle plugin errors gracefully", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failingPlugin = {
      name: "fail",
      onSessionEnd: vi.fn().mockRejectedValue(new Error("Fail")),
    };

    await expect(
      drain({
        plugins: [failingPlugin as any],
        config: {} as any,
        browser: null,
      }),
    ).resolves.not.toThrow();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
