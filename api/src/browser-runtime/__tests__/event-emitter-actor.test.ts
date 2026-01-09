import { describe, it, expect, vi, beforeEach } from "vitest";
import { startEventEmitter } from "../actors/event-emitter-actor.js";
import { EventEmitter } from "events";

describe("EventEmitter Actor", () => {
  it("should forward target lifecycle events", async () => {
    const emitter = new EventEmitter();
    const mockBrowser = { instance: new EventEmitter() };
    const mockLauncher = {
      onTargetCreated: vi.fn((b, cb) => {
        mockBrowser.instance.on("targetcreated", cb);
        return () => {};
      }),
      onTargetDestroyed: vi.fn((b, cb) => {
        mockBrowser.instance.on("targetdestroyed", cb);
        return () => {};
      }),
    };

    startEventEmitter(
      {
        browser: mockBrowser as any,
        launcher: mockLauncher as any,
        emitter,
      },
      () => {},
    );

    const targetCreatedSpy = vi.fn();
    emitter.on("targetCreated", targetCreatedSpy);

    const mockTarget = { type: () => "page" };
    mockBrowser.instance.emit("targetcreated", mockTarget);

    expect(targetCreatedSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "targetCreated",
        data: { target: mockTarget },
      }),
    );
  });
});
