import { describe, it, expect, vi, beforeEach } from "vitest";
import { startLogger } from "../logger.actor.js";
import { TargetInstrumentationManager } from "../../../../services/cdp/instrumentation/target-manager.js";

vi.mock("../../../../services/cdp/instrumentation/target-manager.js");

describe("LoggerActor", () => {
  let mockBrowser: any;
  let mockInstrumentationLogger: any;
  let mockAppLogger: any;
  let sendBack: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBrowser = {
      instance: {
        on: vi.fn(),
        off: vi.fn(),
        targets: vi.fn().mockReturnValue([]),
      },
    };
    mockInstrumentationLogger = { record: vi.fn() };
    mockAppLogger = { info: vi.fn(), error: vi.fn() };
    sendBack = vi.fn();

    vi.mocked(TargetInstrumentationManager).prototype.attach = vi.fn().mockResolvedValue(undefined);
  });

  it("should initialize target manager and attach to browser events", () => {
    const input = {
      browser: mockBrowser,
      config: { sessionId: "test-session" } as any,
      instrumentationLogger: mockInstrumentationLogger,
      appLogger: mockAppLogger,
    };

    const cleanup = startLogger(input, sendBack);

    expect(TargetInstrumentationManager).toHaveBeenCalledWith(
      mockInstrumentationLogger,
      mockAppLogger,
    );
    expect(mockBrowser.instance.on).toHaveBeenCalledWith("targetcreated", expect.any(Function));

    cleanup();
    expect(mockBrowser.instance.off).toHaveBeenCalledWith("targetcreated", expect.any(Function));
  });

  it("should attach to existing targets on start", () => {
    const mockTarget = {
      type: () => "page",
      url: () => "http://test.com",
      page: vi.fn().mockResolvedValue(null),
    };
    mockBrowser.instance.targets.mockReturnValue([mockTarget]);

    const input = {
      browser: mockBrowser,
      config: { sessionId: "test-session" } as any,
      instrumentationLogger: mockInstrumentationLogger,
      appLogger: mockAppLogger,
    };

    startLogger(input, sendBack);

    const targetManagerInstance = vi.mocked(TargetInstrumentationManager).mock.instances[0];
    expect(targetManagerInstance.attach).toHaveBeenCalledWith(mockTarget, "page");
  });
});
