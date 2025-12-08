import { describe, it, expect, beforeEach, vi } from "vitest";
import { BrowserDriver } from "../browser-driver.js";
import { FastifyBaseLogger } from "fastify";

// Mock puppeteer
vi.mock("puppeteer-core", () => ({
  default: {
    launch: vi.fn(),
  },
}));

describe("BrowserDriver", () => {
  let driver: BrowserDriver;
  let mockLogger: FastifyBaseLogger;

  beforeEach(() => {
    mockLogger = {
      child: vi.fn().mockReturnThis(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as any;

    driver = new BrowserDriver({ logger: mockLogger });
  });

  describe("emitFileProtocolViolation", () => {
    it("should emit fileProtocolViolation event", () => {
      const listener = vi.fn();
      driver.on("event", listener);

      driver.emitFileProtocolViolation("file:///etc/passwd");

      expect(listener).toHaveBeenCalledWith({
        type: "fileProtocolViolation",
        data: { url: "file:///etc/passwd" },
        timestamp: expect.any(Number),
      });
    });
  });

  describe("getBrowser", () => {
    it("should return null initially", () => {
      expect(driver.getBrowser()).toBeNull();
    });
  });

  describe("getPrimaryPage", () => {
    it("should return null initially", () => {
      expect(driver.getPrimaryPage()).toBeNull();
    });
  });

  describe("close", () => {
    it("should handle close when browser is null", async () => {
      await expect(driver.close()).resolves.not.toThrow();
    });
  });
});
