import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../env.js";
import type { BrowserLauncherOptions } from "../types/index.js";
import type { CDPService } from "./cdp/cdp.service.js";
import type { FileService } from "./file.service.js";
import type { SeleniumService } from "./selenium.service.js";
import { PERSISTENT_USER_DATA_DIR, SessionService, resolveUserDataDir } from "./session.service.js";

const defaultUserDataDir = env.CHROME_USER_DATA_DIR || path.join(os.tmpdir(), "steel-chrome");

describe("resolveUserDataDir", () => {
  it("uses the directory the caller asked for", () => {
    expect(resolveUserDataDir({ userDataDir: "/data/profiles/tenant-a" })).toBe(
      "/data/profiles/tenant-a",
    );
  });

  it("keeps distinct requested directories distinct", () => {
    expect(resolveUserDataDir({ userDataDir: "/data/profiles/tenant-a" })).not.toBe(
      resolveUserDataDir({ userDataDir: "/data/profiles/tenant-b" }),
    );
  });

  it("prefers the requested directory over the persistent one", () => {
    expect(resolveUserDataDir({ userDataDir: "/data/profiles/tenant-a", persist: true })).toBe(
      "/data/profiles/tenant-a",
    );
  });

  it("uses the persistent directory when persist is set without a path", () => {
    expect(resolveUserDataDir({ persist: true })).toBe(PERSISTENT_USER_DATA_DIR);
  });

  it("falls back to the configured or ephemeral default", () => {
    expect(resolveUserDataDir({})).toBe(defaultUserDataDir);
    expect(resolveUserDataDir({ persist: false })).toBe(defaultUserDataDir);
    expect(resolveUserDataDir({ userDataDir: "" })).toBe(defaultUserDataDir);
  });
});

describe("SessionService.startSession", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "steel-session-service-"));
  let launchConfigs: BrowserLauncherOptions[] = [];

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    launchConfigs = [];
  });

  const createService = () => {
    const cdpService = {
      getUserAgent: () => "test-user-agent",
      getDimensions: () => ({ width: 1920, height: 1080 }),
      startNewSession: vi.fn(async (config: BrowserLauncherOptions) => {
        launchConfigs.push(config);
      }),
    } as unknown as CDPService;

    return new SessionService({
      cdpService,
      seleniumService: {} as SeleniumService,
      fileService: {} as FileService,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    });
  };

  const start = async (service: SessionService, userDataDir: string) =>
    service.startSession({
      userDataDir,
      // Avoid the network lookup the fetcher would otherwise perform.
      timezone: "UTC",
      credentials: undefined,
    });

  it("launches the browser with the requested user data directory", async () => {
    const service = createService();
    const userDataDir = path.join(tmpRoot, "tenant-a");

    await start(service, userDataDir);

    expect(launchConfigs).toHaveLength(1);
    expect(launchConfigs[0].userDataDir).toBe(userDataDir);
    expect(fs.existsSync(userDataDir)).toBe(true);
  });

  it("keeps sessions that request different directories on different profiles", async () => {
    const service = createService();
    const tenantA = path.join(tmpRoot, "tenant-a");
    const tenantB = path.join(tmpRoot, "tenant-b");

    await start(service, tenantA);
    await start(service, tenantB);

    expect(launchConfigs.map((config) => config.userDataDir)).toEqual([tenantA, tenantB]);
  });
});
