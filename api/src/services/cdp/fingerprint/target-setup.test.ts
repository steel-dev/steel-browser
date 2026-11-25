import { EventEmitter } from "node:events";
import type { BrowserFingerprintWithHeaders } from "fingerprint-generator";
import type { Browser, Target } from "puppeteer-core";
import { describe, expect, test, vi } from "vitest";
import { FingerprintTargetSetup } from "./target-setup.js";

vi.mock("../../../scripts/index.js", () => ({
  loadFingerprintScript: vi.fn(
    (params: { fixedPlatform: string }) => `page:${params.fixedPlatform}`,
  ),
  loadWorkerFingerprintScript: vi.fn(
    (params: { fixedHardwareConcurrency: number }) => `worker:${params.fixedHardwareConcurrency}`,
  ),
}));

const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };

const fingerprintData = {
  headers: { "accept-language": "en-US,en;q=0.9" },
  fingerprint: {
    navigator: {
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
      platform: "Linux x86_64",
      hardwareConcurrency: 6,
      userAgentData: {
        brands: [{ brand: "Chromium", version: "156" }],
        fullVersionList: [{ brand: "Chromium", version: "156.0.8078.108" }],
        uaFullVersion: "156.0.8078.108",
        platform: "Linux",
        mobile: false,
      },
    },
    screen: { width: 1920, height: 1080, devicePixelRatio: 1 },
  },
} as unknown as BrowserFingerprintWithHeaders;

function fakeTarget(type: string, url = "", withSession = true) {
  const send = vi.fn().mockResolvedValue({});
  const target = {
    _session: () => (withSession ? { send } : undefined),
    _getTargetInfo: () => ({ type, url }),
    type: () => type,
    url: () => url,
  } as unknown as Target;
  return { target, send };
}

function setup(screenFromLaunchFlags = true) {
  return new FingerprintTargetSetup({ fingerprintData, screenFromLaunchFlags, logger });
}

describe("FingerprintTargetSetup", () => {
  test("sends the page overrides on Puppeteer's own session, synchronously", () => {
    const { target, send } = fakeTarget("page");

    expect(setup().targetFilter(target)).toBe(true);

    expect(send.mock.calls.map(([method]) => method)).toEqual([
      "Emulation.setUserAgentOverride",
      "Emulation.setHardwareConcurrencyOverride",
      "Page.addScriptToEvaluateOnNewDocument",
    ]);
    expect(send).toHaveBeenCalledWith(
      "Emulation.setUserAgentOverride",
      expect.objectContaining({
        userAgentMetadata: expect.objectContaining({ fullVersion: "156.0.8078.108" }),
      }),
    );
    expect(send).toHaveBeenCalledWith("Emulation.setHardwareConcurrencyOverride", {
      hardwareConcurrency: 6,
    });
    expect(send).toHaveBeenCalledWith("Page.addScriptToEvaluateOnNewDocument", {
      source: "page:Linux x86_64",
    });
  });

  test("adds the screen override when the launch flags cannot set it", () => {
    const { target, send } = fakeTarget("page");
    setup(false).targetFilter(target);
    expect(send).toHaveBeenCalledWith(
      "Emulation.setDeviceMetricsOverride",
      expect.objectContaining({ width: 0, height: 0, screenWidth: 1920, screenHeight: 1080 }),
    );
  });

  test.each(["worker", "shared_worker"])("evaluates the worker script in a paused %s", (type) => {
    const { target, send } = fakeTarget(type, "https://example.com/worker.js");

    setup().targetFilter(target);

    expect(send.mock.calls).toEqual([
      ["Network.setUserAgentOverride", expect.objectContaining({ platform: "Linux x86_64" })],
      ["Emulation.setHardwareConcurrencyOverride", { hardwareConcurrency: 6 }],
      ["Runtime.evaluate", { expression: "worker:6", silent: true }],
    ]);
  });

  test("leaves out-of-process frames' metrics to their page", () => {
    const { target, send } = fakeTarget("iframe", "https://example.com/frame");
    setup(false).targetFilter(target);
    expect(send.mock.calls.map(([method]) => method)).toEqual([
      "Emulation.setUserAgentOverride",
      "Emulation.setHardwareConcurrencyOverride",
      "Page.addScriptToEvaluateOnNewDocument",
    ]);
  });

  test.each([
    ["page", "chrome-extension://abc/popup.html"],
    ["worker", "chrome-extension://abc/worker.js"],
    ["page", "devtools://devtools/bundled/inspector.html"],
    ["tab", ""],
    ["browser_ui", "chrome://omnibox-popup.top-chrome/"],
  ])("does not touch a %s at %j", (type, url) => {
    const { target, send } = fakeTarget(type, url);
    setup().targetFilter(target);
    expect(send).not.toHaveBeenCalled();
  });

  test("skips targets Puppeteer has not attached yet", () => {
    const { target, send } = fakeTarget("page", "", false);
    expect(setup().targetFilter(target)).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  test("never filters a target out, even when setting it up throws", () => {
    const target = {
      _session: () => {
        throw new Error("boom");
      },
    } as unknown as Target;
    expect(setup().targetFilter(target)).toBe(true);
    expect(logger.error).toHaveBeenCalled();
  });

  test("logs a rejected override but not a closed target", async () => {
    const { target, send } = fakeTarget("page");
    send.mockRejectedValueOnce(new Error("Protocol error: Target closed"));
    send.mockRejectedValueOnce(
      new Error("'Emulation.setHardwareConcurrencyOverride' wasn't found"),
    );
    logger.warn.mockClear();

    setup().targetFilter(target);
    await new Promise((resolve) => setImmediate(resolve));

    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ method: "Emulation.setHardwareConcurrencyOverride" }),
      expect.any(String),
    );
  });

  test("auto-attaches to service workers, applies the worker overrides and resumes them", async () => {
    const workerSend = vi.fn().mockResolvedValue({});
    const extensionSend = vi.fn().mockResolvedValue({});
    const sessions: Record<string, { send: typeof workerSend }> = {
      sw: { send: workerSend },
      ext: { send: extensionSend },
    };
    const root = Object.assign(new EventEmitter(), {
      send: vi.fn().mockResolvedValue({}),
      detach: vi.fn().mockResolvedValue(undefined),
      connection: () => ({ session: (id: string) => sessions[id] }),
    });
    const browser = {
      target: () => ({ createCDPSession: async () => root }),
    } as unknown as Browser;
    const targetSetup = setup();

    await targetSetup.attachServiceWorkers(browser);
    root.emit("Target.attachedToTarget", {
      sessionId: "sw",
      targetInfo: { type: "service_worker", url: "https://example.com/sw.js" },
      waitingForDebugger: true,
    });
    root.emit("Target.attachedToTarget", {
      sessionId: "ext",
      targetInfo: { type: "service_worker", url: "chrome-extension://abc/bg.js" },
      waitingForDebugger: true,
    });

    expect(root.send).toHaveBeenCalledWith("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
      filter: [{ type: "service_worker", exclude: false }],
    });
    expect(workerSend.mock.calls.map(([method]) => method)).toEqual([
      "Network.setUserAgentOverride",
      "Emulation.setHardwareConcurrencyOverride",
      "Runtime.evaluate",
      "Runtime.runIfWaitingForDebugger",
    ]);
    expect(extensionSend.mock.calls).toEqual([["Runtime.runIfWaitingForDebugger"]]);
    expect(root.send).toHaveBeenCalledWith("Target.detachFromTarget", { sessionId: "ext" });
    expect(root.send).not.toHaveBeenCalledWith("Target.detachFromTarget", { sessionId: "sw" });

    await targetSetup.dispose();
    expect(root.detach).toHaveBeenCalledOnce();
  });
});
