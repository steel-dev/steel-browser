import { EventEmitter } from "node:events";
import type { FastifyBaseLogger } from "fastify";
import puppeteer, { type Browser } from "puppeteer-core";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { BrowserLauncherOptions } from "../../types/browser.js";
import { getExtensionPaths } from "../../utils/extensions.js";
import { CDPService } from "./cdp.service.js";
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

const logger = {
  child: () => logger,
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
};

function sessionConfig(id: string, fixtureTag: string): BrowserLauncherOptions {
  return {
    options: { headless: false },
    userDataDir: "/fixture/browser-data",
    userAgent: "FixtureBrowser/1.0",
    skipFingerprintInjection: true,
    extra: { session: { id }, fixtureTag },
  };
}

function fakeBrowser(): Browser {
  const cdp = { send: vi.fn().mockResolvedValue({}), detach: vi.fn().mockResolvedValue(undefined) };
  const target = {
    type: () => "browser",
    createCDPSession: vi.fn().mockResolvedValue(cdp),
  };
  const page = {
    target: () => target,
    close: vi.fn().mockResolvedValue(undefined),
    isClosed: () => false,
  };
  return Object.assign(new EventEmitter(), {
    close: vi.fn().mockResolvedValue(undefined),
    process: () => ({ kill: vi.fn() }),
    pages: vi.fn().mockResolvedValue([page]),
    newPage: vi.fn().mockResolvedValue(page),
    target: () => target,
    targets: () => [],
    wsEndpoint: () => "ws://fixture/browser",
  }) as unknown as Browser;
}

function lifecycleFixture() {
  const service = new CDPService({}, logger as unknown as FastifyBaseLogger);
  vi.spyOn(service, "getBrowserState").mockResolvedValue({});
  const events: Array<{
    phase: "launch" | "shutdown";
    config: BrowserLauncherOptions | null;
  }> = [];

  // Hook metadata is opaque to CDPService. Exercise the real lifecycle with
  // a mocked browser, without modelling any particular hook implementation.
  service.registerLaunchHook((config) => {
    events.push({ phase: "launch", config });
  });
  service.registerShutdownHook((config) => {
    events.push({ phase: "shutdown", config });
  });

  return { service, events };
}

describe("CDPService lifecycle hook ownership", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(puppeteer.launch).mockImplementation(async () => fakeBrowser());
    vi.mocked(getExtensionPaths).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  test("tears down the idle browser before running incoming launch hooks", async () => {
    const { service, events } = lifecycleFixture();
    await service.launch();
    const idleConfig = service.getLaunchConfig();
    const incoming = sessionConfig("incoming", "incoming-metadata");
    events.length = 0;

    await service.startNewSession(incoming);

    expect(events.map((event) => event.phase)).toEqual(["shutdown", "launch"]);
    expect(events[0].config?.extra).toEqual(idleConfig?.extra);
    expect(events[1].config).toBe(incoming);
    await service.shutdown(ShutdownReason.SESSION_END);
  });

  test("passes outgoing metadata to shutdown hooks during relaunch", async () => {
    const { service, events } = lifecycleFixture();
    const outgoing = sessionConfig("outgoing", "outgoing-metadata");
    const incoming = sessionConfig("incoming", "incoming-metadata");
    await service.startNewSession(outgoing);
    events.length = 0;

    await service.startNewSession(incoming);

    expect(events.map((event) => event.phase)).toEqual(["shutdown", "launch"]);
    expect(events[0].config?.extra).toBe(outgoing.extra);
    expect(events[1].config).toBe(incoming);
    await service.shutdown(ShutdownReason.SESSION_END);
    expect(events.at(-1)?.config?.extra).toBe(incoming.extra);
  });

  test("updates shutdown ownership when reusing the browser", async () => {
    const { service, events } = lifecycleFixture();
    await service.startNewSession(sessionConfig("first", "shared-metadata"));
    const browser = service.getBrowserInstance();
    const second = sessionConfig("second", "shared-metadata");
    events.length = 0;

    await service.startNewSession(second);

    expect(service.getBrowserInstance()).toBe(browser);
    expect(puppeteer.launch).toHaveBeenCalledOnce();
    expect(events).toEqual([]);
    await service.shutdown(ShutdownReason.SESSION_END);
    expect(events).toEqual([{ phase: "shutdown", config: second }]);
    expect(events[0].config).toBe(second);
  });

  test("reuses the browser when the primary page is already closed", async () => {
    const { service } = lifecycleFixture();
    await service.startNewSession(sessionConfig("first", "shared-metadata"));
    const closed = {
      isClosed: () => true,
      close: vi.fn().mockRejectedValue(new Error("Protocol error: Connection closed.")),
    };
    Object.assign(service as unknown as Record<string, unknown>, { primaryPage: closed });

    await service.startNewSession(sessionConfig("second", "shared-metadata"));

    expect(closed.close).not.toHaveBeenCalled();
    expect(await service.getPrimaryPage()).not.toBe(closed);
    await service.shutdown(ShutdownReason.SESSION_END);
  });

  test("leaves no rejection behind when a page closes during setup", async () => {
    const { service } = lifecycleFixture();
    await service.startNewSession({
      ...sessionConfig("first", "first-metadata"),
      options: { headless: true },
    });
    let closed = false;
    const page = {
      isClosed: () => closed,
      url: () => "about:blank",
      on: vi.fn(),
      evaluateOnNewDocument: vi.fn(async () => {
        closed = true;
        throw new Error("Protocol error (Page.addScriptToEvaluateOnNewDocument): Target closed");
      }),
    };
    const target = { _targetId: "closing", type: () => "page", page: async () => page };

    await (
      service as unknown as { handleNewTarget: (target: unknown) => Promise<void> }
    ).handleNewTarget(target);
    await vi.advanceTimersByTimeAsync(0);

    expect(page.evaluateOnNewDocument).toHaveBeenCalledOnce();
    await service.shutdown(ShutdownReason.SESSION_END);
  });

  test("retains hook ownership across session end and the next idle-browser relaunch", async () => {
    const { service, events } = lifecycleFixture();
    const first = sessionConfig("first", "first-metadata");
    const second = sessionConfig("second", "second-metadata");
    await service.startNewSession(first);
    events.length = 0;

    await service.endSession();

    expect(events.map((event) => event.phase)).toEqual(["shutdown", "launch"]);
    expect(events[0].config?.extra).toBe(first.extra);
    expect(events[1].config?.extra).toBeUndefined();
    events.length = 0;

    await service.startNewSession(second);

    expect(events.map((event) => event.phase)).toEqual(["shutdown", "launch"]);
    expect(events[0].config?.extra).toBeUndefined();
    expect(events[1].config).toBe(second);
    await service.shutdown(ShutdownReason.SESSION_END);
  });

  test("does not pass incoming metadata to cleanup when a launch hook fails", async () => {
    const { service, events } = lifecycleFixture();
    await service.launch();
    const incoming = sessionConfig("incoming", "incoming-metadata");
    events.length = 0;
    service.registerLaunchHook(() => {
      throw new Error("Fixture launch hook failed");
    });
    const launch = service.launch.bind(service);
    vi.spyOn(service, "launch").mockImplementation((config) => launch(config, { maxAttempts: 1 }));

    await expect(service.startNewSession(incoming)).rejects.toThrow("Fixture launch hook failed");

    expect(events.map((event) => event.phase)).toEqual(["shutdown", "launch", "shutdown"]);
    expect(events[0].config?.extra).toBeUndefined();
    expect(events[1].config).toBe(incoming);
    expect(events[2].config).toBeNull();
  });
});

describe("CDPService cookies", () => {
  test("reads cookies from another open page when the primary page is closed", async () => {
    const service = new CDPService({}, logger as unknown as FastifyBaseLogger);
    const session = { send: vi.fn().mockResolvedValue({ cookies: [{ name: "a" }] }) };
    const other = { send: vi.fn().mockResolvedValue({ cookies: [{ name: "other" }] }) };
    const main = {};
    Object.assign(service as unknown as Record<string, unknown>, {
      primaryPage: { isClosed: () => true },
      browserInstance: {
        defaultBrowserContext: () => main,
        targets: () => [
          { type: () => "page", browserContext: () => ({}), _session: () => other },
          { type: () => "page", browserContext: () => main, _session: () => session },
        ],
      },
    });
    expect(await service.getCookies()).toEqual([{ name: "a" }]);
    expect(session.send).toHaveBeenCalledWith("Network.getAllCookies");
    expect(other.send).not.toHaveBeenCalled();
  });
});
