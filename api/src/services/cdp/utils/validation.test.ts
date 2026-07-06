import { describe, it, expect } from "vitest";
import { isSimilarConfig } from "./validation.js";
import type { BrowserLauncherOptions } from "../../../types/browser.js";

// Minimal valid config — only required field is `options`
const base: BrowserLauncherOptions = { options: {} };

const withCerts = (certs: string[]): BrowserLauncherOptions => ({
  ...base,
  caCertificates: certs,
});

describe("isSimilarConfig", () => {
  describe("missing configs", () => {
    it("returns false when both configs are undefined", async () => {
      expect(await isSimilarConfig(undefined, undefined)).toBe(false);
    });

    it("returns false when current is undefined", async () => {
      expect(await isSimilarConfig(undefined, base)).toBe(false);
    });

    it("returns false when next is undefined", async () => {
      expect(await isSimilarConfig(base, undefined)).toBe(false);
    });
  });

  describe("caCertificates", () => {
    const certA = "-----BEGIN CERTIFICATE-----\nMIIBcert-a\n-----END CERTIFICATE-----";
    const certB = "-----BEGIN CERTIFICATE-----\nMIIBcert-b\n-----END CERTIFICATE-----";

    it("treats both undefined as similar", async () => {
      expect(await isSimilarConfig(base, base)).toBe(true);
    });

    it("treats both empty arrays as similar", async () => {
      expect(await isSimilarConfig(withCerts([]), withCerts([]))).toBe(true);
    });

    it("treats undefined and empty array as similar", async () => {
      expect(await isSimilarConfig(base, withCerts([]))).toBe(true);
      expect(await isSimilarConfig(withCerts([]), base)).toBe(true);
    });

    it("treats identical cert arrays as similar", async () => {
      expect(await isSimilarConfig(withCerts([certA]), withCerts([certA]))).toBe(true);
    });

    it("treats same certs in different order as similar", async () => {
      expect(await isSimilarConfig(withCerts([certA, certB]), withCerts([certB, certA]))).toBe(
        true,
      );
    });

    it("treats different certs as not similar", async () => {
      expect(await isSimilarConfig(withCerts([certA]), withCerts([certB]))).toBe(false);
    });

    it("treats a cert being added as not similar", async () => {
      expect(await isSimilarConfig(base, withCerts([certA]))).toBe(false);
      expect(await isSimilarConfig(withCerts([certA]), base)).toBe(false);
    });

    it("treats a cert being removed as not similar", async () => {
      expect(await isSimilarConfig(withCerts([certA, certB]), withCerts([certA]))).toBe(false);
    });

    it("treats a subset of certs as not similar", async () => {
      expect(await isSimilarConfig(withCerts([certA]), withCerts([certA, certB]))).toBe(false);
    });
  });

  describe("existing fields are unaffected", () => {
    it("headless mismatch is not similar", async () => {
      const headless: BrowserLauncherOptions = { options: { headless: true } };
      const headful: BrowserLauncherOptions = { options: { headless: false } };
      expect(await isSimilarConfig(headless, headful)).toBe(false);
    });

    it("proxy mismatch is not similar", async () => {
      const a: BrowserLauncherOptions = { options: { proxyUrl: "http://proxy-a:3128" } };
      const b: BrowserLauncherOptions = { options: { proxyUrl: "http://proxy-b:3128" } };
      expect(await isSimilarConfig(a, b)).toBe(false);
    });

    it("userAgent mismatch is not similar", async () => {
      const a: BrowserLauncherOptions = { ...base, userAgent: "Mozilla/5.0 (agent-a)" };
      const b: BrowserLauncherOptions = { ...base, userAgent: "Mozilla/5.0 (agent-b)" };
      expect(await isSimilarConfig(a, b)).toBe(false);
    });

    it("matching full config with caCertificates is similar", async () => {
      const certA = "-----BEGIN CERTIFICATE-----\nMIIBcert-a\n-----END CERTIFICATE-----";
      const config: BrowserLauncherOptions = {
        options: { headless: true, proxyUrl: "http://proxy:3128" },
        userAgent: "Mozilla/5.0",
        blockAds: true,
        caCertificates: [certA],
      };
      expect(await isSimilarConfig(config, { ...config })).toBe(true);
    });
  });
});
