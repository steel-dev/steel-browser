import { describe, it, expect, vi } from "vitest";
import { createBrowserLogger } from "./browser-logger.js";
import { BrowserEventType } from "../../../types/enums.js";

describe("BrowserLogger", () => {
  it("should merge context into events", () => {
    const mockLog = vi.fn();
    const baseLogger = {
      info: mockLog,
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
      silent: vi.fn(),
      child: vi.fn(),
      level: "info",
    };

    const logger = createBrowserLogger({
      baseLogger: baseLogger as any,
      initialContext: { sessionId: "test-session", orgId: "test-org" },
    });

    logger.record({
      type: BrowserEventType.Console,
      timestamp: "2025-01-01T00:00:00Z",
      console: { level: "log", text: "test message" },
    });

    expect(mockLog).toHaveBeenCalledWith(
      {
        sessionId: "test-session",
        orgId: "test-org",
        type: BrowserEventType.Console,
        timestamp: "2025-01-01T00:00:00Z",
        console: { level: "log", text: "test message" },
      },
      BrowserEventType.Console,
    );
  });

  it("should allow dynamic context updates", () => {
    const mockLog = vi.fn();
    const baseLogger = {
      info: mockLog,
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
      silent: vi.fn(),
      child: vi.fn(),
      level: "info",
    };

    const logger = createBrowserLogger({
      baseLogger: baseLogger as any,
      initialContext: { sessionId: "session-1" },
    });

    logger.setContext({ orgId: "org-1" });

    expect(logger.getContext()).toEqual({
      sessionId: "session-1",
      orgId: "org-1",
    });

    logger.record({
      type: BrowserEventType.Navigation,
      timestamp: "2025-01-01T00:00:00Z",
      navigation: { url: "https://example.com" },
    });

    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        orgId: "org-1",
        type: BrowserEventType.Navigation,
      }),
      BrowserEventType.Navigation,
    );
  });

  it("should support functional context updates", () => {
    const mockLog = vi.fn();
    const baseLogger = {
      info: mockLog,
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
      silent: vi.fn(),
      child: vi.fn(),
      level: "info",
    };

    const logger = createBrowserLogger({
      baseLogger: baseLogger as any,
      initialContext: { count: 0 },
    });

    logger.setContext((prev) => ({ count: (prev.count as number) + 1 }));
    expect(logger.getContext()).toEqual({ count: 1 });

    logger.setContext((prev) => ({ count: (prev.count as number) + 1 }));
    expect(logger.getContext()).toEqual({ count: 2 });
  });

  it("should prioritize event fields over context fields", () => {
    const mockLog = vi.fn();
    const baseLogger = {
      info: mockLog,
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
      silent: vi.fn(),
      child: vi.fn(),
      level: "info",
    };

    const logger = createBrowserLogger({
      baseLogger: baseLogger as any,
      initialContext: { type: "wrong-type", pageId: "context-page" },
    });

    logger.record({
      type: BrowserEventType.Request,
      timestamp: "2025-01-01T00:00:00Z",
      pageId: "event-page",
      request: { method: "GET", url: "https://example.com" },
    });

    expect(mockLog).toHaveBeenCalledWith(
      expect.objectContaining({
        type: BrowserEventType.Request,
        pageId: "event-page",
      }),
      BrowserEventType.Request,
    );
  });
});
