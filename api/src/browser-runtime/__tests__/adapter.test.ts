import { describe, it, expect, vi, beforeEach } from "vitest";
import { XStateAdapter } from "../adapter.js";
import { BrowserRuntime as XStateRuntime } from "../index.js";
import { ChromeContextService } from "../../services/context/chrome-context.service.js";
import { extractStorageForPage } from "../../utils/context.js";
import { pino } from "pino";

vi.mock("../index.js");
vi.mock("../../services/context/chrome-context.service.js");
vi.mock("../../utils/context.js");

describe("XStateAdapter", () => {
  let runtime: any;
  let adapter: XStateAdapter;
  let logger: any;

  beforeEach(() => {
    vi.clearAllMocks();
    runtime = {
      on: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      endSession: vi.fn(),
      getBrowser: vi.fn(),
      isRunning: vi.fn(),
      registerPlugin: vi.fn(),
      getStateTransitionLogger: vi.fn(),
    };
    logger = pino({ level: "silent" });
    const mockInstrumentationLogger = {
      on: vi.fn(),
      record: vi.fn(),
    };
    adapter = new XStateAdapter(runtime, logger, mockInstrumentationLogger as any);
  });

  it("should return instrumentation logger", () => {
    const instrumentationLogger = adapter.getInstrumentationLogger();
    expect(instrumentationLogger).toBeDefined();
    expect(typeof instrumentationLogger?.record).toBe("function");
  });

  it("should return session context when getSessionContext is called", async () => {
    const sessionContext = { cookies: [{ name: "test", value: "val" }] as any };
    runtime.getBrowser.mockReturnValue(null);
    (runtime.start as any).mockResolvedValue({
      instance: {
        once: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        process: vi.fn().mockReturnValue({ pid: 12345 }),
        wsEndpoint: vi.fn().mockReturnValue("ws://localhost:9222"),
        isConnected: vi.fn().mockReturnValue(true),
      },
    });

    await adapter.launch({
      options: { headless: true },
      sessionContext,
    } as any);

    expect(adapter.getSessionContext()).toEqual(sessionContext);
  });

  it("should extract browser state using all methods", async () => {
    const userDataDir = "/tmp/test-user-data";
    const mockPage = {
      url: () => "https://example.com",
      createCDPSession: vi.fn().mockResolvedValue({
        send: vi.fn().mockResolvedValue({ cookies: [{ name: "c1", value: "v1" }] }),
        detach: vi.fn(),
      }),
      target: () => ({}),
    };
    const mockBrowser = {
      pages: vi.fn().mockResolvedValue([mockPage]),
      once: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      isConnected: vi.fn().mockReturnValue(true),
      process: vi.fn().mockReturnValue({ pid: 12345 }),
      wsEndpoint: vi.fn().mockReturnValue("ws://localhost:9222"),
    };

    runtime.getBrowser.mockReturnValueOnce(null);
    (runtime.start as any).mockResolvedValue({ instance: mockBrowser });
    runtime.getBrowser.mockReturnValue({
      instance: mockBrowser,
      primaryPage: mockPage,
      sessionId: "test-session",
    });

    // Mock ChromeContextService
    const mockSessionData = { localStorage: { "disk.com": { k: "v" } } };
    (ChromeContextService.prototype.getSessionData as any).mockResolvedValue(mockSessionData);

    // Mock extractStorageForPage
    const mockPageData = { localStorage: { "example.com": { key: "val" } } };
    (extractStorageForPage as any).mockResolvedValue(mockPageData);

    await adapter.launch({
      options: { headless: true },
      userDataDir,
    } as any);

    const state = await adapter.getBrowserState();

    expect(state.cookies).toEqual([{ name: "c1", value: "v1" }]);
    expect(state.localStorage).toEqual({
      "disk.com": { k: "v" },
      "example.com": { key: "val" },
    });
    expect(ChromeContextService.prototype.getSessionData).toHaveBeenCalledWith(userDataDir);
  });

  it("should call runtime.endSession during endSession", async () => {
    runtime.getBrowser.mockReturnValue(null);
    (runtime.start as any).mockResolvedValue({
      instance: {
        once: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
        process: vi.fn().mockReturnValue({ pid: 12345 }),
        wsEndpoint: vi.fn().mockReturnValue("ws://localhost:9222"),
        isConnected: vi.fn().mockReturnValue(true),
      },
    });

    await adapter.launch({ options: { headless: true } } as any);
    await adapter.endSession();

    expect(runtime.endSession).toHaveBeenCalled();
  });
});
