import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Level } from "level";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ChromeSessionStorageReader } from "./sessionstorage.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "session-storage-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

// Chrome's "Session Storage" LevelDB layout:
//   namespace-<guid>-<origin>  -> map id (ASCII)
//   map-<map id>-<key>         -> value (UTF-16LE)
async function writeSessionStorage(origin: string, mapId: number, items: Record<string, string>) {
  const db = new Level<Buffer, Buffer>(dir, { keyEncoding: "buffer", valueEncoding: "buffer" });
  await db.put(
    Buffer.from(`namespace-0b8f5a4c_2d3e_4f1a_9b6c_7d8e9f0a1b2c-${origin}/`),
    Buffer.from(String(mapId)),
  );
  for (const [key, value] of Object.entries(items)) {
    await db.put(Buffer.from(`map-${mapId}-${key}`), Buffer.from(value, "utf16le"));
  }
  await db.close();
}

describe("ChromeSessionStorageReader", () => {
  it("keeps keys that contain dashes", async () => {
    await writeSessionStorage("https://example.com", 7, {
      "user-id": "42",
      "cart-1": "apple",
      "cart-2": "pear",
      token: "abc",
    });

    const result = await ChromeSessionStorageReader.readSessionStorage(dir);

    expect(result).toEqual({
      "https://example.com": {
        "user-id": "42",
        "cart-1": "apple",
        "cart-2": "pear",
        token: "abc",
      },
    });
  });
});
