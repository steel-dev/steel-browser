import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { RollingFileStorage } from "../storage/rolling-file-storage.js";
import { BrowserEventType } from "../../types/enums.js";

describe("RollingFileStorage", () => {
  const testDir = path.join(os.tmpdir(), "steel-test-logs-" + Date.now());
  const prefix = "test-transitions";

  beforeEach(async () => {
    if (fs.existsSync(testDir)) {
      await fs.promises.rm(testDir, { recursive: true });
    }
  });

  afterEach(async () => {
    if (fs.existsSync(testDir)) {
      await fs.promises.rm(testDir, { recursive: true });
    }
  });

  it("should initialize the directory", async () => {
    const storage = new RollingFileStorage({
      directory: testDir,
      filenamePrefix: prefix,
      maxFileSizeBytes: 1024,
      maxFiles: 3,
    });

    await storage.initialize();
    expect(fs.existsSync(testDir)).toBe(true);
  });

  it("should write logs to a file", async () => {
    const storage = new RollingFileStorage({
      directory: testDir,
      filenamePrefix: prefix,
      maxFileSizeBytes: 1024,
      maxFiles: 3,
    });

    await storage.initialize();
    const event = {
      type: BrowserEventType.StateTransition,
      timestamp: new Date().toISOString(),
      sessionId: "test-sess",
      fromState: "idle",
      toState: "ready",
      event: "START",
    } as any;

    await storage.write(event, { foo: "bar" });

    const files = fs.readdirSync(testDir);
    expect(files.length).toBe(1);
    expect(files[0]).toBe(`${prefix}-0.ndjson`);

    const content = fs.readFileSync(path.join(testDir, files[0]), "utf8");
    const parsed = JSON.parse(content);
    expect(parsed.sessionId).toBe("test-sess");
    expect(parsed.foo).toBe("bar");
  });

  it("should rotate files when max size is exceeded", async () => {
    const storage = new RollingFileStorage({
      directory: testDir,
      filenamePrefix: prefix,
      maxFileSizeBytes: 50, // Very small for testing
      maxFiles: 3,
    });

    await storage.initialize();
    const event = {
      type: BrowserEventType.StateTransition,
      timestamp: "...",
      sessionId: "1",
      fromState: "a",
      toState: "b",
      event: "e",
    } as any;

    // Write multiple times to trigger rotation
    await storage.write(event, {});
    await storage.write(event, {});
    await storage.write(event, {});

    const files = fs.readdirSync(testDir);
    expect(files.length).toBeGreaterThan(1);
  });

  it("should cleanup old files", async () => {
    const storage = new RollingFileStorage({
      directory: testDir,
      filenamePrefix: prefix,
      maxFileSizeBytes: 20, // Tiny
      maxFiles: 2,
    });

    await storage.initialize();
    const event = { type: "test" } as any;

    // Write enough to trigger 3 rotations
    for (let i = 0; i < 10; i++) {
      await storage.write(event, { i });
    }

    const files = fs.readdirSync(testDir);
    expect(files.length).toBeLessThanOrEqual(2);
  });
});
