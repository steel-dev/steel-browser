import { afterEach, describe, expect, it, vi } from "vitest";

const originalUseXStateRuntime = process.env.USE_XSTATE_RUNTIME;

describe("env", () => {
  afterEach(() => {
    if (originalUseXStateRuntime === undefined) {
      delete process.env.USE_XSTATE_RUNTIME;
    } else {
      process.env.USE_XSTATE_RUNTIME = originalUseXStateRuntime;
    }
    vi.resetModules();
  });

  it("defaults USE_XSTATE_RUNTIME to false", async () => {
    delete process.env.USE_XSTATE_RUNTIME;
    vi.resetModules();

    const { env } = await import("./env.js");

    expect(env.USE_XSTATE_RUNTIME).toBe(false);
  });

  it("allows USE_XSTATE_RUNTIME to be opted in", async () => {
    process.env.USE_XSTATE_RUNTIME = "true";
    vi.resetModules();

    const { env } = await import("./env.js");

    expect(env.USE_XSTATE_RUNTIME).toBe(true);
  });
});
