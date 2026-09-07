import type { FastifyBaseLogger } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IProxyServer } from "../utils/proxy.js";
import type { CDPService } from "./cdp/cdp.service.js";
import type { FileService } from "./file.service.js";
import type { SeleniumService } from "./selenium.service.js";
import { SessionService } from "./session.service.js";

const TX_BYTES = 4096;
const RX_BYTES = 8192;

/**
 * Mirrors the accounting of the real ProxyServer: proxy-chain only reports
 * transfer stats through `connectionClosed`, so long-lived CONNECT tunnels
 * contribute nothing until the server is closed.
 */
class FakeProxyServer implements IProxyServer {
  public readonly url = "http://127.0.0.1:1234";
  public txBytes = 0;
  public rxBytes = 0;
  public closeCount = 0;

  constructor(public readonly upstreamProxyUrl: string) {}

  async listen(): Promise<void> {}

  async close(): Promise<void> {
    this.closeCount++;
    this.txBytes += TX_BYTES;
    this.rxBytes += RX_BYTES;
  }
}

const createService = () => {
  const cdpService = {
    getUserAgent: vi.fn().mockReturnValue("test-user-agent"),
    getDimensions: vi.fn().mockReturnValue({ width: 1920, height: 1080 }),
    startNewSession: vi.fn().mockResolvedValue(undefined),
    endSession: vi.fn().mockResolvedValue(undefined),
    launch: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
  } as unknown as CDPService;

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as FastifyBaseLogger;

  return new SessionService({
    cdpService,
    seleniumService: { close: vi.fn() } as unknown as SeleniumService,
    fileService: {} as unknown as FileService,
    logger,
  });
};

const startProxiedSession = async (service: SessionService) => {
  const proxies: FakeProxyServer[] = [];
  service.setProxyFactory((proxyUrl) => {
    const proxy = new FakeProxyServer(proxyUrl);
    proxies.push(proxy);
    return proxy;
  });

  await service.startSession({
    proxyUrl: "http://user:pass@proxy.example.com:8080",
    timezone: "UTC",
    credentials: undefined,
  });

  return proxies;
};

describe("SessionService.endSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports proxy byte counters tallied after the proxy server is closed", async () => {
    const service = createService();
    const [proxy] = await startProxiedSession(service);

    // Counters are still empty while the session is live, exactly as in production.
    expect(service.activeSession.proxyTxBytes).toBe(0);
    expect(service.activeSession.proxyRxBytes).toBe(0);

    const released = await service.endSession();

    expect(proxy.closeCount).toBe(1);
    expect(released.proxyTxBytes).toBe(TX_BYTES);
    expect(released.proxyRxBytes).toBe(RX_BYTES);
  });

  it("keeps the tallied counters on the archived past session", async () => {
    const service = createService();
    await startProxiedSession(service);

    await service.endSession();

    expect(service.pastSessions).toHaveLength(1);
    expect(service.pastSessions[0].proxyTxBytes).toBe(TX_BYTES);
    expect(service.pastSessions[0].proxyRxBytes).toBe(RX_BYTES);
  });

  it("reports zero for a session that ran without a proxy", async () => {
    const service = createService();
    await service.startSession({ timezone: "UTC", credentials: undefined });

    const released = await service.endSession();

    expect(released.proxyTxBytes).toBe(0);
    expect(released.proxyRxBytes).toBe(0);
  });
});
