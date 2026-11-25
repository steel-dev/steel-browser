import { EventEmitter } from "node:events";
import type { FastifyBaseLogger } from "fastify";
import puppeteer, { type Browser } from "puppeteer-core";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { env } from "../../env.js";
import type { BrowserLauncherOptions } from "../../types/browser.js";
import { CDPService } from "./cdp.service.js";
import { buildScreenInfoSwitch } from "./fingerprint/index.js";
import { ShutdownReason } from "./plugins/core/base-plugin.js";

vi.mock("puppeteer-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("puppeteer-core")>();
  return { ...actual, default: { launch: vi.fn() } };
});

vi.mock("../file.service.js", () => ({
  FileService: {
    getInstance: () => ({
      cleanupFiles: vi.fn().mockResolvedValue(undefined),
      getBaseFilesPath: () => "/fixture/downloads",
    }),
  },
}));

vi.mock("../timezone-fetcher.service.js", () => ({
  TimezoneFetcher: class {
    getTimezone() {
      return Promise.resolve("UTC");
    }
  },
}));

vi.mock("../../utils/extensions.js", () => ({
  getExtensionPaths: vi.fn().mockResolvedValue([]),
}));

vi.mock("./instrumentation/target-manager.js", () => ({
  TargetInstrumentationManager: class {
    attach = vi.fn().mockResolvedValue(undefined);
    detach = vi.fn();
  },
}));

vi.mock("./utils/profile-lock.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./utils/profile-lock.js")>()),
  releaseStaleProfileLock: vi.fn(async () => ({ status: "free" })),
}));

vi.mock("./fingerprint/chrome-version.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./fingerprint/chrome-version.js")>()),
  readChromeVersion: vi.fn(async () => ({ major: 156, full: "156.0.8078.108" })),
}));

vi.mock("../../scripts/index.js", () => ({
  loadFingerprintScript: vi.fn(() => "page-script"),
  loadWorkerFingerprintScript: vi.fn(() => "worker-script"),
}));

const logger = {
  child: () => logger,
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
};

const CHROME_156 =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36";

function fakeSession() {
  return Object.assign(new EventEmitter(), {
    send: vi.fn().mockResolvedValue({}),
    detach: vi.fn().mockResolvedValue(undefined),
  });
}

function fakeBrowser() {
  const browserSession = Object.assign(new EventEmitter(), {
    send: vi.fn().mockResolvedValue({}),
    detach: vi.fn().mockResolvedValue(undefined),
    connection: () => undefined,
  });
  const target = {
    type: () => "browser",
    createCDPSession: vi.fn().mockResolvedValue(browserSession),
  };
  const page = { target: () => target, close: vi.fn(), isClosed: () => false };
  const browser = Object.assign(new EventEmitter(), {
    close: vi.fn().mockResolvedValue(undefined),
    process: () => ({ kill: vi.fn() }),
    pages: vi.fn().mockResolvedValue([page]),
    newPage: vi.fn().mockResolvedValue(page),
    target: () => target,
    targets: () => [],
    wsEndpoint: () => "ws://fixture/browser",
  }) as unknown as Browser;
  return { browser, browserSession };
}

function config(overrides: Partial<BrowserLauncherOptions> = {}): BrowserLauncherOptions {
  return {
    options: { headless: true },
    userDataDir: "/fixture/browser-data",
    dimensions: { width: 1920, height: 1080 },
    ...overrides,
  };
}

async function launch(overrides: Partial<BrowserLauncherOptions> = {}) {
  const fake = fakeBrowser();
  vi.mocked(puppeteer.launch).mockResolvedValue(fake.browser);
  const service = new CDPService({}, logger as unknown as FastifyBaseLogger);
  await service.startNewSession(config(overrides));
  const options = vi.mocked(puppeteer.launch).mock.calls.at(-1)![0]!;
  return { service, options, args: options.args!, ...fake };
}

describe("CDPService fingerprint launch", () => {
  let service: CDPService | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await service?.shutdown(ShutdownReason.SESSION_END);
    service = undefined;
  });

  test("starts the browser with the fingerprint UA, language and screen", async () => {
    const launched = await launch();
    service = launched.service;

    expect(launched.args).toContain(`--user-agent=${CHROME_156}`);
    expect(launched.args).toContain("--lang=en-US");
    expect(launched.args).toContain("--screen-info={1920x1080}");
    expect(launched.options.ignoreDefaultArgs).toEqual([
      "--enable-automation",
      "--hide-scrollbars",
      "--disable-ipc-flooding-protection",
    ]);
    expect(launched.args).not.toContain("--disable-ipc-flooding-protection");
    expect(launched.options.targetFilter).toBeTypeOf("function");
    expect(service.getFingerprintData()!.headers["sec-ch-ua"]).toBe(
      '"Not:A-Brand";v="8", "Chromium";v="156", "Google Chrome";v="156"',
    );
  });

  test("keeps the window's screen for sessions without fingerprint injection", async () => {
    const launched = await launch({
      skipFingerprintInjection: true,
      dimensions: { width: 1280, height: 800 },
    });
    service = launched.service;

    expect(launched.args).toContain("--screen-info={1280x800}");
    expect(launched.args.some((arg) => arg.startsWith("--user-agent="))).toBe(false);
    expect(launched.args.some((arg) => arg.startsWith("--lang="))).toBe(false);
    expect(launched.options.targetFilter).toBeUndefined();
  });

  test("passes an explicit user agent as is, without fingerprint overrides", async () => {
    const launched = await launch({ userAgent: "Custom/1.0" });
    service = launched.service;

    expect(launched.args).toContain("--user-agent=Custom/1.0");
    expect(launched.options.targetFilter).toBeUndefined();
    expect(service.getFingerprintData()).toBeNull();
  });

  test("generates an Android Chrome for mobile sessions and launches with its screen", async () => {
    const launched = await launch({
      deviceConfig: { device: "mobile" },
      dimensions: { width: 508, height: 1074 },
    });
    service = launched.service;

    const { navigator, screen } = service.getFingerprintData()!.fingerprint;
    expect(navigator.userAgent).toMatch(
      /^Mozilla\/5\.0 \(Linux; Android 10; K\) .* Chrome\/156\.0\.0\.0/,
    );
    expect(launched.args).toContain(`--user-agent=${navigator.userAgent}`);
    // Out-of-process iframes cannot be emulated, so the phone screen comes from the switch.
    expect(launched.args).toContain(buildScreenInfoSwitch(screen));
  });

  test("applies the WebRTC policy only behind a proxy", async () => {
    const direct = await launch();
    expect(direct.args.some((arg) => arg.includes("webrtc"))).toBe(false);
    await direct.service.shutdown(ShutdownReason.SESSION_END);

    const proxied = await launch({ options: { headless: true, proxyUrl: "http://127.0.0.1:9" } });
    service = proxied.service;
    expect(proxied.args).toContain("--webrtc-ip-handling-policy=disable_non_proxied_udp");
    expect(proxied.args).not.toContain("--force-webrtc-ip-handling-policy");
  });

  test("attaches a browser-level session to service workers", async () => {
    const launched = await launch();
    service = launched.service;

    expect(launched.browserSession.send).toHaveBeenCalledWith(
      "Target.setAutoAttach",
      expect.objectContaining({
        waitForDebuggerOnStart: true,
        filter: [{ type: "service_worker", exclude: false }],
      }),
    );
  });

  test("merges custom headers into DEFAULT_HEADERS and sends no client hint headers", async () => {
    const defaults = env.DEFAULT_HEADERS;
    env.DEFAULT_HEADERS = { "x-default": "1", "x-shared": "default" };
    try {
      const launched = await launch({
        options: { headless: false },
        customHeaders: { "x-shared": "custom", "x-custom": "2" },
      });
      service = launched.service;
      const page = {
        on: vi.fn(),
        url: () => "about:blank",
        isClosed: () => false,
        setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
        createCDPSession: vi.fn().mockResolvedValue(fakeSession()),
      };
      const target = { _targetId: "p1", type: () => "page", page: async () => page };

      await (service as unknown as { handleNewTarget(t: unknown): Promise<void> }).handleNewTarget(
        target,
      );

      expect(page.setExtraHTTPHeaders).toHaveBeenCalledOnce();
      expect(page.setExtraHTTPHeaders).toHaveBeenCalledWith({
        "x-default": "1",
        "x-shared": "custom",
        "x-custom": "2",
      });
    } finally {
      env.DEFAULT_HEADERS = defaults;
    }
  });

  test("matches the headful window's pixel ratio of 1", async () => {
    const launched = await launch({ options: { headless: false } });
    service = launched.service;
    expect(service.getFingerprintData()!.fingerprint.screen.devicePixelRatio).toBe(1);
    expect(launched.args.some((arg) => arg.startsWith("--screen-info"))).toBe(false);
  });

  test("sets no extra headers when there are none to set", async () => {
    const launched = await launch({ options: { headless: false } });
    service = launched.service;
    const page = {
      on: vi.fn(),
      url: () => "about:blank",
      isClosed: () => false,
      setExtraHTTPHeaders: vi.fn(),
      createCDPSession: vi.fn().mockResolvedValue(fakeSession()),
    };
    const target = { _targetId: "p2", type: () => "page", page: async () => page };

    await (service as unknown as { handleNewTarget(t: unknown): Promise<void> }).handleNewTarget(
      target,
    );

    expect(page.setExtraHTTPHeaders).not.toHaveBeenCalled();
  });
});
