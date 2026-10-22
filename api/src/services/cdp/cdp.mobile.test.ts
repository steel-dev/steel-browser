import { describe, expect, test, vi } from "vitest";

import { CDPService } from "./cdp.service.js";

const logger = {
  child: () => logger,
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
};

const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 16; HON-AN00) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36";
const DESKTOP_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";

function fakePage() {
  const send = vi.fn().mockResolvedValue({});
  const detach = vi.fn().mockResolvedValue(undefined);
  const page = {
    createCDPSession: vi.fn().mockResolvedValue({ send, detach }),
    setUserAgent: vi.fn().mockResolvedValue(undefined),
    setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
    evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
    isClosed: vi.fn().mockReturnValue(false),
  };
  return { page, send, detach };
}

function serviceWith(fingerprintData: unknown) {
  const service = new CDPService({}, logger as any);
  Object.assign(service as any, {
    fingerprintData,
    currentSessionConfig: {},
    launchConfig: { userAgent: (fingerprintData as any).fingerprint.navigator.userAgent },
  });
  return service;
}

const mobileFingerprint = {
  fingerprint: {
    navigator: {
      userAgent: MOBILE_UA,
      platform: "Linux armv8l",
      maxTouchPoints: 10,
      userAgentData: {
        brands: [{ brand: "Chromium", version: "155" }],
        fullVersionList: [{ brand: "Chromium", version: "155.0.8059.79" }],
        uaFullVersion: "155.0.8059.79",
        platform: "Android",
        platformVersion: "16.0.0",
        architecture: "",
        bitness: "",
        model: "HON-AN00",
        mobile: true,
      },
    },
    screen: { width: 508, height: 1074, innerWidth: 500, innerHeight: 983, devicePixelRatio: 3 },
  },
  headers: { "accept-language": "es-MX,es;q=0.9", "sec-ch-ua-mobile": "?1" },
};

const desktopFingerprint = {
  fingerprint: {
    navigator: {
      userAgent: DESKTOP_UA,
      platform: "Linux x86_64",
      maxTouchPoints: 0,
      userAgentData: {
        brands: [{ brand: "Chromium", version: "155" }],
        uaFullVersion: "155.0.8059.79",
        platform: "Linux",
        mobile: false,
      },
    },
    screen: { width: 1920, height: 1080, devicePixelRatio: 1 },
  },
  headers: { "accept-language": "en-US,en;q=0.9" },
};

describe("CDPService mobile device emulation", () => {
  test("fits the layout viewport inside the window and enables matching touch input", async () => {
    const service = serviceWith(mobileFingerprint);
    const { page, send, detach } = fakePage();

    await (service as any).applyDeviceMetricsOverride(page);

    expect(send).toHaveBeenNthCalledWith(1, "Page.setDeviceMetricsOverride", {
      screenWidth: 508,
      screenHeight: 1074,
      width: 500,
      height: 983,
      mobile: true,
      screenOrientation: { angle: 0, type: "portraitPrimary" },
      deviceScaleFactor: 3,
    });
    expect(send).toHaveBeenNthCalledWith(2, "Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 10,
    });
    expect(detach).not.toHaveBeenCalled();
  });

  test("keeps one session attached for the page's metrics and user agent overrides", async () => {
    const service = serviceWith(mobileFingerprint);
    const { page, send, detach } = fakePage();

    await (service as any).applyDeviceMetricsOverride(page);
    await (service as any).injectFingerprintSafely(page, mobileFingerprint);

    expect(page.createCDPSession).toHaveBeenCalledOnce();
    expect(detach).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith(
      "Emulation.setUserAgentOverride",
      expect.objectContaining({ userAgent: MOBILE_UA }),
    );
  });

  test("sends coherent Android metadata and keeps navigator.platform separate", async () => {
    const service = serviceWith(mobileFingerprint);
    const { page, send } = fakePage();

    await (service as any).injectFingerprintSafely(page, mobileFingerprint);

    const metadata = {
      brands: [{ brand: "Chromium", version: "155" }],
      fullVersionList: [{ brand: "Chromium", version: "155.0.8059.79" }],
      fullVersion: "155.0.8059.79",
      platform: "Android",
      platformVersion: "16.0.0",
      architecture: "",
      model: "HON-AN00",
      mobile: true,
      bitness: "",
      wow64: false,
      formFactors: ["Mobile"],
    };
    expect(page.setUserAgent).toHaveBeenCalledWith(MOBILE_UA, metadata);
    expect(send).toHaveBeenCalledWith("Emulation.setUserAgentOverride", {
      userAgent: MOBILE_UA,
      acceptLanguage: "es-MX,es",
      platform: "Linux armv8l",
      userAgentMetadata: metadata,
    });

    const script = page.evaluateOnNewDocument.mock.calls[0][0] as string;
    expect(script).toContain('const FIXED_PLATFORM = "Linux armv8l"');
    expect(script).toContain('const FIXED_UA_PLATFORM = "Android"');
    expect(script).toContain("const FIXED_MOBILE = true");
    expect(script).toContain('const FIXED_ARCHITECTURE = ""');
    expect(script).toContain('const FIXED_MODEL = "HON-AN00"');
    expect(script).toContain('const FIXED_PLATFORM_VERSION = "16.0.0"');
  });

  test("takes the form factor from the fingerprint, so an Android tablet reports Desktop", async () => {
    const tablet = structuredClone(mobileFingerprint);
    tablet.fingerprint.navigator.userAgent =
      "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";
    tablet.fingerprint.navigator.userAgentData.mobile = false;
    tablet.fingerprint.navigator.userAgentData.model = "SM-X710";
    const service = serviceWith(tablet);
    const { page, send } = fakePage();

    await (service as any).applyDeviceMetricsOverride(page);
    await (service as any).injectFingerprintSafely(page, tablet);

    expect(send).toHaveBeenCalledWith(
      "Page.setDeviceMetricsOverride",
      expect.objectContaining({ mobile: true }),
    );
    expect(send).toHaveBeenCalledWith("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 10,
    });
    expect(send).toHaveBeenCalledWith(
      "Emulation.setUserAgentOverride",
      expect.objectContaining({
        userAgentMetadata: expect.objectContaining({ mobile: false, formFactors: ["Desktop"] }),
      }),
    );
  });

  test("queues the overrides on puppeteer's own session when a page target appears", () => {
    const service = serviceWith(mobileFingerprint);
    const send = vi.fn().mockResolvedValue({});

    (service as any).queueMobileEmulation({ _session: () => ({ send }) });

    expect(send.mock.calls.map(([method]) => method)).toEqual([
      "Page.setDeviceMetricsOverride",
      "Emulation.setTouchEmulationEnabled",
      "Emulation.setUserAgentOverride",
    ]);
  });

  test("leaves sessions that skip fingerprint injection on short-lived emulation", async () => {
    const service = serviceWith(mobileFingerprint);
    Object.assign((service as any).launchConfig, { skipFingerprintInjection: true });
    const send = vi.fn().mockResolvedValue({});

    (service as any).queueMobileEmulation({ _session: () => ({ send }) });
    expect(send).not.toHaveBeenCalled();

    const { page, detach } = fakePage();
    await (service as any).applyDeviceMetricsOverride(page);
    expect(detach).toHaveBeenCalledOnce();
  });
});

describe("CDPService desktop device emulation", () => {
  test("still applies its overrides on a short-lived session", async () => {
    const service = serviceWith(desktopFingerprint);
    const { page, send, detach } = fakePage();

    await (service as any).applyDeviceMetricsOverride(page);
    await (service as any).injectFingerprintSafely(page, desktopFingerprint);

    expect(page.createCDPSession).toHaveBeenCalledTimes(2);
    expect(detach).toHaveBeenCalledTimes(2);
    expect(page.setUserAgent).toHaveBeenCalledWith(DESKTOP_UA);
    expect(send).toHaveBeenCalledWith(
      "Page.setDeviceMetricsOverride",
      expect.objectContaining({ width: 1920, height: 1080, mobile: false }),
    );
    expect(send).not.toHaveBeenCalledWith("Emulation.setTouchEmulationEnabled", expect.anything());
    expect(send).toHaveBeenCalledWith(
      "Emulation.setUserAgentOverride",
      expect.objectContaining({
        platform: "Linux",
        userAgentMetadata: expect.objectContaining({
          platform: "Linux",
          platformVersion: "",
          architecture: "x86",
          bitness: "64",
          mobile: false,
        }),
      }),
    );

    const script = page.evaluateOnNewDocument.mock.calls[0][0] as string;
    expect(script).toContain('const FIXED_ARCHITECTURE = "x86"');
    expect(script).toContain('const FIXED_PLATFORM_VERSION = "15.0.0"');
  });

  test("queues nothing when a page target appears", () => {
    const service = serviceWith(desktopFingerprint);
    const send = vi.fn().mockResolvedValue({});

    (service as any).queueMobileEmulation({ _session: () => ({ send }) });

    expect(send).not.toHaveBeenCalled();
  });
});
