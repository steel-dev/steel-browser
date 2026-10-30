import { EventEmitter } from "events";
import type { FastifyBaseLogger } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, spawn: spawnMock };
});

import { SeleniumService } from "./selenium.service.js";

interface FakeChildProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
}

function fakeChildProcess(): FakeChildProcess {
  const child = new EventEmitter() as FakeChildProcess;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

const logger = {
  info: vi.fn(),
  error: vi.fn(),
} as unknown as FastifyBaseLogger;

function nextTick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("SeleniumService.launch", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("rejects instead of crashing when the java binary cannot be spawned", async () => {
    const child = fakeChildProcess();
    spawnMock.mockReturnValue(child);
    const service = new SeleniumService(logger);

    const launch = service.launch({} as never);
    await nextTick();

    child.emit("error", Object.assign(new Error("spawn java ENOENT"), { code: "ENOENT" }));

    await expect(launch).rejects.toThrow(
      "Failed to start the Selenium server: spawn java ENOENT"
    );
  });

  it("resolves once the server reports it started", async () => {
    const child = fakeChildProcess();
    spawnMock.mockReturnValue(child);
    const service = new SeleniumService(logger);

    const launch = service.launch({} as never);
    await nextTick();

    child.stdout.emit("data", Buffer.from("Started Selenium Standalone on port 4444\n"));

    await expect(launch).resolves.toBeUndefined();
  });
});
