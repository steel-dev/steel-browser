import { Database } from "duckdb-async";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserEventType } from "../../../../types/enums.js";
import { DuckDBStorage, type DuckDBStorageOptions } from "./duckdb-storage.js";

const eventAt = (index: number, data = "") => ({
  event: {
    type: BrowserEventType.Recording as const,
    timestamp: new Date(index).toISOString(),
    pageId: "page",
    data,
  },
  context: { index },
});

function interceptInserts(onInsert: (bindCount: number) => void | Promise<void>) {
  const run = Database.prototype.run;
  return vi.spyOn(Database.prototype, "run").mockImplementation(async function (
    this: Database,
    sql,
    ...params
  ) {
    if (sql.includes("INSERT INTO browser_events")) await onInsert(params.length);
    return run.call(this, sql, ...params);
  });
}

let storage: DuckDBStorage | undefined;
let directory: string | undefined;

async function openStorage(options?: DuckDBStorageOptions) {
  storage = new DuckDBStorage(options);
  await storage.initialize();
  return storage;
}

afterEach(async () => {
  vi.restoreAllMocks();
  try {
    await storage?.close();
  } finally {
    vi.useRealTimers();
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = undefined;
    storage = undefined;
  }
});

describe("DuckDB instrumentation storage", () => {
  it("retries the failed chunk and keeps earlier commits exactly once", async () => {
    const store = await openStorage({ writeBufferSize: 2 });
    const failure = new Error("synthetic native allocation failure");
    const insert = vi
      .fn()
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw failure;
      });
    interceptInserts(insert);
    const records = Array.from({ length: 5 }, (_, i) => eventAt(i));

    await expect(store.writeBatch(records)).rejects.toBe(failure);
    expect(store.getBufferStats().bufferedEvents).toBe(3);
    expect((await store.getStats()).totalEvents).toBe(2);
    expect(insert.mock.calls).toEqual([[14], [14]]);

    await store.flush();
    const result = await store.query({ limit: 10 });
    expect(result.events).toEqual(
      records.toReversed().map(({ event, context }) => ({
        ...event,
        ...context,
      })),
    );
    expect(store.getBufferStats().bufferedEvents).toBe(0);
  });

  it("backs off on persistent failures, then drains when the timer sees recovery", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
    const store = await openStorage({ writeBufferSize: 2, writeBufferFlushInterval: 1000 });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("synthetic storage unavailable");
    const insert = vi.fn<(bindCount: number) => void>(() => {
      throw failure;
    });
    interceptInserts(insert);

    await expect(store.writeBatch([eventAt(0), eventAt(1)])).rejects.toBe(failure);
    await store.writeBatch(Array.from({ length: 10 }, (_, i) => eventAt(i + 2)));
    await vi.advanceTimersByTimeAsync(1999);
    expect(insert.mock.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(insert.mock.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(3999);
    expect(insert.mock.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(insert.mock.calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(54_000);
    expect(insert.mock.calls).toEqual(Array.from({ length: 6 }, () => [14]));
    expect(errors).toHaveBeenCalledTimes(5);
    expect(store.getBufferStats().bufferedEvents).toBe(12);

    insert.mockImplementation(() => {});
    await vi.advanceTimersByTimeAsync(30_000);
    expect(insert.mock.calls.length).toBeGreaterThan(6);
    await store.flush();
    expect((await store.getStats()).totalEvents).toBe(12);
    expect(store.getBufferStats().bufferedEvents).toBe(0);
    await store.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits for an active insert and keeps writes accepted after clear was requested", async () => {
    const store = await openStorage({ writeBufferSize: 1 });
    const started = Promise.withResolvers<void>();
    const proceed = Promise.withResolvers<void>();
    const insert = vi.fn().mockImplementationOnce(async () => {
      started.resolve();
      await proceed.promise;
    });
    interceptInserts(insert);

    const first = store.writeBatch([eventAt(0)]);
    await started.promise;
    const clear = store.clear({ vacuum: true });
    await store.writeBatch([eventAt(1)]);
    const flush = store.flush();
    expect(insert).toHaveBeenCalledTimes(1);
    proceed.resolve();
    await Promise.all([first, clear, flush]);
    expect(insert.mock.calls).toEqual([[7], [7]]);
    expect((await store.query({})).events).toEqual([
      { ...eventAt(1).event, ...eventAt(1).context },
    ]);
  });

  it("leaves logs and timer available for recovery if clear or close cannot flush", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
    const store = await openStorage({ writeBufferSize: 2 });
    await store.writeBatch([eventAt(0), eventAt(1)]);
    await store.writeBatch([eventAt(2)]);
    const failure = new Error("synthetic storage unavailable");
    const dbRun = interceptInserts(() => {
      throw failure;
    });

    await expect(store.clear()).rejects.toBe(failure);
    await expect(store.close()).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(1);
    expect((await store.getStats()).totalEvents).toBe(2);
    expect(store.getBufferStats().bufferedEvents).toBe(1);
    expect(dbRun.mock.calls.some(([sql]) => sql.includes("DELETE") || sql.includes("VACUUM"))).toBe(
      false,
    );

    dbRun.mockRestore();
    await store.flush();
    expect((await store.getStats()).totalEvents).toBe(3);
    await store.clear({ vacuum: true });
    expect((await store.getStats()).totalEvents).toBe(0);
    await store.close();
    await expect(store.writeBatch([eventAt(3)])).rejects.toThrow("Database not initialized");
  });

  it("bounds bind arguments in a large batch even with a high configured threshold", async () => {
    const store = await openStorage({ writeBufferSize: 1500 });
    const insert = vi.fn();
    interceptInserts(insert);
    await store.writeBatch(Array.from({ length: 1500 }, (_, i) => eventAt(i)));
    expect(insert.mock.calls).toEqual([[7000], [3500]]);
    expect((await store.getStats()).totalEvents).toBe(1500);
  });

  it("splits UTF-8 payloads, preserves oversized recordings, and exports the existing schema", async () => {
    directory = await mkdtemp(join(tmpdir(), "steel-duckdb-test-"));
    const dbPath = join(directory, "logs.duckdb");
    const out = join(directory, "logs.parquet");
    const options = {
      dbPath,
      memoryLimit: "128MB",
      maxThreads: 1,
      parquetCompression: "none",
    } as const;
    const store = await openStorage(options);
    const medium = "é".repeat(2 * 1024 * 1024 + 1);
    const large = "x".repeat(8 * 1024 * 1024 + 1);
    const insert = vi.fn();
    interceptInserts(insert);
    await store.writeBatch([eventAt(0, medium), eventAt(1, medium), eventAt(2, large)]);
    await store.close();
    expect(insert.mock.calls).toEqual([[7], [7], [7]]);

    await store.initialize();
    await store.exportToParquet(out);
    const reader = await Database.create(":memory:");
    try {
      const rows = await reader.all("SELECT * FROM read_parquet(?) ORDER BY timestamp", out);
      expect(Object.keys(rows[0])).toEqual([
        "id",
        "timestamp",
        "event_type",
        "target_type",
        "page_id",
        "data",
        "context",
        "indexed_at",
      ]);
      expect(rows.map(({ data }) => JSON.parse(data).data === large)).toEqual([false, false, true]);
      expect(rows.slice(0, 2).every(({ data }) => JSON.parse(data).data === medium)).toBe(true);
      expect(rows.map(({ context }) => JSON.parse(context))).toEqual([
        { index: 0 },
        { index: 1 },
        { index: 2 },
      ]);
    } finally {
      await reader.close();
    }
  });

  it("persists direct writes when buffering is disabled", async () => {
    const store = await openStorage({ enableWriteBuffer: false });
    const first = eventAt(0);
    await store.write(first.event, first.context);
    await store.writeBatch([eventAt(1), eventAt(2)]);
    expect((await store.getStats()).totalEvents).toBe(3);
    expect(store.getBufferStats()).toEqual({ bufferedEvents: 0, isBufferingEnabled: false });
  });

  it("rejects invalid batching settings before a timer can start", () => {
    expect(() => new DuckDBStorage({ writeBufferSize: 0 })).toThrow("writeBufferSize");
    expect(() => new DuckDBStorage({ writeBufferFlushInterval: 2 ** 31 })).toThrow(
      "writeBufferFlushInterval",
    );
  });
});
