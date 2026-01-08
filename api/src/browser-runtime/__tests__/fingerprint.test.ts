import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateFingerprint, injectFingerprint } from "../services/fingerprint.service.js";
import { createMockPage } from "./helpers.js";
import { pino } from "pino";

describe("Fingerprint Service", () => {
  const logger = pino({ level: "silent" });

  describe("generateFingerprint", () => {
    it("should generate a desktop fingerprint by default", () => {
      const fingerprint = generateFingerprint({});
      expect(fingerprint).toBeDefined();
      expect(fingerprint.fingerprint.navigator.userAgent).toContain("Chrome");
      expect(fingerprint.fingerprint.screen.width).toBe(1920);
    });

    it("should respect dimensions", () => {
      const fingerprint = generateFingerprint({
        dimensions: { width: 1280, height: 720 },
      });
      expect(fingerprint.fingerprint.screen.width).toBe(1280);
      expect(fingerprint.fingerprint.screen.height).toBe(720);
    });

    it("should generate a mobile fingerprint when requested", () => {
      const fingerprint = generateFingerprint({
        deviceConfig: { device: "mobile" },
      });
      expect(fingerprint.fingerprint.navigator.userAgent).toMatch(/phone|android|mobile/i);
    });
  });

  describe("injectFingerprint", () => {
    let mockPage: any;
    let mockSession: any;

    beforeEach(() => {
      mockSession = {
        send: vi.fn().mockResolvedValue(undefined),
        detach: vi.fn().mockResolvedValue(undefined),
      };
      mockPage = createMockPage();
      mockPage.createCDPSession = vi.fn().mockResolvedValue(mockSession);
      mockPage.setUserAgent = vi.fn().mockResolvedValue(undefined);
      mockPage.setExtraHTTPHeaders = vi.fn().mockResolvedValue(undefined);
    });

    it("should inject fingerprint into page", async () => {
      const fingerprint = generateFingerprint({});
      await injectFingerprint(mockPage, fingerprint, logger);

      expect(mockPage.setUserAgent).toHaveBeenCalledWith(
        fingerprint.fingerprint.navigator.userAgent,
      );
      expect(mockSession.send).toHaveBeenCalledWith(
        "Page.setDeviceMetricsOverride",
        expect.any(Object),
      );
      expect(mockSession.send).toHaveBeenCalledWith(
        "Emulation.setUserAgentOverride",
        expect.any(Object),
      );
      expect(mockPage.evaluateOnNewDocument).toHaveBeenCalled();
    });

    it("should fallback to FingerprintInjector on error", async () => {
      const fingerprint = generateFingerprint({});
      mockPage.createCDPSession.mockRejectedValue(new Error("CDP error"));

      // We don't easily mock FingerprintInjector here as it's a class instantiated inside
      // but we can at least check that it doesn't throw and logs an error
      const errorSpy = vi.spyOn(logger, "error");
      await injectFingerprint(mockPage, fingerprint, logger);
      expect(errorSpy).toHaveBeenCalled();
    });
  });
});
