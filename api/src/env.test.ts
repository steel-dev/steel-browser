import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = {
  USE_XSTATE_RUNTIME: process.env.USE_XSTATE_RUNTIME,
  CHROME_ARGS: process.env.CHROME_ARGS,
  FILTER_CHROME_ARGS: process.env.FILTER_CHROME_ARGS,
  DEBUG_CHROME_PROCESS: process.env.DEBUG_CHROME_PROCESS,
  DISABLE_CHROME_SANDBOX: process.env.DISABLE_CHROME_SANDBOX,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("env", () => {
  afterEach(() => {
    restoreEnv();
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

  it("parses Chrome launch env flags", async () => {
    process.env.CHROME_ARGS = "--foo --bar=baz";
    process.env.FILTER_CHROME_ARGS = "--disable-gpu --no-first-run";
    process.env.DEBUG_CHROME_PROCESS = "true";
    process.env.DISABLE_CHROME_SANDBOX = "1";
    vi.resetModules();

    const { env } = await import("./env.js");

    expect(env.CHROME_ARGS).toEqual(["--foo", "--bar=baz"]);
    expect(env.FILTER_CHROME_ARGS).toEqual(["--disable-gpu", "--no-first-run"]);
    expect(env.DEBUG_CHROME_PROCESS).toBe(true);
    expect(env.DISABLE_CHROME_SANDBOX).toBe(true);
  });
});
