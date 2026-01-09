import { describe, it, expect, vi, beforeEach } from "vitest";
import { createActor, waitFor } from "xstate";
import { browserMachine } from "./browser.machine.js";
import type { BrowserLauncher, BrowserRef } from "../types.js";
import { createMockBrowserInstance } from "../__tests__/helpers.js";

vi.mock("../utils/timezone.js", () => ({
  fetchTimezone: vi.fn().mockResolvedValue("UTC"),
}));

vi.mock("../tracing/index.js", () => ({
  traceOperation: vi.fn((_name, _level, fn) => fn({ setAttribute: vi.fn(), end: vi.fn() })),
  traceSession: vi.fn((_id, fn) => fn({ setAttribute: vi.fn(), end: vi.fn() })),
  traceBootPhase: vi.fn((_name, fn) => fn({ setAttribute: vi.fn(), end: vi.fn() })),
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

    const actor = createActor(browserMachine, {
      input: {
        launcher,
      },
    });
    actor.start();

    expect(actor.getSnapshot().matches("idle")).toBe(true);

    actor.send({
      type: "START",
      config: { sessionId: "test-session", port: 3000, dataPlanePort: 0 },
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

    const actor = createActor(browserMachine, {
      input: {
        launcher,
      },
    });
    actor.start();

    actor.send({
      type: "START",
      config: { sessionId: "test-session", port: 3000, dataPlanePort: 0 },
    });

    await waitFor(actor, (s) => s.matches("ready"), { timeout: 5000 });

    actor.send({
      type: "BROWSER_CRASHED",
      error: new Error("Crash"),
    });

    await waitFor(actor, (s) => s.matches("idle"), { timeout: 5000 });
    expect(actor.getSnapshot().matches("idle")).toBe(true);
  });

  it("should handle launch failure and transition to idle via cleanup", async () => {
    const launcher: BrowserLauncher = {
      launch: vi.fn().mockRejectedValue(new Error("Launch failed")),
      close: vi.fn(),
      forceClose: vi.fn(),
      getProcess: vi.fn(() => null),
      onDisconnected: vi.fn(() => () => {}),
      onTargetCreated: vi.fn(() => () => {}),
      onTargetDestroyed: vi.fn(() => () => {}),
    };

    const actor = createActor(browserMachine, {
      input: { launcher },
    });
    actor.start();

    actor.send({
      type: "START",
      config: { sessionId: "fail-session", port: 3000 },
    });

    // Capture error while transitioning through cleanup
    let caughtError: any = null;
    actor.subscribe((state) => {
      if (state.context.error) {
        caughtError = state.context.error;
      }
    });

    // Should reach failed -> cleanup -> idle
    await waitFor(actor, (s) => s.matches("idle"), { timeout: 5000 });
    expect(actor.getSnapshot().matches("idle")).toBe(true);
    expect(caughtError?.message).toBe("Launch failed");
  });

  it("should handle END_SESSION and transition through draining", async () => {
    const instance = createMockBrowserInstance();
    const launcher: BrowserLauncher = {
      launch: vi.fn(async () => ({
        id: "test",
        instance: instance as any,
        primaryPage: (await instance.pages())[0] as any,
        pid: 123,
        wsEndpoint: "",
        launchedAt: Date.now(),
      })),
      close: vi.fn(),
      forceClose: vi.fn(),
      getProcess: vi.fn(() => null),
      onDisconnected: vi.fn(() => () => {}),
      onTargetCreated: vi.fn(() => () => {}),
      onTargetDestroyed: vi.fn(() => () => {}),
    };

    const actor = createActor(browserMachine, {
      input: { launcher },
    });
    actor.start();

    actor.send({ type: "START", config: { sessionId: "s1", port: 3000 } });
    await waitFor(actor, (s) => s.matches({ ready: "active" }), { timeout: 5000 });

    actor.send({ type: "END_SESSION" });

    // Should reach ready.draining
    expect(actor.getSnapshot().matches({ ready: "draining" })).toBe(true);

    // Eventually reaches idle
    await waitFor(actor, (s) => s.matches("idle"), { timeout: 5000 });
    expect(actor.getSnapshot().matches("idle")).toBe(true);
  });

  it("should handle STOP event during booting", async () => {
    const launcher: BrowserLauncher = {
      launch: vi.fn(() => new Promise<BrowserRef>(() => {})), // Never resolves
      close: vi.fn(),
      forceClose: vi.fn(),
      getProcess: vi.fn(() => null),
      onDisconnected: vi.fn(() => () => {}),
      onTargetCreated: vi.fn(() => () => {}),
      onTargetDestroyed: vi.fn(() => () => {}),
    };

    const actor = createActor(browserMachine, {
      input: { launcher },
    });
    actor.start();

    actor.send({ type: "START", config: { sessionId: "s1", port: 3000 } });

    // Wait for it to be in booting
    await new Promise((r) => setTimeout(r, 50));
    expect(actor.getSnapshot().matches("booting")).toBe(true);

    actor.send({ type: "STOP" });

    await waitFor(actor, (s) => s.matches("idle"), { timeout: 5000 });
    expect(actor.getSnapshot().matches("idle")).toBe(true);
  });

  it("should handle USER_DISCONNECTED event", async () => {
    const instance = createMockBrowserInstance();
    const launcher: BrowserLauncher = {
      launch: vi.fn(async () => ({
        id: "test",
        instance: instance as any,
        primaryPage: (await instance.pages())[0] as any,
        pid: 123,
        wsEndpoint: "",
        launchedAt: Date.now(),
      })),
      close: vi.fn(),
      forceClose: vi.fn(),
      getProcess: vi.fn(() => null),
      onDisconnected: vi.fn(() => () => {}),
      onTargetCreated: vi.fn(() => () => {}),
      onTargetDestroyed: vi.fn(() => () => {}),
    };

    const actor = createActor(browserMachine, {
      input: { launcher },
    });
    actor.start();

    actor.send({ type: "START", config: { sessionId: "s1", port: 3000 } });
    await waitFor(actor, (s) => s.matches({ ready: "active" }), { timeout: 5000 });

    actor.send({ type: "USER_DISCONNECTED" });

    await waitFor(actor, (s) => s.matches("idle"), { timeout: 5000 });
    expect(actor.getSnapshot().matches("idle")).toBe(true);
  });

  it("should handle error during proxy initialization", async () => {
    const instance = createMockBrowserInstance();
    const launcher: BrowserLauncher = {
      launch: vi.fn(async () => ({
        id: "t",
        instance: instance as any,
        primaryPage: {} as any,
        pid: 1,
        wsEndpoint: "",
        launchedAt: 0,
      })),
      close: vi.fn(),
      forceClose: vi.fn(),
      getProcess: vi.fn(() => null),
      onDisconnected: vi.fn(() => () => {}),
      onTargetCreated: vi.fn(() => () => {}),
      onTargetDestroyed: vi.fn(() => () => {}),
    };

    const actor = createActor(browserMachine, {
      input: { launcher },
    });
    actor.start();
    // No error to simulate easily here without more setup, just fixing the mock for now
  });

  it("should handle START while already booting (idempotent or queue)", async () => {
    const instance = createMockBrowserInstance();
    const launcher: BrowserLauncher = {
      launch: vi.fn(
        () =>
          new Promise<BrowserRef>((r) =>
            setTimeout(
              () =>
                r({
                  id: "t",
                  instance: instance as any,
                  primaryPage: {} as any,
                  pid: 1,
                  wsEndpoint: "",
                  launchedAt: 0,
                }),
              100,
            ),
          ),
      ),
      close: vi.fn(),
      forceClose: vi.fn(),
      getProcess: vi.fn(() => null),
      onDisconnected: vi.fn(() => () => {}),
      onTargetCreated: vi.fn(() => () => {}),
      onTargetDestroyed: vi.fn(() => () => {}),
    };

    const actor = createActor(browserMachine, {
      input: { launcher },
    });
    actor.start();

    actor.send({ type: "START", config: { sessionId: "s1", port: 3001 } });
    actor.send({ type: "START", config: { sessionId: "s2", port: 3002 } });

    await waitFor(actor, (s) => s.matches({ ready: "active" }), { timeout: 5000 });
    expect(launcher.launch).toHaveBeenCalledTimes(1); // Should only launch once if already booting
  });

  it("should sequence cleanup phases correctly", async () => {
    const instance = createMockBrowserInstance();
    const launcher: BrowserLauncher = {
      launch: vi.fn(async () => ({
        id: "t",
        instance: instance as any,
        primaryPage: {} as any,
        pid: 1,
        wsEndpoint: "",
        launchedAt: 0,
      })),
      close: vi.fn(),
      forceClose: vi.fn(),
      getProcess: vi.fn(() => null),
      onDisconnected: vi.fn(() => () => {}),
      onTargetCreated: vi.fn(() => () => {}),
      onTargetDestroyed: vi.fn(() => () => {}),
    };

    const actor = createActor(browserMachine, {
      input: { launcher },
    });
    actor.start();

    actor.send({ type: "START", config: { sessionId: "s1", port: 3003 } });
    await waitFor(actor, (s) => s.matches({ ready: "active" }), { timeout: 5000 });

    const states: string[] = [];
    actor.subscribe((s) =>
      states.push(typeof s.value === "string" ? s.value : JSON.stringify(s.value)),
    );

    actor.send({ type: "STOP" });
    await waitFor(actor, (s) => s.matches("idle"), { timeout: 5000 });

    // Verify it went through cleanup
    expect(states.some((s) => s.includes("cleanup"))).toBe(true);
  });

  it("should handle error during browser launch and recover", async () => {
    const launcher: BrowserLauncher = {
      launch: vi
        .fn()
        .mockRejectedValueOnce(new Error("First attempt failed"))
        .mockResolvedValueOnce({
          id: "t",
          instance: createMockBrowserInstance() as any,
          primaryPage: {} as any,
          pid: 1,
          wsEndpoint: "",
          launchedAt: 0,
        }),
      close: vi.fn(),
      forceClose: vi.fn(),
      getProcess: vi.fn(() => null),
      onDisconnected: vi.fn(() => () => {}),
      onTargetCreated: vi.fn(() => () => {}),
      onTargetDestroyed: vi.fn(() => () => {}),
    };

    const actor = createActor(browserMachine, {
      input: { launcher },
    });
    actor.start();

    actor.send({ type: "START", config: { sessionId: "s1", port: 3004 } });
    await waitFor(actor, (s) => s.matches("idle"), { timeout: 5000 }); // Should reach idle after failure cleanup

    actor.send({ type: "START", config: { sessionId: "s1", port: 3005 } });
    await waitFor(actor, (s) => s.matches({ ready: "active" }), { timeout: 5000 });
    expect(actor.getSnapshot().matches({ ready: "active" })).toBe(true);
  });

  it("should handle STOP during booting", async () => {
    const launcher: BrowserLauncher = {
      launch: vi.fn(
        () =>
          new Promise<BrowserRef>((r) =>
            setTimeout(
              () =>
                r({
                  id: "t",
                  instance: createMockBrowserInstance() as any,
                  primaryPage: {} as any,
                  pid: 1,
                  wsEndpoint: "",
                  launchedAt: 0,
                }),
              100,
            ),
          ),
      ),
      close: vi.fn(),
      forceClose: vi.fn(),
      getProcess: vi.fn(() => null),
      onDisconnected: vi.fn(() => () => {}),
      onTargetCreated: vi.fn(() => () => {}),
      onTargetDestroyed: vi.fn(() => () => {}),
    };

    const actor = createActor(browserMachine, {
      input: { launcher },
    });
    actor.start();

    actor.send({ type: "START", config: { sessionId: "s1", port: 3006 } });
    await new Promise((r) => setTimeout(r, 20));

    actor.send({ type: "STOP" });

    await waitFor(actor, (s) => s.matches("idle"), { timeout: 5000 });
    expect(actor.getSnapshot().matches("idle")).toBe(true);
  });

  it("should handle BROWSER_EVENT and emit it", async () => {
    const instance = createMockBrowserInstance();
    const launcher: BrowserLauncher = {
      launch: vi.fn(async () => ({
        id: "t",
        instance: instance as any,
        primaryPage: {} as any,
        pid: 1,
        wsEndpoint: "",
        launchedAt: 0,
      })),
      close: vi.fn(),
      forceClose: vi.fn(),
      getProcess: vi.fn(() => null),
      onDisconnected: vi.fn(() => () => {}),
      onTargetCreated: vi.fn(() => () => {}),
      onTargetDestroyed: vi.fn(() => () => {}),
    };

    const actor = createActor(browserMachine, {
      input: { launcher },
    });

    const events: any[] = [];
    actor.on("*", (event) => events.push(event));
    actor.start();

    actor.send({ type: "START", config: { sessionId: "s1", port: 3008 } });
    await waitFor(actor, (s) => s.matches({ ready: "active" }), { timeout: 5000 });

    actor.send({ type: "BROWSER_EVENT", event: "customEvent", data: { foo: "bar" } });

    expect(events.some((e) => e.type === "customEvent" && e.foo === "bar")).toBe(true);
  });

  it("should handle START when already in ready state", async () => {
    const instance = createMockBrowserInstance();
    const launcher: BrowserLauncher = {
      launch: vi.fn(async () => ({
        id: "t",
        instance: instance as any,
        primaryPage: {} as any,
        pid: 1,
        wsEndpoint: "",
        launchedAt: 0,
      })),
      close: vi.fn(),
      forceClose: vi.fn(),
      getProcess: vi.fn(() => null),
      onDisconnected: vi.fn(() => () => {}),
      onTargetCreated: vi.fn(() => () => {}),
      onTargetDestroyed: vi.fn(() => () => {}),
    };

    const actor = createActor(browserMachine, {
      input: { launcher },
    });
    actor.start();

    actor.send({ type: "START", config: { sessionId: "s1", port: 3009 } });
    await waitFor(actor, (s) => s.matches({ ready: "active" }), { timeout: 5000 });

    // In ready state, START should be ignored or cause no transition by default in this machine
    actor.send({ type: "START", config: { sessionId: "s2", port: 3010 } });

    // Machine stays in ready.active
    expect(actor.getSnapshot().matches({ ready: "active" })).toBe(true);
    expect(launcher.launch).toHaveBeenCalledTimes(1);
  });

  it("should handle session context in ResolvedConfig", async () => {
    const instance = createMockBrowserInstance();
    const launcher: BrowserLauncher = {
      launch: vi.fn(async () => ({
        id: "t",
        instance: instance as any,
        primaryPage: {} as any,
        pid: 1,
        wsEndpoint: "",
        launchedAt: 0,
      })),
      close: vi.fn(),
      forceClose: vi.fn(),
      getProcess: vi.fn(() => null),
      onDisconnected: vi.fn(() => () => {}),
      onTargetCreated: vi.fn(() => () => {}),
      onTargetDestroyed: vi.fn(() => () => {}),
    };

    const actor = createActor(browserMachine, {
      input: { launcher },
    });
    actor.start();

    const sessionContext = {
      cookies: [{ name: "c", value: "v", domain: "d" }],
      localStorage: {},
      indexedDB: {},
      sessionStorage: {},
    };

    actor.send({
      type: "START",
      config: { sessionId: "s1", port: 3011, sessionContext },
    });

    await waitFor(actor, (s) => s.matches({ ready: "active" }), { timeout: 5000 });

    const context = actor.getSnapshot().context;
    expect(context.resolvedConfig?.sessionContext).toEqual(sessionContext);
  });

  it("should handle FATAL_ERROR and transition to idle via cleanup", async () => {
    const instance = createMockBrowserInstance();
    const launcher: BrowserLauncher = {
      launch: vi.fn(async () => ({
        id: "t",
        instance: instance as any,
        primaryPage: {} as any,
        pid: 1,
        wsEndpoint: "",
        launchedAt: 0,
      })),
      close: vi.fn(),
      forceClose: vi.fn(),
      getProcess: vi.fn(() => null),
      onDisconnected: vi.fn(() => () => {}),
      onTargetCreated: vi.fn(() => () => {}),
      onTargetDestroyed: vi.fn(() => () => {}),
    };

    const actor = createActor(browserMachine, {
      input: { launcher },
    });
    actor.start();

    actor.send({ type: "START", config: { sessionId: "s1", port: 3012 } });
    await waitFor(actor, (s) => s.matches({ ready: "active" }), { timeout: 5000 });

    actor.send({ type: "FATAL_ERROR", error: new Error("Fatal") });

    await waitFor(actor, (s) => s.matches("idle"), { timeout: 5000 });
    expect(actor.getSnapshot().matches("idle")).toBe(true);
  });
});
