import { describe, it, expect, vi, beforeEach } from "vitest";
import { createActor, waitFor } from "xstate";
import { browserMachine } from "./browser.machine.js";
import puppeteer from "puppeteer-core";

vi.mock("puppeteer-core", () => ({
  default: {
    launch: vi.fn(),
  },
}));

vi.mock("../actors/timezone.js", () => ({
  fetchTimezone: vi.fn().mockResolvedValue("UTC"),
}));

describe("browserMachine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should transition from idle to ready through booting", async () => {
    const mockBrowser = {
      wsEndpoint: vi.fn().mockReturnValue("ws://localhost:9222"),
      process: vi.fn().mockReturnValue({ pid: 12345 }),
      close: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: vi.fn(),
      pages: vi.fn().mockResolvedValue([
        {
          evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
        },
      ]),
    };
    (puppeteer.launch as any).mockResolvedValue(mockBrowser);

    const actor = createActor(browserMachine);
    actor.start();

    expect(actor.getSnapshot().matches("idle")).toBe(true);

    actor.send({
      type: "START",
      config: { sessionId: "test-session", port: 9222 },
    });

    await waitFor(actor, (s) => s.matches("ready"), { timeout: 5000 });

    expect(actor.getSnapshot().matches("ready")).toBe(true);
    const ctx = actor.getSnapshot().context;
    expect(ctx.resolvedConfig).toBeDefined();
    expect(ctx.browser).toBeDefined();

    actor.send({ type: "STOP" });
    await waitFor(actor, (s) => s.matches("idle"), { timeout: 5000 });
    expect(actor.getSnapshot().matches("idle")).toBe(true);
  });

  it("should handle browser crash", async () => {
    const mockBrowser = {
      wsEndpoint: vi.fn().mockReturnValue("ws://localhost:9222"),
      process: vi.fn().mockReturnValue({ pid: 12345 }),
      close: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      off: vi.fn(),
      pages: vi.fn().mockResolvedValue([
        {
          evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
        },
      ]),
    };
    (puppeteer.launch as any).mockResolvedValue(mockBrowser);

    const actor = createActor(browserMachine);
    actor.start();

    actor.send({
      type: "START",
      config: { sessionId: "test-session", port: 9222 },
    });

    await waitFor(actor, (s) => s.matches("ready"), { timeout: 5000 });

    actor.send({
      type: "BROWSER_CRASHED",
      error: new Error("Crash"),
    });

    await waitFor(actor, (s) => s.matches("idle"), { timeout: 5000 });
    expect(actor.getSnapshot().matches("idle")).toBe(true);
  });
});
