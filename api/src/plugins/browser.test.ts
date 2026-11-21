import Fastify from "fastify";
import { Database } from "duckdb-async";
import { afterEach, expect, it, vi } from "vitest";
import type { SteelBrowserConfig } from "../steel-browser-plugin.js";
import { BrowserEventType } from "../types/enums.js";
import browserInstancePlugin from "./browser.js";

afterEach(() => vi.restoreAllMocks());

it.each([
  { overrides: {}, threads: "1", memory: "128MB", batch: 200, interval: 2000 },
  {
    overrides: {
      maxThreads: 2,
      memoryLimit: "96MB",
      writeBufferSize: 3,
      writeBufferFlushInterval: 500,
    },
    threads: "2",
    memory: "96MB",
    batch: 3,
    interval: 500,
  },
])(
  "forwards storage configuration with defaults of one thread and 128 MB ($memory)",
  async ({ overrides, threads, memory, batch, interval }) => {
    const fastify = Fastify();
    const create = vi.spyOn(Database, "create");
    const timer = vi.spyOn(globalThis, "setInterval");
    const config: SteelBrowserConfig = {
      logging: { enableStorage: true, storagePath: ":memory:", ...overrides },
    };
    fastify.decorate("steelBrowserConfig", config);
    await fastify.register(browserInstancePlugin);
    await fastify.ready();
    const store = fastify.cdpService.getInstrumentationLogger().getStorage?.();
    try {
      expect(create).toHaveBeenCalledWith(
        ":memory:",
        expect.objectContaining({ threads, memory_limit: memory }),
      );
      expect(timer).toHaveBeenCalledWith(expect.any(Function), interval);
      const event = {
        type: BrowserEventType.Recording as const,
        timestamp: new Date(0).toISOString(),
        data: "",
      };
      await store!.writeBatch(Array.from({ length: batch - 1 }, () => ({ event, context: {} })));
      expect((await store!.getStats()).totalEvents).toBe(0);
      await store!.write(event, {});
      expect((await store!.getStats()).totalEvents).toBe(batch);
    } finally {
      await store?.close();
      await fastify.close();
    }
  },
);
