import fs from "fs/promises";
import path from "path";
import os from "os";
import { Level } from "level";
import iconv from "iconv-lite";
import { copyDirectory } from "../../utils/leveldb.js";

/**
 * Decode a Chrome-encoded string.
 *  - 0x00 prefix => UTF‑16‑LE encoded string
 *  - 0x01 prefix => ISO‑8859‑1 encoded string
 */
function decodeString(raw: Buffer): { value: string; charset: string } {
  if (!raw || raw.length === 0) {
    throw new Error("Cannot decode empty buffer");
  }

  const prefix = raw[0];
  const payload = raw.subarray(1);

  if (prefix === 0) {
    try {
      const decoded = iconv.decode(payload, "utf16-le");
      return { value: decoded, charset: "UTF-16-LE" };
    } catch (err: unknown) {
      throw new Error(`Failed to decode UTF-16-LE: ${err}`);
    }
  } else if (prefix === 1) {
    return { value: payload.toString("latin1"), charset: "ISO-8859-1" };
  }

  throw new Error(`Unknown string encoding prefix: ${prefix}`);
}

export interface StorageMetadata {
  storageKey: string;
  timestamp: Date;
  size: number;
}

export interface LocalStorageRecord {
  storageKey: string;
  scriptKey: string;
  charset: string;
  decoded: string;
  mime?: string;
  conversions?: string[];
  jsonType?: string;
  value?: unknown;
}

export class LocalStoreDb {
  private db: Level<Buffer, Buffer>;
  private tmpDir: string | null;
  public records: LocalStorageRecord[] = [];

  private constructor(db: Level<Buffer, Buffer>, tmpDir: string | null = null) {
    this.db = db;
    this.tmpDir = tmpDir;
  }

  public static async open(dir: string): Promise<LocalStoreDb> {
    try {
      const db = new Level<Buffer, Buffer>(dir, {
        createIfMissing: false,
        keyEncoding: "buffer",
        valueEncoding: "buffer",
      } as any);
      // wait until open
      await db.open();
      return new LocalStoreDb(db);
    } catch (err) {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chrome-leveldb-"));
      try {
        await copyDirectory(dir, tmpDir);
        const db = new Level<Buffer, Buffer>(tmpDir, {
          createIfMissing: false,
          keyEncoding: "buffer",
          valueEncoding: "buffer",
        } as any);
        await db.open();
        return new LocalStoreDb(db, tmpDir);
      } catch (copyErr) {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        throw copyErr;
      }
    }
  }

  public async load(): Promise<void> {
    const META_PREFIX = Buffer.from("META:");
    const RECORD_PREFIX = Buffer.from("_");

    for await (const [keyBuf, valueBuf] of this.db.iterator() as any) {
      const key: Buffer = keyBuf as Buffer;
      const value: Buffer = valueBuf as Buffer;

      if (key[0] === RECORD_PREFIX[0]) {
        // Remove prefix
        const withoutPrefix = key.subarray(1);
        const nullIndex = withoutPrefix.indexOf(0);
        if (nullIndex === -1) continue;

        const storageKeyBytes = withoutPrefix.subarray(0, nullIndex);
        const scriptKeyBytes = withoutPrefix.subarray(nullIndex + 1);

        const storageKey = storageKeyBytes.toString();
        let scriptKeyDecoded: { value: string; charset: string };
        let valueDecoded: { value: string; charset: string };
        try {
          scriptKeyDecoded = decodeString(scriptKeyBytes);
          valueDecoded = decodeString(valueBuf);
        } catch {
          continue;
        }

        this.records.push({
          storageKey,
          scriptKey: scriptKeyDecoded.value,
          charset: valueDecoded.charset,
          decoded: valueDecoded.value,
        });
      }
    }
  }

  public async close(): Promise<void> {
    // @ts-ignore types mismatch but close exists
    if (this.db.status === "open") await this.db.close().catch(() => {});
    if (this.tmpDir) {
      const tmpDir = this.tmpDir;
      this.tmpDir = null;
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export class ChromeLocalStorageReader {
  /**
   * Reads a Chrome Local Storage LevelDB directory and returns a nested record of items
   * grouped by domain / storage key.
   */
  public static async readLocalStorage(
    dir: string,
  ): Promise<Record<string, Record<string, string>>> {
    const ldb = await LocalStoreDb.open(dir);
    try {
      await ldb.load();
      const result: Record<string, Record<string, string>> = {};
      for (const rec of ldb.records) {
        if (!result[rec.storageKey]) {
          result[rec.storageKey] = {};
        }
        result[rec.storageKey][rec.scriptKey] = rec.decoded;
      }
      return result;
    } finally {
      await ldb.close();
    }
  }
}
