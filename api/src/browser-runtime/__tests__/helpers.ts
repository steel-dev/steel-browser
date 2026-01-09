import { vi } from "vitest";

export function createMockPage() {
  return {
    evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
    setRequestInterception: vi.fn().mockResolvedValue(undefined),
    emulateMediaFeatures: vi.fn().mockResolvedValue(undefined),
    setUserAgent: vi.fn().mockResolvedValue(undefined),
    setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
    url: vi.fn().mockReturnValue("about:blank"),
    target: vi.fn().mockReturnValue({
      _targetId: "test-target-id",
      createCDPSession: vi.fn().mockResolvedValue({
        send: vi.fn().mockResolvedValue(undefined),
        detach: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    browser: vi.fn().mockReturnValue({
      version: vi.fn().mockResolvedValue("Chrome/120.0.0.0"),
    }),
  };
}

export function createMockBrowserInstance() {
  const page = createMockPage();
  return {
    wsEndpoint: vi.fn().mockReturnValue("ws://localhost:9222"),
    process: vi.fn().mockReturnValue({ pid: 12345 }),
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
    pages: vi.fn().mockResolvedValue([page]),
    targets: vi.fn().mockReturnValue([]),
    version: vi.fn().mockResolvedValue("Chrome/120.0.0.0"),
    userAgent: vi.fn().mockResolvedValue("Mozilla/5.0..."),
  };
}

export function createMockBrowserRef(sessionId: string) {
  const instance = createMockBrowserInstance();
  return {
    id: sessionId,
    instance: instance as any,
    primaryPage: (instance as any).pages()[0] as any,
    pid: 12345,
    wsEndpoint: instance.wsEndpoint(),
    launchedAt: Date.now(),
  };
}
