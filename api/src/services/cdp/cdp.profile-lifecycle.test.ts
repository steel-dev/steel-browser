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

interface ProfileOptions {
  profileId?: string;
  useProfileId?: string;
  persist?: boolean;
  overwrite?: boolean;
}

function sessionConfig(id: string, profile?: ProfileOptions): BrowserLauncherOptions {
  return {
    options: { headless: false },
    userDataDir: "/fixture/browser-data",
    userAgent: "FixtureBrowser/1.0",
    skipFingerprintInjection: true,
    extra: { session: { id }, ...(profile && { profile }) },
  };
}

function fakeBrowser(): Browser {
  const cdp = { send: vi.fn().mockResolvedValue({}), detach: vi.fn().mockResolvedValue(undefined) };
  const target = {
    type: () => "browser",
    createCDPSession: vi.fn().mockResolvedValue(cdp),
  };
  const page = { target: () => target, close: vi.fn().mockResolvedValue(undefined) };
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

function profileFixture() {
  const service = new CDPService({}, logger as unknown as FastifyBaseLogger);
  vi.spyOn(service, "getBrowserState").mockResolvedValue({});
  const stored = new Map<string, Record<string, string>>();
  let browserData: Record<string, string> = {};
  const events: string[] = [];
  const shutdownConfigs: Array<BrowserLauncherOptions | null> = [];

  // Model the managed-browser hooks' restore and persist/overwrite semantics.
  // Chrome and object storage are fixtures; start/launch/reuse/shutdown are real.
  service.registerLaunchHook((config) => {
    const profile = config.extra?.profile as ProfileOptions | undefined;
    if (profile?.useProfileId) {
      events.push(`restore:${profile.useProfileId}`);
      browserData = { ...stored.get(profile.useProfileId) };
    }
  });
  service.registerShutdownHook((config) => {
    shutdownConfigs.push(config);
    const profile = config?.extra?.profile as ProfileOptions | undefined;
    const profileId = profile?.profileId || profile?.useProfileId;
    if (profileId && (profile?.persist || profile?.overwrite)) {
      events.push(`save:${profileId}`);
      stored.set(profileId, { ...browserData });
    }
    browserData = {};
  });

  return {
    service,
    stored,
    events,
    shutdownConfigs,
    writeMarker: (value: string) => {
      browserData.marker = value;
    },
    readMarker: () => browserData.marker,
  };
}

describe("CDPService profile lifecycle ownership", () => {
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

  test("restores an existing writable profile before saving and preserves it for later readers", async () => {
    const fixture = profileFixture();
    const { service, stored, events } = fixture;
    await service.launch();
    await service.startNewSession(sessionConfig("seed", { profileId: "P", persist: true }));
    expect(events).toEqual([]);
    fixture.writeMarker("exact-marker");
    await service.endSession();
    expect(stored.get("P")).toEqual({ marker: "exact-marker" });

    for (const [index, overwrite] of [false, true, false, false].entries()) {
      events.length = 0;
      await service.startNewSession(
        sessionConfig(`reader-${index}`, { useProfileId: "P", overwrite }),
      );
      expect(events).toEqual(["restore:P"]);
      expect(fixture.readMarker()).toBe("exact-marker");
      await service.endSession();
      expect(events).toEqual(overwrite ? ["restore:P", "save:P"] : ["restore:P"]);
      expect(stored.get("P")).toEqual({ marker: "exact-marker" });
    }
  });

  test("saves the outgoing profile, not the incoming profile, during relaunch", async () => {
    const fixture = profileFixture();
    await fixture.service.startNewSession(
      sessionConfig("outgoing", { profileId: "A", persist: true }),
    );
    fixture.writeMarker("outgoing-marker");
    fixture.stored.set("B", { marker: "incoming-marker" });
    fixture.events.length = 0;

    await fixture.service.startNewSession(
      sessionConfig("incoming", { useProfileId: "B", overwrite: true }),
    );

    expect(fixture.events).toEqual(["save:A", "restore:B"]);
    expect(fixture.stored.get("A")).toEqual({ marker: "outgoing-marker" });
    expect(fixture.stored.get("B")).toEqual({ marker: "incoming-marker" });
    expect(fixture.readMarker()).toBe("incoming-marker");
    await fixture.service.shutdown(ShutdownReason.SESSION_END);
  });

  test("updates shutdown ownership when reusing the browser", async () => {
    const fixture = profileFixture();
    const profile = { useProfileId: "P", overwrite: true };
    fixture.stored.set("P", { marker: "exact-marker" });
    await fixture.service.startNewSession(sessionConfig("first", profile));
    const browser = fixture.service.getBrowserInstance();
    const second = sessionConfig("second", profile);

    await fixture.service.startNewSession(second);

    expect(fixture.service.getBrowserInstance()).toBe(browser);
    expect(puppeteer.launch).toHaveBeenCalledOnce();
    await fixture.service.shutdown(ShutdownReason.SESSION_END);
    expect(fixture.shutdownConfigs.at(-1)).toBe(second);
    expect(fixture.stored.get("P")).toEqual({ marker: "exact-marker" });
  });

  test("passes idle configuration, not incoming overwrite options, to shutdown hooks", async () => {
    const fixture = profileFixture();
    await fixture.service.launch();
    const idleConfig = fixture.service.getLaunchConfig();
    fixture.stored.set("P", { marker: "exact-marker" });

    await fixture.service.startNewSession(
      sessionConfig("writer", { useProfileId: "P", overwrite: true }),
    );

    expect(fixture.shutdownConfigs).toHaveLength(1);
    expect(fixture.shutdownConfigs[0]?.extra).toEqual(idleConfig?.extra);
    expect(fixture.events).toEqual(["restore:P"]);
    await fixture.service.shutdown(ShutdownReason.SESSION_END);
  });

  test("does not save the incoming profile when its restore hook fails", async () => {
    const fixture = profileFixture();
    await fixture.service.launch();
    fixture.stored.set("P", { marker: "exact-marker" });
    fixture.service.registerLaunchHook(() => {
      throw new Error("Profile restore failed");
    });
    const launch = fixture.service.launch.bind(fixture.service);
    vi.spyOn(fixture.service, "launch").mockImplementation((config) =>
      launch(config, { maxAttempts: 1 }),
    );

    await expect(
      fixture.service.startNewSession(
        sessionConfig("writer", { useProfileId: "P", overwrite: true }),
      ),
    ).rejects.toThrow();

    expect(fixture.events).toEqual(["restore:P"]);
    expect(fixture.stored.get("P")).toEqual({ marker: "exact-marker" });
  });
});
