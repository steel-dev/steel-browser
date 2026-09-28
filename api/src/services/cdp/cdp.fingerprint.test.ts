import { describe, expect, test, vi } from "vitest";

import { filterHeaders } from "../../utils/browser.js";
import { CDPService } from "./cdp.service.js";

const logger = {
  child: () => logger,
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
};

const poolHeaders = {
  "sec-ch-ua": '"Not;A=Brand";v="8", "Chromium";v="150", "Google Chrome";v="150"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Linux"',
  "upgrade-insecure-requests": "1",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/150.0.0.0 Safari/537.36",
  accept: "text/html",
  "accept-encoding": "gzip, deflate, br, zstd",
  "accept-language": "en-US,en;q=0.9",
};

function makePage() {
  const send = vi.fn().mockResolvedValue({});
  return {
    send,
    page: {
      setUserAgent: vi.fn().mockResolvedValue(undefined),
      setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
      evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
      createCDPSession: vi
        .fn()
        .mockResolvedValue({ send, detach: vi.fn().mockResolvedValue(undefined) }),
      isClosed: () => false,
    },
  };
}

const fingerprintData = (headers: Record<string, string>) => ({
  headers,
  fingerprint: {
    navigator: {
      userAgent: poolHeaders["user-agent"],
      platform: "Linux x86_64",
      userAgentData: {
        brands: [{ brand: "Chromium", version: "150" }],
        fullVersionList: [{ brand: "Chromium", version: "150.0.7871.46" }],
        uaFullVersion: "150.0.7871.46",
        platform: "Linux",
        mobile: false,
      },
    },
    videoCard: null,
  },
});

describe("filterHeaders", () => {
  test("drops headers owned by the UA override", () => {
    expect(filterHeaders({ ...poolHeaders, "x-custom": "1" })).toEqual({ "x-custom": "1" });
  });
});

describe("CDPService.injectFingerprintSafely", () => {
  test("leaves UA headers to setUserAgentOverride", async () => {
    const service = new CDPService({}, logger as any);
    const { page, send } = makePage();

    await (service as any).injectFingerprintSafely(page, fingerprintData(poolHeaders));

    expect(page.setExtraHTTPHeaders).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      "Emulation.setUserAgentOverride",
      expect.objectContaining({
        acceptLanguage: "en-US,en;q=0.9",
        userAgentMetadata: expect.objectContaining({ platformVersion: "" }),
      }),
    );
  });

  test("keeps custom headers when fingerprint headers remain", async () => {
    const service = new CDPService({}, logger as any);
    Object.assign(service as any, { launchConfig: { customHeaders: { "x-custom": "mine" } } });
    const { page } = makePage();

    await (service as any).injectFingerprintSafely(
      page,
      fingerprintData({ ...poolHeaders, "x-custom": "pool", dnt: "1" }),
    );

    expect(page.setExtraHTTPHeaders).toHaveBeenCalledWith(
      expect.objectContaining({ "x-custom": "mine", dnt: "1" }),
    );
  });
});
