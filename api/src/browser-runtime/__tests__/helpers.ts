import { vi } from "vitest";

export function createMockPage() {
  return {
    evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
    setRequestInterception: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
    url: vi.fn().mockReturnValue("about:blank"),
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
    pages: vi.fn().mockResolvedValue([page]),
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
