import { describe, expect, it, vi } from "vitest";

import { DuckDBStorage } from "./duckdb-storage.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function bufferedEvent(timestamp: string) {
  return {
    event: { type: "Console", timestamp, message: "test" },
    context: {},
  };
}

describe("DuckDBStorage flush barrier", () => {
  it("waits for an active flush and drains events appended while it runs", async () => {
    const firstFlush = deferred();
    const storage = new DuckDBStorage();
    const internals = storage as any;
    internals.db = {};
    internals.writeBuffer = [bufferedEvent("2026-07-23T00:00:00.000Z")];
    internals.writeBatchInternal = vi
      .fn()
      .mockImplementationOnce(async () => firstFlush.promise)
      .mockResolvedValueOnce(undefined);

    const firstBarrier = storage.flush();
    await Promise.resolve();
    internals.writeBuffer.push(bufferedEvent("2026-07-23T00:00:01.000Z"));
    const secondBarrier = storage.flush();

    firstFlush.resolve();
    await Promise.all([firstBarrier, secondBarrier]);

    expect(internals.writeBatchInternal).toHaveBeenCalledTimes(2);
    expect(internals.writeBuffer).toEqual([]);
    expect(internals.flushPromise).toBeNull();
  });
});
