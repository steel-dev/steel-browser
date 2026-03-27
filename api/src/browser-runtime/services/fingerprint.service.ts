import { Page, Protocol } from "puppeteer-core";
import {
  BrowserFingerprintWithHeaders,
  FingerprintGenerator,
  FingerprintGeneratorOptions,
  VideoCard,
} from "fingerprint-generator";
import { FingerprintInjector } from "fingerprint-injector";
import { FastifyBaseLogger } from "fastify";
import { loadFingerprintScript } from "../../scripts/index.js";
import { filterHeaders } from "../../utils/browser.js";

export interface FingerprintServiceOptions {
  dimensions?: { width: number; height: number } | null;
  deviceConfig?: { device: "desktop" | "mobile" };
  skipFingerprintInjection?: boolean;
}

export function generateFingerprint(
  config: FingerprintServiceOptions,
): BrowserFingerprintWithHeaders {
  let fingerprintOptions: Partial<FingerprintGeneratorOptions> = {
    devices: ["desktop"],
    operatingSystems: ["linux"],
    browsers: [{ name: "chrome", minVersion: 136 }],
    locales: ["en-US", "en"],
    screen: {
      minWidth: config.dimensions?.width ?? 1920,
      minHeight: config.dimensions?.height ?? 1080,
      maxWidth: config.dimensions?.width ?? 1920,
      maxHeight: config.dimensions?.height ?? 1080,
    },
  };

  if (config.deviceConfig?.device === "mobile") {
    fingerprintOptions = {
      devices: ["mobile"],
      locales: ["en-US", "en"],
    };
  }

  const fingerprintGen = new FingerprintGenerator(fingerprintOptions);
  return fingerprintGen.getFingerprint();
}

export async function injectFingerprint(
  page: Page,
  fingerprintData: BrowserFingerprintWithHeaders,
  logger: FastifyBaseLogger,
) {
  try {
    const { fingerprint, headers } = fingerprintData;
    const userAgent = fingerprint.navigator.userAgent;
    const userAgentMetadata = fingerprint.navigator.userAgentData;
    const { screen } = fingerprint;

    await page.setUserAgent(userAgent);

    const session = await page.createCDPSession();

    try {
      await session.send("Page.setDeviceMetricsOverride", {
        screenHeight: screen.height,
        screenWidth: screen.width,
        width: screen.width,
        height: screen.height,
        viewport: {
          width: screen.availWidth,
          height: screen.availHeight,
          scale: 1,
          x: 0,
          y: 0,
        },
        mobile: /phone|android|mobile/i.test(userAgent),
        screenOrientation:
          screen.height > screen.width
            ? { angle: 0, type: "portraitPrimary" }
            : { angle: 90, type: "landscapePrimary" },
        deviceScaleFactor: screen.devicePixelRatio,
      });

      const injectedHeaders = filterHeaders(headers);

      await page.setExtraHTTPHeaders(injectedHeaders);

      await session.send("Emulation.setUserAgentOverride", {
        userAgent: userAgent,
        acceptLanguage: headers["accept-language"],
        platform: fingerprint.navigator.platform || "Linux x86_64",
        userAgentMetadata: {
          brands:
            userAgentMetadata.brands as unknown as Protocol.Emulation.UserAgentMetadata["brands"],
          fullVersionList:
            userAgentMetadata.fullVersionList as unknown as Protocol.Emulation.UserAgentMetadata["fullVersionList"],
          fullVersion: userAgentMetadata.uaFullVersion,
          platform: fingerprint.navigator.platform || "Linux x86_64",
          platformVersion: userAgentMetadata.platformVersion || "",
          architecture: userAgentMetadata.architecture || "x86",
          model: userAgentMetadata.model || "",
          mobile: userAgentMetadata.mobile as unknown as boolean,
          bitness: userAgentMetadata.bitness || "64",
          wow64: false,
        },
      });
    } finally {
      await session.detach().catch(() => {});
    }

    await page.evaluateOnNewDocument(
      loadFingerprintScript({
        fixedPlatform: fingerprint.navigator.platform || "Linux x86_64",
        fixedVendor: (fingerprint.videoCard as VideoCard | null)?.vendor,
        fixedRenderer: (fingerprint.videoCard as VideoCard | null)?.renderer,
        fixedDeviceMemory: fingerprint.navigator.deviceMemory || 8,
        fixedHardwareConcurrency: fingerprint.navigator.hardwareConcurrency || 8,
        fixedArchitecture: userAgentMetadata.architecture || "x86",
        fixedBitness: userAgentMetadata.bitness || "64",
        fixedModel: userAgentMetadata.model || "",
        fixedPlatformVersion: userAgentMetadata.platformVersion || "15.0.0",
        fixedUaFullVersion: userAgentMetadata.uaFullVersion || "131.0.6778.86",
        fixedBrands:
          userAgentMetadata.brands ||
          ([] as unknown as Array<{
            brand: string;
            version: string;
          }>),
      }),
    );
  } catch (error) {
    logger.error(
      { error },
      `[Fingerprint] Error injecting fingerprint safely, falling back to FingerprintInjector`,
    );
    const fingerprintInjector = new FingerprintInjector();
    // @ts-ignore
    await fingerprintInjector.attachFingerprintToPuppeteer(page, fingerprintData);
  }
}
