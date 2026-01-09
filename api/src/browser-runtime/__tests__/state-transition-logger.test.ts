import { describe, it, expect, vi, beforeEach } from "vitest";
import { StateTransitionLogger } from "../logging/state-transition-logger.js";
import { BrowserEventType } from "../../types/enums.js";

describe("StateTransitionLogger", () => {
  let mockLogger: any;
  let mockStorage: any;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
    };
    mockStorage = {
      write: vi.fn().mockResolvedValue(undefined),
      flush: vi.fn().mockResolvedValue(undefined),
    };
  });

  it("should record transitions and call storage/logger", async () => {
    const logger = new StateTransitionLogger({
      baseLogger: mockLogger,
      storage: mockStorage,
      enableConsoleLogging: true,
      sessionId: "test-session",
    });

    logger.recordTransition({
      fromState: "idle",
      toState: "booting",
      event: "START",
      context: { foo: "bar" },
    });

    expect(mockLogger.info).toHaveBeenCalled();
    expect(mockStorage.write).toHaveBeenCalledWith(
      expect.objectContaining({
        type: BrowserEventType.StateTransition,
        sessionId: "test-session",
        fromState: "idle",
        toState: "booting",
        event: "START",
        context: { foo: "bar" },
      }),
      {},
    );
  });

  it("should update session ID", () => {
    const logger = new StateTransitionLogger({
      baseLogger: mockLogger,
      storage: mockStorage,
      sessionId: "initial",
    });

    logger.setSessionId("updated");
    logger.recordTransition({ fromState: null, toState: "idle", event: "INIT" });

    expect(mockStorage.write).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "updated",
      }),
      {},
    );
  });
});
