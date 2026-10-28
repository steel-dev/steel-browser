import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import puppeteer from "puppeteer-core";
import WebSocket from "ws";
import { handleCastSession } from "./casting.handler.js";

vi.mock("puppeteer-core", () => ({
  default: {
    connect: vi.fn(),
  },
}));

describe("handleCastSession cleanup", () => {
  let mockDisconnect: ReturnType<typeof vi.fn>;
  let mockBrowser: any;
  let mockPage: any;
  let mockSocket: any;
  let mockWs: any;
  let mockWss: any;
  let mockSessionService: any;
  let upgradePromise: Promise<void> | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    upgradePromise = null;

    mockDisconnect = vi.fn().mockResolvedValue(undefined);

    mockPage = {
      target: () => ({
        _targetId: "existing-page-id-999",
        createCDPSession: vi.fn().mockResolvedValue({
          send: vi.fn().mockResolvedValue(undefined),
          detach: vi.fn().mockResolvedValue(undefined),
          on: vi.fn(),
        }),
      }),
      bringToFront: vi.fn().mockResolvedValue(undefined),
      removeAllListeners: vi.fn(),
      url: () => "http://localhost",
    };

    mockBrowser = {
      pages: vi.fn().mockResolvedValue([mockPage]),
      disconnect: mockDisconnect,
      on: vi.fn(),
    };

    vi.mocked(puppeteer.connect).mockResolvedValue(mockBrowser as any);

    mockSocket = {
      destroy: vi.fn(),
      on: vi.fn(),
    };

    mockWs = new EventEmitter();
    mockWs.readyState = WebSocket.OPEN;
    mockWs.send = vi.fn();
    mockWs.close = vi.fn();
    mockWs.ping = vi.fn();

    mockWss = {
      handleUpgrade: vi.fn((req, socket, head, cb) => {
        upgradePromise = cb(mockWs);
      }),
    };

    mockSessionService = {
      activeSession: Promise.resolve({
        id: "session-abc",
        dimensions: { width: 1920, height: 1080 },
      }),
    };
  });

  it("disconnects the browser when the requested pageId is not found", async () => {
    const mockRequest = {
      url: "/v1/sessions/session-abc/cast?pageId=invalid-nonexistent-page",
    };

    await handleCastSession(
      mockRequest as any,
      mockSocket as any,
      Buffer.alloc(0),
      mockWss as any,
      mockSessionService as any,
      { pageId: "invalid-nonexistent-page" },
    );
    await upgradePromise;

    expect(puppeteer.connect).toHaveBeenCalledTimes(1);
    expect(mockSocket.destroy).toHaveBeenCalledTimes(1);
    expect(mockWs.listenerCount("close")).toBe(0);
    expect(mockWs.listenerCount("error")).toBe(0);
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it("disconnects the browser when the requested pageIndex is out of range", async () => {
    const mockRequest = {
      url: "/v1/sessions/session-abc/cast?pageIndex=99",
    };

    await handleCastSession(
      mockRequest as any,
      mockSocket as any,
      Buffer.alloc(0),
      mockWss as any,
      mockSessionService as any,
      { pageIndex: "99" },
    );
    await upgradePromise;

    expect(puppeteer.connect).toHaveBeenCalledTimes(1);
    expect(mockSocket.destroy).toHaveBeenCalledTimes(1);
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it("disconnects the browser when the cast socket closes", async () => {
    const mockRequest = {
      url: "/v1/sessions/session-abc/cast?pageId=existing-page-id-999",
    };

    await handleCastSession(
      mockRequest as any,
      mockSocket as any,
      Buffer.alloc(0),
      mockWss as any,
      mockSessionService as any,
      { pageId: "existing-page-id-999" },
    );
    await upgradePromise;

    expect(puppeteer.connect).toHaveBeenCalledTimes(1);
    expect(mockWs.listenerCount("close")).toBe(1);

    mockWs.emit("close");

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it("disconnects the browser when the tab discovery socket closes", async () => {
    const mockRequest = {
      url: "/v1/sessions/session-abc/cast?tabInfo=true",
    };

    await handleCastSession(
      mockRequest as any,
      mockSocket as any,
      Buffer.alloc(0),
      mockWss as any,
      mockSessionService as any,
      undefined,
    );
    await upgradePromise;

    expect(puppeteer.connect).toHaveBeenCalledTimes(1);
    expect(mockWs.listenerCount("close")).toBe(1);

    mockWs.emit("close");

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it("disconnects the browser when setup fails", async () => {
    const mockRequest = {
      url: "/v1/sessions/session-abc/cast?pageId=existing-page-id-999",
    };

    mockBrowser.pages.mockRejectedValueOnce(new Error("Unexpected error"));

    await handleCastSession(
      mockRequest as any,
      mockSocket as any,
      Buffer.alloc(0),
      mockWss as any,
      mockSessionService as any,
      { pageId: "existing-page-id-999" },
    );
    await upgradePromise;

    expect(puppeteer.connect).toHaveBeenCalledTimes(1);
    expect(mockSocket.destroy).toHaveBeenCalledTimes(1);
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });
});
