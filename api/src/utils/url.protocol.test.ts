import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("getUrl protocol selection", () => {
  it("builds secure HTTP and WebSocket URLs when USE_SSL=true", async () => {
    vi.resetModules();
    vi.stubEnv("USE_SSL", "true");
    vi.stubEnv("DOMAIN", "steel.example");

    const { getUrl } = await import("./url.js");

    expect(getUrl("v1/sessions/abc/cast", "http")).toBe(
      "https://steel.example/v1/sessions/abc/cast",
    );
    expect(getUrl("v1/sessions/abc/cast", "ws")).toBe("wss://steel.example/v1/sessions/abc/cast");
  });

  it("builds plain HTTP and WebSocket URLs when USE_SSL=false", async () => {
    vi.resetModules();
    vi.stubEnv("USE_SSL", "false");
    vi.stubEnv("DOMAIN", "steel.example");

    const { getUrl } = await import("./url.js");

    expect(getUrl("v1/sessions/abc/cast", "http")).toBe(
      "http://steel.example/v1/sessions/abc/cast",
    );
    expect(getUrl("v1/sessions/abc/cast", "ws")).toBe("ws://steel.example/v1/sessions/abc/cast");
  });
});
