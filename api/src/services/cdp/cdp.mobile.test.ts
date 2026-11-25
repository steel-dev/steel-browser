import type { BrowserFingerprintWithHeaders } from "fingerprint-generator";
import type { Target } from "puppeteer-core";
import { describe, expect, test, vi } from "vitest";

import { loadFingerprintScript } from "../../scripts/index.js";
import { FingerprintTargetSetup } from "./fingerprint/target-setup.js";

vi.mock("../../scripts/index.js", () => ({
  loadFingerprintScript: vi.fn(() => "page-script"),
  loadWorkerFingerprintScript: vi.fn(() => "worker-script"),
}));

const logger = { debug: vi.fn(), error: vi.fn(), warn: vi.fn() };

const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Mobile Safari/537.36";
const DESKTOP_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";

const mobileFingerprint = {
  fingerprint: {
    navigator: {
      userAgent: MOBILE_UA,
      platform: "Linux armv8l",
      maxTouchPoints: 10,
      hardwareConcurrency: 8,
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
      hardwareConcurrency: 8,
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

function applyToNewPage(fingerprint: unknown, screenFromLaunchFlags = true) {
  const send = vi.fn().mockResolvedValue({});
  const createCDPSession = vi.fn();
  const target = {
    _session: () => ({ send }),
    _getTargetInfo: () => ({ type: "page", url: "" }),
    type: () => "page",
    url: () => "",
    createCDPSession,
  } as unknown as Target;
  new FingerprintTargetSetup({
    fingerprintData: fingerprint as BrowserFingerprintWithHeaders,
    screenFromLaunchFlags,
    logger,
  }).targetFilter(target);
  return { send, createCDPSession };
}

describe("CDPService mobile device emulation", () => {
  test("fits the layout viewport inside the window and enables matching touch input", () => {
    const { send } = applyToNewPage(mobileFingerprint);

    expect(send).toHaveBeenCalledWith("Emulation.setDeviceMetricsOverride", {
      screenWidth: 508,
      screenHeight: 1074,
      width: 500,
      height: 983,
      mobile: true,
      screenOrientation: { angle: 0, type: "portraitPrimary" },
      deviceScaleFactor: 3,
    });
    expect(send).toHaveBeenCalledWith("Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 10,
    });
  });

  test("keeps the page's metrics and user agent overrides on Puppeteer's own session", () => {
    const { send, createCDPSession } = applyToNewPage(mobileFingerprint);

    // Puppeteer never detaches its page session, so nothing resets the emulation (#330).
    expect(createCDPSession).not.toHaveBeenCalled();
    expect(send.mock.calls.map(([method]) => method)).toEqual([
      "Emulation.setUserAgentOverride",
      "Emulation.setHardwareConcurrencyOverride",
      "Emulation.setDeviceMetricsOverride",
      "Emulation.setTouchEmulationEnabled",
      "Page.addScriptToEvaluateOnNewDocument",
    ]);
  });

  test("sends coherent Android metadata and keeps navigator.platform separate", () => {
    const { send } = applyToNewPage(mobileFingerprint);

    expect(send).toHaveBeenCalledWith("Emulation.setUserAgentOverride", {
      userAgent: MOBILE_UA,
      acceptLanguage: "es-MX,es",
      platform: "Linux armv8l",
      userAgentMetadata: {
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
      },
    });
    expect(vi.mocked(loadFingerprintScript)).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fixedPlatform: "Linux armv8l",
        fixedUaPlatform: "Android",
        fixedMobile: true,
        fixedArchitecture: "",
        fixedModel: "HON-AN00",
        fixedPlatformVersion: "16.0.0",
      }),
    );
  });

  test("takes the form factor from the fingerprint, so an Android tablet reports Desktop", () => {
    const tablet = structuredClone(mobileFingerprint);
    tablet.fingerprint.navigator.userAgent =
      "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";
    tablet.fingerprint.navigator.userAgentData.mobile = false;
    tablet.fingerprint.navigator.userAgentData.model = "SM-X710";

    const { send } = applyToNewPage(tablet);

    expect(send).toHaveBeenCalledWith(
      "Emulation.setDeviceMetricsOverride",
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
});

describe("CDPService desktop device emulation", () => {
  test("sends native desktop UA metadata and leaves the viewport to the window", () => {
    const { send } = applyToNewPage(desktopFingerprint);

    expect(send).toHaveBeenCalledWith(
      "Emulation.setUserAgentOverride",
      expect.objectContaining({
        userAgent: DESKTOP_UA,
        platform: "Linux x86_64",
        userAgentMetadata: expect.objectContaining({
          platform: "Linux",
          platformVersion: "",
          architecture: "x86",
          bitness: "64",
          mobile: false,
          formFactors: ["Desktop"],
        }),
      }),
    );
    // Headless gets the screen from --screen-info; a 1x desktop needs no metrics override.
    expect(send).not.toHaveBeenCalledWith("Emulation.setDeviceMetricsOverride", expect.anything());
    expect(send).not.toHaveBeenCalledWith("Emulation.setTouchEmulationEnabled", expect.anything());
    expect(vi.mocked(loadFingerprintScript)).toHaveBeenLastCalledWith(
      expect.objectContaining({ fixedArchitecture: "x86", fixedPlatformVersion: "" }),
    );
  });

  test("overrides only the screen of a headful desktop page", () => {
    const { send } = applyToNewPage(desktopFingerprint, false);

    expect(send).toHaveBeenCalledWith("Emulation.setDeviceMetricsOverride", {
      width: 0,
      height: 0,
      mobile: false,
      deviceScaleFactor: 1,
      screenWidth: 1920,
      screenHeight: 1080,
    });
  });
});
