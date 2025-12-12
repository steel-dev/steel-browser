import { describe, it, expect, beforeEach, vi } from "vitest";
import { Orchestrator } from "../orchestrator.js";
import { FastifyBaseLogger } from "fastify";
import { InvalidStateError } from "../types.js";

describe("Orchestrator", () => {
  let mockLogger: FastifyBaseLogger;
  let mockBrowser: any;
  let mockPage: any;

  beforeEach(() => {
    mockLogger = {
      child: vi.fn().mockReturnThis(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as any;

    mockPage = {
      url: vi.fn().mockReturnValue("about:blank"),
      close: vi.fn(),
      setRequestInterception: vi.fn(),
      on: vi.fn(),
    };

    mockBrowser = {
      pages: vi.fn().mockResolvedValue([mockPage]),
      close: vi.fn(),
      process: vi.fn().mockReturnValue({ kill: vi.fn() }),
      wsEndpoint: vi.fn().mockReturnValue("ws://localhost:9222"),
      on: vi.fn(),
      off: vi.fn(),
      once: vi.fn(),
    };
  });

  describe("Concurrency Protection", () => {
    it("should serialize concurrent launch calls and return existing browser (idempotent)", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      // Mock the driver's launch method
      const launchOrder: number[] = [];
      let launchCount = 0;

      (orchestrator as any).driver.launch = vi.fn(async () => {
        const myOrder = ++launchCount;
        launchOrder.push(myOrder);
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      // First launch should succeed
      const launch1 = orchestrator.launch({ options: {} });

      // Second launch while first is in progress should wait for first,
      // then return existing browser (idempotent behavior)
      const launch2 = orchestrator.launch({ options: {} });

      const result1 = await launch1;
      expect(result1).toBe(mockBrowser);

      // Second launch should return existing browser (idempotent)
      const result2 = await launch2;
      expect(result2).toBe(mockBrowser);

      // Only one launch should have been attempted
      expect(launchOrder).toEqual([1]);
    });

    it("should serialize startNewSession calls", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      const operations: string[] = [];

      (orchestrator as any).driver.launch = vi.fn(async () => {
        operations.push("launch-start");
        await new Promise((resolve) => setTimeout(resolve, 30));
        operations.push("launch-end");
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      (orchestrator as any).driver.close = vi.fn(async () => {
        operations.push("close-start");
        await new Promise((resolve) => setTimeout(resolve, 20));
        operations.push("close-end");
      });

      // Start two sessions concurrently
      const session1 = orchestrator.startNewSession({ options: {} });
      const session2 = orchestrator.startNewSession({ options: {} });

      await Promise.all([session1, session2]);

      // Operations should be serialized, not interleaved
      // First session: launch-start, launch-end
      // Second session: close-start, close-end (end previous), launch-start, launch-end
      expect(operations[0]).toBe("launch-start");
      expect(operations[1]).toBe("launch-end");
      expect(operations[2]).toBe("close-start");
      expect(operations[3]).toBe("close-end");
      expect(operations[4]).toBe("launch-start");
      expect(operations[5]).toBe("launch-end");
    });

    it("should prevent race condition between endSession and startNewSession", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      const operations: string[] = [];

      (orchestrator as any).driver.launch = vi.fn(async () => {
        operations.push("launch");
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      (orchestrator as any).driver.close = vi.fn(async () => {
        operations.push("close-start");
        await new Promise((resolve) => setTimeout(resolve, 50));
        operations.push("close-end");
      });

      // First, launch a session
      await orchestrator.launch({ options: {} });
      operations.length = 0; // Clear operations

      // Now try to end and start new session concurrently
      const endPromise = orchestrator.endSession();
      const startPromise = orchestrator.startNewSession({ options: {} });

      await Promise.all([endPromise, startPromise]);

      // The operations should be serialized
      // Either end completes first, then start
      // Or start acquires lock first and handles the end internally
      expect(operations.filter((op) => op === "close-start").length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("State Transitions", () => {
    it("should report correct session state", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      (orchestrator as any).driver.close = vi.fn();
      (orchestrator as any).driver.forceClose = vi.fn();

      expect(orchestrator.getSessionState()).toBe("idle");

      await orchestrator.launch({ options: {} });
      expect(orchestrator.getSessionState()).toBe("live");

      await orchestrator.shutdown();
      expect(orchestrator.getSessionState()).toBe("closed");
    });

    it("should return existing browser when launching from live state (idempotent)", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      let launchCount = 0;
      (orchestrator as any).driver.launch = vi.fn(async () => {
        launchCount++;
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      const result1 = await orchestrator.launch({ options: {} });
      expect(result1).toBe(mockBrowser);
      expect(launchCount).toBe(1);

      // Second launch should return existing browser without calling driver.launch again
      const result2 = await orchestrator.launch({ options: {} });
      expect(result2).toBe(mockBrowser);
      expect(launchCount).toBe(1); // Still 1, not 2
    });
  });

  describe("isRunning", () => {
    it("should return false when idle", () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      expect(orchestrator.isRunning()).toBe(false);
    });

    it("should return true when live", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      await orchestrator.launch({ options: {} });
      expect(orchestrator.isRunning()).toBe(true);
    });

    it("should return false after shutdown", async () => {
      const orchestrator = new Orchestrator({
        logger: mockLogger,
        keepAlive: false,
      });

      (orchestrator as any).driver.launch = vi.fn(async () => {
        return { browser: mockBrowser, primaryPage: mockPage };
      });

      (orchestrator as any).driver.close = vi.fn();
      (orchestrator as any).driver.forceClose = vi.fn();

      await orchestrator.launch({ options: {} });
      await orchestrator.shutdown();
      expect(orchestrator.isRunning()).toBe(false);
    });
  });
});
