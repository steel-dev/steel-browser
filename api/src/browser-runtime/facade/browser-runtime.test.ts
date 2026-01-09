import { describe, it, expect, vi, beforeEach } from "vitest";
import { BrowserRuntime } from "./browser-runtime.js";
import puppeteer from "puppeteer-core";
import { createMockBrowserInstance } from "../__tests__/helpers.js";
import { pino } from "pino";

vi.mock("puppeteer-core", () => ({
  default: {
    launch: vi.fn(),
  },
}));

vi.mock("../actors/timezone.js", () => ({
  fetchTimezone: vi.fn().mockResolvedValue("UTC"),
}));

describe("BrowserRuntime Facade", () => {
  const mockLogger = pino({ level: "silent" });
  const mockInstrumentationLogger = { record: vi.fn(), on: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should start and stop the browser", async () => {
    const mockBrowser = createMockBrowserInstance();
    (puppeteer.launch as any).mockResolvedValue(mockBrowser);

    const runtime = new BrowserRuntime({
      appLogger: mockLogger,
      instrumentationLogger: mockInstrumentationLogger as any,
    });

    expect(runtime.isRunning()).toBe(false);

    const browserRef = await runtime.start({
      sessionId: "facade-test",
      port: 3000,
      dataPlanePort: 0,
    });

    expect(browserRef).toBeDefined();
    expect(runtime.isRunning()).toBe(true);
    expect(runtime.getState()).toContain("ready");

    await runtime.stop();
    expect(runtime.isRunning()).toBe(false);
    expect(runtime.getState()).toBe("idle");
  });
});
