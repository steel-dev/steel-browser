import { describe, expect, it, vi, beforeEach } from "vitest";

const getFingerprintMock = vi.fn();
const fingerprintCtorCalls: any[] = [];

vi.mock("fingerprint-generator", () => {
  class FingerprintGenerator {
    options: any;
    constructor(options: any) {
      this.options = options;
      fingerprintCtorCalls.push(options);
    }
    getFingerprint() {
      return getFingerprintMock();
    }
  }
  return {
    FingerprintGenerator,
    FingerprintInjector: class {},
    BrowserFingerprintWithHeaders: class {},
    VideoCard: class {},
  };
});

import { CDPService } from "./cdp.service.js";

function createLogger() {
  const logger: any = {
    child: () => logger,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return logger;
}

describe("CDPService fingerprint fallback", () => {
  beforeEach(() => {
    fingerprintCtorCalls.length = 0;
    getFingerprintMock.mockReset();
  });

  it("retries desktop fingerprint generation with relaxed screen bounds", async () => {
    const logger = createLogger();
    const service = new CDPService({ keepAlive: false }, logger as any);

    (service as any).launchConfig = {
      options: {},
      deviceConfig: { device: "desktop" },
      dimensions: { width: 1920, height: 1080 },
      skipFingerprintInjection: false,
    };

    getFingerprintMock
      .mockImplementationOnce(() => {
        throw new Error("no matching fingerprint");
      })
      .mockImplementationOnce(() => ({
        fingerprint: {
          navigator: { userAgent: "ua" },
          screen: { width: 1600, height: 1200 },
        },
      }));

    const fn = async () => {
      let fingerprintOptions: any = {
        devices: ["desktop"],
        operatingSystems: ["linux"],
        browsers: [{ name: "chrome", minVersion: 146 }],
        locales: ["en-US", "en"],
        screen: {
          minWidth: (service as any).launchConfig.dimensions?.width ?? 1920,
          minHeight: (service as any).launchConfig.dimensions?.height ?? 1080,
          maxWidth: (service as any).launchConfig.dimensions?.width ?? 1920,
          maxHeight: (service as any).launchConfig.dimensions?.height ?? 1080,
        },
      };

      const fingerprintGen = new (await import("fingerprint-generator")).FingerprintGenerator(
        fingerprintOptions as any,
      );
      try {
        (service as any).fingerprintData = fingerprintGen.getFingerprint();
      } catch (error) {
        const relaxedFingerprintOptions = {
          ...fingerprintOptions,
          screen: {
            minWidth: (service as any).launchConfig.dimensions?.width ?? 1280,
            minHeight: (service as any).launchConfig.dimensions?.height ?? 720,
          },
        };
        (service as any).fingerprintData = new (
          await import("fingerprint-generator")
        ).FingerprintGenerator(relaxedFingerprintOptions as any).getFingerprint();
      }
    };

    await fn();

    expect(fingerprintCtorCalls).toHaveLength(2);
    expect(fingerprintCtorCalls[0].screen).toEqual({
      minWidth: 1920,
      minHeight: 1080,
      maxWidth: 1920,
      maxHeight: 1080,
    });
    expect(fingerprintCtorCalls[1].screen).toEqual({
      minWidth: 1920,
      minHeight: 1080,
    });
  });
});
