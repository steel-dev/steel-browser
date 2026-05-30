import { describe, it, expect } from "vitest";
import { resolveSessionConfig } from "./session-config.resolver.js";
import type { CreateSessionBody } from "./sessions.schema.js";

describe("resolveSessionConfig", () => {
  it("preserves the fullscreen option", () => {
    const config = resolveSessionConfig({ fullscreen: true } as CreateSessionBody);
    expect(config.fullscreen).toBe(true);
  });

  it("preserves the userDataDir option", () => {
    const config = resolveSessionConfig({ userDataDir: "/tmp/custom" } as CreateSessionBody);
    expect(config.userDataDir).toBe("/tmp/custom");
  });

  it("does not drop any field present on the request body", () => {
    const body = {
      sessionId: "11111111-1111-1111-1111-111111111111",
      proxyUrl: "http://proxy.local:8080",
      userAgent: "steel-test-agent",
      sessionContext: { cookies: [] },
      isSelenium: true,
      blockAds: true,
      optimizeBandwidth: true,
      skipFingerprintInjection: true,
      deviceConfig: { device: "mobile" },
      fullscreen: true,
      logSinkUrl: "http://logs.local",
      extensions: ["ext-a"],
      persist: true,
      userDataDir: "/tmp/custom",
      timezone: "UTC",
      dimensions: { width: 1280, height: 720 },
      userPreferences: { foo: "bar" },
      extra: { trace: "abc" },
      credentials: { autoSubmit: true },
      headless: false,
    } as unknown as CreateSessionBody;

    const config = resolveSessionConfig(body);

    // Every key supplied on the body must survive resolution unchanged.
    for (const key of Object.keys(body) as (keyof CreateSessionBody)[]) {
      expect(config).toHaveProperty(key);
      expect(config[key as keyof typeof config]).toEqual(body[key]);
    }
  });

  it("forwards new/unknown fields without per-field maintenance", () => {
    const body = { someFutureOption: "kept" } as unknown as CreateSessionBody;
    const config = resolveSessionConfig(body) as Record<string, unknown>;
    expect(config.someFutureOption).toBe("kept");
  });
});
