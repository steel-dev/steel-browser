import { describe, it, expect, vi, beforeEach } from "vitest";
import { BrowserRuntime } from "./browser-runtime.js";
import puppeteer from "puppeteer-core";
import { createMockBrowserInstance } from "../__tests__/helpers.js";

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
    const mockBrowser = createMockBrowserInstance();
    (puppeteer.launch as any).mockResolvedValue(mockBrowser);

    const runtime = new BrowserRuntime();

    expect(runtime.isRunning()).toBe(false);

    const browserRef = await runtime.start({
      sessionId: "facade-test",
      port: 3000,
      dataPlanePort: 0,
    });

    expect(browserRef).toBeDefined();
    expect(runtime.isRunning()).toBe(true);
    expect(runtime.getState()).toBe("ready");

    await runtime.stop();
    expect(runtime.isRunning()).toBe(false);
    expect(runtime.getState()).toBe("idle");
  });
});
