import { describe, it, expect, vi, beforeEach } from "vitest";
import { BrowserRuntime } from "./browser-runtime.js";
import puppeteer from "puppeteer-core";

vi.mock("puppeteer-core", () => ({
  default: {
    launch: vi.fn(),
  },
}));

vi.mock("../actors/timezone.js", () => ({
  fetchTimezone: vi.fn().mockResolvedValue("UTC"),
}));

describe("BrowserRuntime Facade", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should start and stop the browser", async () => {
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

    const runtime = new BrowserRuntime();

    expect(runtime.isRunning()).toBe(false);

    const browserRef = await runtime.start({
      sessionId: "facade-test",
      port: 9222,
    });

    expect(browserRef).toBeDefined();
    expect(runtime.isRunning()).toBe(true);
    expect(runtime.getState()).toBe("ready");

    await runtime.stop();
    expect(runtime.isRunning()).toBe(false);
    expect(runtime.getState()).toBe("idle");
  });
});
