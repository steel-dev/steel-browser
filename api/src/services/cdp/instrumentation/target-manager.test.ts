import { EventEmitter } from "node:events";
import type { CDPSession, Target } from "puppeteer-core";
import { TargetType } from "puppeteer-core";
import { describe, expect, it, vi } from "vitest";

import { BrowserEventType } from "../../../types/index.js";
import { TargetInstrumentationManager } from "./target-manager.js";

describe("TargetInstrumentationManager", () => {
  it("captures network requests from dedicated worker targets", async () => {
    const session = new EventEmitter() as EventEmitter & {
      send: ReturnType<typeof vi.fn>;
      id: () => string;
    };
    const send = vi.fn().mockResolvedValue({});
    session.send = send;
    session.id = () => "cdp-session";

    const target = {
      _targetId: "worker-target",
      _getTargetInfo: () => ({ type: "worker" }),
      url: () => "blob:https://example.com/worker",
      createCDPSession: vi.fn().mockResolvedValue(session as unknown as CDPSession),
    } as unknown as Target;
    const logger = {
      record: vi.fn(),
      resetContext: vi.fn(),
      setContext: vi.fn(),
      getContext: vi.fn().mockReturnValue({}),
    };
    const appLogger = { error: vi.fn(), warn: vi.fn() } as any;
    const manager = new TargetInstrumentationManager(logger, appLogger, {
      captureWorkerNetwork: true,
    });

    await manager.attach(target, TargetType.OTHER);

    expect(send).toHaveBeenCalledWith("Network.enable");
    expect(appLogger.warn).toHaveBeenCalledWith(
      "[TargetManager] Puppeteer's paused dedicated-worker session was unavailable; falling back to createCDPSession(), which may miss initial worker activity",
    );

    session.emit("Network.requestWillBeSent", {
      requestId: "request-1",
      request: {
        method: "POST",
        url: "https://example.com/worker-request",
        headers: {},
      },
      type: "Fetch",
    });

    expect(logger.record).toHaveBeenCalledWith(
      expect.objectContaining({
        type: BrowserEventType.Request,
        pageId: "worker-target",
        targetType: TargetType.OTHER,
        request: expect.objectContaining({
          method: "POST",
          url: "https://example.com/worker-request",
        }),
      }),
    );
  });

  it("enables network on Puppeteer's paused worker session", async () => {
    const session = new EventEmitter() as EventEmitter & {
      send: ReturnType<typeof vi.fn>;
      id: () => string;
    };
    const send = vi.fn().mockResolvedValue({});
    session.send = send;
    session.id = () => "cdp-session";

    const target = {
      _targetId: "worker-target",
      _getTargetInfo: () => ({ type: "worker" }),
      _session: () => session,
      url: () => "blob:https://example.com/worker",
      createCDPSession: vi.fn().mockRejectedValue(new Error("must reuse paused session")),
    } as unknown as Target;
    const logger = {
      record: vi.fn(),
      resetContext: vi.fn(),
      setContext: vi.fn(),
      getContext: vi.fn().mockReturnValue({}),
    };
    const onTargetSession = vi.fn().mockResolvedValue(undefined);
    const manager = new TargetInstrumentationManager(
      logger,
      { error: vi.fn() } as any,
      {
        captureWorkerNetwork: true,
      },
      onTargetSession,
    );

    await manager.attach(target, TargetType.OTHER);

    expect(target.createCDPSession).not.toHaveBeenCalled();
    expect(onTargetSession).toHaveBeenCalledWith(
      expect.objectContaining({
        target,
        session,
        isDedicatedWorker: true,
        isPuppeteerPaused: true,
      }),
    );
    expect(send.mock.calls[0]?.[0]).toBe("Network.enable");
  });

  it("queues network capture before a target-session hook resolves", async () => {
    const session = new EventEmitter() as EventEmitter & {
      send: ReturnType<typeof vi.fn>;
      id: () => string;
    };
    const send = vi.fn().mockResolvedValue({});
    session.send = send;
    session.id = () => "cdp-session";

    const target = {
      _targetId: "worker-target",
      _getTargetInfo: () => ({ type: "worker" }),
      _session: () => session,
      url: () => "blob:https://example.com/worker",
      createCDPSession: vi.fn(),
    } as unknown as Target;
    const logger = {
      record: vi.fn(),
      resetContext: vi.fn(),
      setContext: vi.fn(),
      getContext: vi.fn().mockReturnValue({}),
    };
    let resolveTargetSession!: () => void;
    const onTargetSession = vi.fn(
      () => new Promise<void>((resolve) => (resolveTargetSession = resolve)),
    );
    const manager = new TargetInstrumentationManager(
      logger,
      { error: vi.fn() } as any,
      { captureWorkerNetwork: true },
      onTargetSession,
    );

    const attachment = manager.attach(target, TargetType.OTHER);

    expect(onTargetSession).toHaveBeenCalledOnce();
    expect(send.mock.calls.some(([method]) => method === "Network.enable")).toBe(true);

    resolveTargetSession();
    await attachment;
  });
});
