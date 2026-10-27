import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import puppeteer from "puppeteer-core";
import { handleCastSession } from "./casting.handler.js";

vi.mock("puppeteer-core", () => ({
  default: {
    connect: vi.fn(),
  },
}));

describe("Candidate 4 MRE: handleCastSession CDP connection leak on invalid target page", () => {
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
    mockWs.readyState = 1; // WebSocket.OPEN
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

  it("properly disconnects browser when requested pageId is not found", async () => {
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

    // 1. Verify puppeteer.connect was called and connected
    expect(puppeteer.connect).toHaveBeenCalledTimes(1);

    // 2. Verify socket.destroy was called because target was not found
    expect(mockSocket.destroy).toHaveBeenCalledTimes(1);

    // 3. Verify that ws close/error listeners were NOT attached because function returned early
    expect(mockWs.listenerCount("close")).toBe(0);
    expect(mockWs.listenerCount("error")).toBe(0);

    // 4. REGRESSION VERIFICATION: browser.disconnect() was called via handleSessionCleanup()
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it("properly disconnects browser when requested pageIndex is out of bounds", async () => {
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

  it("CONTROL 1: properly disconnects browser when target page is found and websocket closes", async () => {
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

    // Simulate websocket close
    mockWs.emit("close");

    // In valid target flow, browser.disconnect() is called on close
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it("CONTROL 2: properly disconnects browser in tabDiscoveryMode when websocket closes", async () => {
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

    // Simulate websocket close
    mockWs.emit("close");

    // In tab discovery mode, browser.disconnect() is called on close
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it("CONTROL 3: properly disconnects browser when an unexpected error is thrown in handleUpgrade", async () => {
    const mockRequest = {
      url: "/v1/sessions/session-abc/cast?pageId=existing-page-id-999",
    };

    // Make browser.pages() reject to trigger catch(err)
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

    // In catch(err) block, handleSessionCleanup() is called!
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });
});
