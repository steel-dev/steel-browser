import fs from "fs/promises";
import path from "path";
import os from "os";
import { Level } from "level";
import iconv from "iconv-lite";
import { fileTypeFromBuffer } from "file-type";
import { copyDirectory } from "../../utils/leveldb.js";

/**
 * Decode a UTF-16LE string
 */
function decodeUTF16LE(raw: Buffer): string {
  try {
    return iconv.decode(raw, "utf16-le");
  } catch (err: unknown) {
    throw new Error(`Failed to decode UTF-16-LE: ${err}`);
  }
}

export interface SessionStorageRecord {
  mapId: number;
  origin: string;
  key: string;
  charset: string;
  decoded: string;
  mime?: string;
  conversions?: string[];
  jsonType?: string;
  value?: unknown;
}

export class SessionStoreDb {
  private db: Level<Buffer, Buffer>;
  public records: SessionStorageRecord[] = [];
  private mapIdToOrigin: Map<number, string> = new Map();

  private constructor(db: Level<Buffer, Buffer>) {
    this.db = db;
  }

  public static async open(dir: string): Promise<SessionStoreDb> {
    try {
      const db = new Level<Buffer, Buffer>(dir, {
        createIfMissing: false,
        keyEncoding: "buffer",
        valueEncoding: "buffer",
      } as any);
      // wait until open
      await db.open();
      return new SessionStoreDb(db);
    } catch (err) {
      // Attempt fallback: copy to temp directory and open there
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chrome-leveldb-"));
      await copyDirectory(dir, tmpDir);
      const db = new Level<Buffer, Buffer>(tmpDir, {
        createIfMissing: false,
        keyEncoding: "buffer",
        valueEncoding: "buffer",
      } as any);
      await db.open();
      return new SessionStoreDb(db);
    }
  }

  /**
   * Load namespace records to map from mapId to origin (hostname)
   */
  private async loadNamespaceRecords(): Promise<void> {
    const NAMESPACE_PREFIX = Buffer.from("namespace-");

    for await (const [keyBuf, valueBuf] of this.db.iterator() as any) {
      const key: Buffer = keyBuf as Buffer;
      const value: Buffer = valueBuf as Buffer;

      if (key.indexOf(NAMESPACE_PREFIX) === 0) {
        const keyStr = key.toString();
        // Format: "namespace-<uuid>-<hostname>"
        const parts = keyStr.split("-");
        if (parts.length < 3) continue;

        // Get hostname from the remaining parts (in case hostname contains dashes)
        const hostname = parts.slice(2).join("-").replace(/\/$/, "");

        // Get map-id value
        const mapId = parseInt(value.toString(), 10);
        if (isNaN(mapId)) continue;

        this.mapIdToOrigin.set(mapId, hostname);
      }
    }
  }

  public async load(): Promise<void> {
    // First load namespace records to build mapId to origin mapping
    await this.loadNamespaceRecords();

    const MAP_PREFIX = Buffer.from("map-");

    for await (const [keyBuf, valueBuf] of this.db.iterator() as any) {
      const key: Buffer = keyBuf as Buffer;
      const value: Buffer = valueBuf as Buffer;

      if (key.indexOf(MAP_PREFIX) === 0) {
        const withoutPrefix = key.subarray(MAP_PREFIX.length);
        const parts = withoutPrefix.toString().split("-", 2);

        if (parts.length !== 2) continue;

        const mapId = parseInt(parts[0], 10);
        if (isNaN(mapId)) continue;

        const keyStr = parts[1];
        let valueDecoded: string;

        try {
          valueDecoded = decodeUTF16LE(value);
        } catch {
          continue;
        }

        // Look up the origin from the mapId
        const origin = this.mapIdToOrigin.get(mapId) || "unknown-origin";

        this.records.push({
          mapId,
          origin,
          key: keyStr,
          charset: "UTF-16-LE",
          decoded: valueDecoded,
        });
      }
    }
  }

  public close(): void {
    // @ts-ignore types mismatch but close exists
    if (this.db.status === "open") this.db.close().catch(() => {});
  }
}

/**
 * Process a session storage record to add metadata about its content
 */
export function processSessionRecord(record: SessionStorageRecord): SessionStorageRecord {
  const result = { ...record };
  const buffer = Buffer.from(record.decoded);
  let mime = "application/octet-stream";
  const conversions: string[] = [];
  let jsonType = "";
  let value: unknown = null;

  // Try to parse as JSON
  try {
    value = JSON.parse(record.decoded);
    mime = "application/json";

    if (value === null) {
      jsonType = "null";
    } else if (Array.isArray(value)) {
      jsonType = "array";
    } else if (typeof value === "object") {
      jsonType = "object";
    } else if (typeof value === "string") {
      jsonType = "string";
    } else if (typeof value === "number") {
      jsonType = "number";
    } else if (typeof value === "boolean") {
      jsonType = "boolean";
    }
  } catch {
    // Not valid JSON, try to determine file type
    try {
      const quoted = JSON.stringify(record.decoded);
      if (JSON.parse(quoted)) {
        value = quoted;
        mime = "text/plain";
        conversions.push("JSON.stringify");
      }
    } catch {
      const b64 = buffer.toString("base64");
      value = JSON.stringify(b64);
      conversions.push("buffer.toString('base64')");
      conversions.push("JSON.stringify");

      // Try to detect MIME type
      fileTypeFromBuffer(buffer)
        .then((type) => {
          if (type) {
            result.mime = type.mime;
          }
        })
        .catch(() => {});
    }
  }

  result.mime = mime;
  result.conversions = conversions;
  result.jsonType = jsonType;
  result.value = value;

  return result;
}

export class ChromeSessionStorageReader {
  /**
   * Reads a Chrome Session Storage LevelDB directory and returns a nested record of items
   * grouped by origin (hostname).
   */
  public static async readSessionStorage(dir: string): Promise<Record<string, Record<string, string>>> {
    const sdb = await SessionStoreDb.open(dir);
    try {
      await sdb.load();
      const result: Record<string, Record<string, string>> = {};

      for (const rec of sdb.records) {
        if (!result[rec.origin]) {
          result[rec.origin] = {};
        }
        result[rec.origin][rec.key] = rec.decoded;
      }

      return result;
    } finally {
      sdb.close();
    }
  }
}
