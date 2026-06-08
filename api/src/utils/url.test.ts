import { afterEach, describe, expect, it, vi } from "vitest";

describe("url helpers", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("uses localhost instead of 0.0.0.0 for default public base urls", async () => {
    vi.stubEnv("HOST", "0.0.0.0");
    vi.stubEnv("PORT", "3000");
    vi.stubEnv("USE_SSL", "false");
    vi.stubEnv("DOMAIN", "");

    const { getBaseUrl, getUrl, getInternalHost } = await import("./url.js");

    expect(getBaseUrl()).toBe("http://localhost:3000/");
    expect(getBaseUrl("ws")).toBe("ws://localhost:3000/");
    expect(getUrl("v1/sessions/debug")).toBe("http://localhost:3000/v1/sessions/debug");
    expect(getInternalHost()).toBe("localhost");
  });

  it("prefers x-forwarded-host and upgrades websocket protocol from forwarded https", async () => {
    vi.stubEnv("HOST", "0.0.0.0");
    vi.stubEnv("PORT", "3000");
    vi.stubEnv("USE_SSL", "false");
    vi.stubEnv("DOMAIN", "");

    const { getBaseUrlFromRequest, getUrlFromRequest } = await import("./url.js");

    const request = {
      headers: {
        host: "localhost:3000",
        "x-forwarded-host": "public.steel.dev",
        "x-forwarded-proto": "https",
      },
    } as any;

    expect(getBaseUrlFromRequest(request)).toBe("https://public.steel.dev/");
    expect(getBaseUrlFromRequest(request, "ws")).toBe("wss://public.steel.dev/");
    expect(getUrlFromRequest(request, "v1/sessions/debug")).toBe(
      "https://public.steel.dev/v1/sessions/debug",
    );
  });

  it("prefers request host headers for externally visible urls", async () => {
    vi.stubEnv("HOST", "0.0.0.0");
    vi.stubEnv("PORT", "3000");
    vi.stubEnv("USE_SSL", "false");
    vi.stubEnv("DOMAIN", "");

    const { getBaseUrlFromRequest, getUrlFromRequest } = await import("./url.js");

    const request = {
      headers: {
        host: "steel.example.com",
        "x-forwarded-proto": "https",
      },
    } as any;

    expect(getBaseUrlFromRequest(request)).toBe("https://steel.example.com/");
    expect(getBaseUrlFromRequest(request, "ws")).toBe("wss://steel.example.com/");
    expect(getUrlFromRequest(request, "v1/sessions/debug")).toBe(
      "https://steel.example.com/v1/sessions/debug",
    );
  });
});
