import { describe, it, expect, vi, beforeEach } from "vitest";
import { createActor, waitFor } from "xstate";
import { browserMachine } from "./browser.machine.js";
import type { BrowserLauncher } from "../types.js";
import { createMockBrowserInstance } from "../__tests__/helpers.js";

vi.mock("../actors/timezone.js", () => ({
  fetchTimezone: vi.fn().mockResolvedValue("UTC"),
}));

describe("browserMachine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should transition from idle to ready through booting", async () => {
    const instance = createMockBrowserInstance();

    const launcher: BrowserLauncher = {
      launch: vi.fn(async (config) => ({
        id: config.sessionId,
        instance: instance as any,
        primaryPage: (await instance.pages())[0] as any,
        pid: 12345,
        wsEndpoint: instance.wsEndpoint(),
        launchedAt: Date.now(),
      })),
      close: vi.fn(async () => {}),
      forceClose: vi.fn(async () => {}),
      getProcess: vi.fn(() => null),
      onDisconnected: vi.fn(() => () => {}),
      onTargetCreated: vi.fn(() => () => {}),
      onTargetDestroyed: vi.fn(() => () => {}),
    };

    const actor = createActor(browserMachine, { input: { launcher } });
    actor.start();

    expect(actor.getSnapshot().matches("idle" as any)).toBe(true);

    actor.send({
      type: "START",
      config: { sessionId: "test-session", port: 3000, dataPlanePort: 0 },
    });

    await waitFor(actor, (s) => s.matches("ready" as any), { timeout: 5000 });

    expect(actor.getSnapshot().matches("ready" as any)).toBe(true);
    const ctx = actor.getSnapshot().context;
    expect(ctx.resolvedConfig).toBeDefined();
    expect(ctx.browser).toBeDefined();

    actor.send({ type: "STOP" });
    await waitFor(actor, (s) => s.matches("idle" as any), { timeout: 5000 });
    expect(actor.getSnapshot().matches("idle" as any)).toBe(true);
  });

  it("should handle browser crash", async () => {
    const instance = createMockBrowserInstance();

    const launcher: BrowserLauncher = {
      launch: vi.fn(async (config) => ({
        id: config.sessionId,
        instance: instance as any,
        primaryPage: (await instance.pages())[0] as any,
        pid: 12345,
        wsEndpoint: instance.wsEndpoint(),
        launchedAt: Date.now(),
      })),
      close: vi.fn(async () => {}),
      forceClose: vi.fn(async () => {}),
      getProcess: vi.fn(() => null),
      onDisconnected: vi.fn(() => () => {}),
      onTargetCreated: vi.fn(() => () => {}),
      onTargetDestroyed: vi.fn(() => () => {}),
    };

    const actor = createActor(browserMachine, { input: { launcher } });
    actor.start();

    actor.send({
      type: "START",
      config: { sessionId: "test-session", port: 3000, dataPlanePort: 0 },
    });

    await waitFor(actor, (s) => s.matches("ready" as any), { timeout: 5000 });

    actor.send({
      type: "BROWSER_CRASHED",
      error: new Error("Crash"),
    });

    await waitFor(actor, (s) => s.matches("idle" as any), { timeout: 5000 });
    expect(actor.getSnapshot().matches("idle" as any)).toBe(true);
  });
});
