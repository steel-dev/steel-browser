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
    const manager = new TargetInstrumentationManager(logger, { error: vi.fn() } as any, {
      captureWorkerNetwork: true,
    });

    await manager.attach(target, TargetType.OTHER);

    expect(send).toHaveBeenCalledWith("Network.enable");

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
});
