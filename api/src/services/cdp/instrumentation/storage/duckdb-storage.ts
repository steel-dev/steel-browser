import { Database } from "duckdb-async";
import path from "path";
import fs from "fs/promises";
import { LogStorage, LogQuery, LogQueryResult } from "./log-storage.interface.js";
import { BrowserEventUnion } from "../types.js";
import { randomUUID } from "crypto";
import { safeStringify } from "./safe-json.js";

export type ParquetCompression = "zstd" | "snappy" | "gzip" | "none";

export interface DuckDBStorageOptions {
  /**
   * Path to the database file. If not provided, uses in-memory database.
   */
  dbPath?: string;
  /**
   * Maximum number of threads DuckDB can use. Defaults to 2.
   * Set to 1 for minimal CPU impact.
   */
  maxThreads?: number;
  /**
   * Memory limit for DuckDB (e.g., "256MB", "1GB"). Defaults to "256MB".
   */
  memoryLimit?: string;
  /**
   * Parquet compression algorithm. Defaults to "snappy" (fast, lower CPU).
   * - "snappy": Fast compression, moderate size (recommended for CPU efficiency)
   * - "zstd": Best compression ratio, higher CPU
   * - "gzip": Good compression, moderate CPU
   * - "none": No compression, fastest but largest files
   */
  parquetCompression?: ParquetCompression;
  /**
   * Enable automatic write buffering. When enabled, writes are batched
   * and flushed periodically to reduce CPU spikes. Defaults to true.
   */
  enableWriteBuffer?: boolean;
  /**
   * Size of write buffer before auto-flush. Defaults to 100 events.
   */
  writeBufferSize?: number;
  /**
   * Interval in ms to flush write buffer. Defaults to 1000ms.
   */
  writeBufferFlushInterval?: number;
}

// Bound both native bind arguments and serialized payload per INSERT. Allow a
// single large event through intact, since truncation would change log content.
const MAX_WRITE_ROWS = 1000;
const INSERT_ROWS_SQL = `
  INSERT INTO browser_events (id, timestamp, event_type, target_type, page_id, data, context, indexed_at)
  SELECT r.id, r.timestamp::TIMESTAMP, r.event_type, r.target_type, r.page_id, r.data, r.context, CURRENT_TIMESTAMP
  FROM (
    SELECT unnest(from_json(?::JSON, '[{"id":"VARCHAR","timestamp":"VARCHAR","event_type":"VARCHAR","target_type":"VARCHAR","page_id":"VARCHAR","data":"VARCHAR","context":"VARCHAR"}]')) AS r
  )
`;

interface InsertRow {
  id: string;
  timestamp: string;
  event_type: string;
  target_type: string | null;
  page_id: string | null;
  data: string;
  context: string;
}
const MAX_WRITE_PAYLOAD_BYTES = 8 * 1024 * 1024;
const MAX_RETRY_DELAY_MS = 30_000;

type PendingWrite = { event: BrowserEventUnion; context: Record<string, any> };

export class DuckDBStorage implements LogStorage {
  private db: Database | null = null;
  private dbPath: string;
  private maxThreads: number;
  private memoryLimit: string;
  private parquetCompression: ParquetCompression;

  // Keep each entry until its INSERT commits. An ordered set lets us release
  // committed entries without shifting or copying the remaining backlog.
  private writeBuffer = new Set<PendingWrite>();
  private committedWrites = 0;
  private writeBufferEnabled: boolean;
  private writeBufferSize: number;
  private writeBufferFlushInterval: number;
  private flushTimer: NodeJS.Timeout | null = null;
  private writeOperation: Promise<void> | null = null;
  private retryDelay = 0;
  private retryAt = 0;

  constructor(options: DuckDBStorageOptions = {}) {
    this.dbPath = options.dbPath || ":memory:";
    this.maxThreads = options.maxThreads ?? 2;
    this.memoryLimit = options.memoryLimit ?? "256MB";
    this.parquetCompression = options.parquetCompression ?? "snappy";
    this.writeBufferEnabled = options.enableWriteBuffer ?? true;
    this.writeBufferSize = options.writeBufferSize ?? 100;
    this.writeBufferFlushInterval = options.writeBufferFlushInterval ?? 1000;

    if (!Number.isSafeInteger(this.writeBufferSize) || this.writeBufferSize < 1) {
      throw new RangeError("writeBufferSize must be a positive integer");
    }
    if (
      !Number.isInteger(this.writeBufferFlushInterval) ||
      this.writeBufferFlushInterval < 1 ||
      this.writeBufferFlushInterval > 2_147_483_647
    ) {
      throw new RangeError("writeBufferFlushInterval must be between 1 and 2147483647 ms");
    }
  }

  initialize(): Promise<void> {
    return this.runWriteOperation(async () => {
      if (this.db) return;

      const db = await Database.create(this.dbPath, {
        threads: String(this.maxThreads),
        memory_limit: this.memoryLimit,
      });
      try {
        await db.run(`
          CREATE TABLE IF NOT EXISTS browser_events (
            id VARCHAR PRIMARY KEY,
            timestamp TIMESTAMP NOT NULL,
            event_type VARCHAR NOT NULL,
            target_type VARCHAR,
            page_id VARCHAR,
            data JSON NOT NULL,
            context JSON NOT NULL,
            indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        await db.run("CREATE INDEX IF NOT EXISTS idx_timestamp ON browser_events(timestamp)");
        await db.run("CREATE INDEX IF NOT EXISTS idx_event_type ON browser_events(event_type)");
        await db.run("CREATE INDEX IF NOT EXISTS idx_page_id ON browser_events(page_id)");
      } catch (err) {
        await db.close().catch((closeError) => {
          console.error("Error closing DuckDB after initialization failure:", closeError);
        });
        throw err;
      }

      this.db = db;
      console.log(`DuckDB initialized: threads=${this.maxThreads}, memory=${this.memoryLimit}`);
      if (this.writeBufferEnabled) {
        this.flushTimer = setInterval(() => {
          this.autoFlush().catch((err) => {
            console.error("DuckDB flush error:", err);
          });
        }, this.writeBufferFlushInterval);
        this.flushTimer.unref();
      }
    });
  }

  private async autoFlush(): Promise<void> {
    if (this.writeOperation || !this.writeBuffer.size || performance.now() < this.retryAt) return;
    await this.flush();
  }

  private runWriteOperation(run: () => Promise<void>): Promise<void> {
    // A previous caller receives its own error. Allow later explicit operations
    // to retry, while automatic flushes respect the cooldown.
    const previous = this.writeOperation?.catch(() => {}) ?? Promise.resolve();
    const operation = previous.then(run).finally(() => {
      if (this.writeOperation === operation) this.writeOperation = null;
    });
    this.writeOperation = operation;
    return operation;
  }

  private async drainWrites(db: Database, through: number): Promise<void> {
    if (this.committedWrites >= through) return;

    try {
      while (this.committedWrites < through) {
        const count = Math.min(
          through - this.committedWrites,
          this.writeBufferSize,
          MAX_WRITE_ROWS,
        );
        const batch = Array.from(this.writeBuffer.values().take(count));
        const inserted = await this.writeChunk(db, batch);
        for (let i = 0; i < inserted; i++) this.writeBuffer.delete(batch[i]);
        this.committedWrites += inserted;
      }
      this.retryDelay = 0;
      this.retryAt = 0;
    } catch (err) {
      const interval = this.writeBufferFlushInterval;
      this.retryDelay = Math.min(
        Math.max(MAX_RETRY_DELAY_MS, interval),
        (this.retryDelay || interval) * 2,
      );
      this.retryAt = performance.now() + this.retryDelay;
      throw err;
    }
  }

  async write(event: BrowserEventUnion, context: Record<string, any>): Promise<void> {
    await this.writeBatch([{ event, context }]);
  }

  async writeBatch(events: PendingWrite[]): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");
    if (!events.length) return;

    if (this.writeBufferEnabled) {
      for (const { event, context } of events) this.writeBuffer.add({ event, context });
      if (this.writeBuffer.size >= this.writeBufferSize) await this.autoFlush();
      return;
    }

    await this.runWriteOperation(async () => {
      const db = this.requireDatabase();
      for (let offset = 0; offset < events.length;) {
        offset += await this.writeChunk(db, events, offset);
      }
    });
  }

  private requireDatabase(): Database {
    if (!this.db) throw new Error("Database not initialized");
    return this.db;
  }

  private async writeChunk(db: Database, events: PendingWrite[], offset = 0): Promise<number> {
    const rows: InsertRow[] = [];
    let payloadBytes = 0;

    for (let i = offset; i < Math.min(offset + MAX_WRITE_ROWS, events.length); i++) {
      const { event, context } = events[i];
      const data = safeStringify(event);
      const contextJson = safeStringify(context);
      const bytes = Buffer.byteLength(data) + Buffer.byteLength(contextJson);
      if (rows.length && payloadBytes + bytes > MAX_WRITE_PAYLOAD_BYTES) break;

      payloadBytes += bytes;
      rows.push({
        id: randomUUID(),
        timestamp: event.timestamp,
        event_type: event.type,
        target_type: event.targetType || null,
        page_id: event.pageId || null,
        data,
        context: contextJson,
      });
    }

    await db.run(INSERT_ROWS_SQL, JSON.stringify(rows));
    return rows.length;
  }

  async flush(): Promise<void> {
    const through = this.committedWrites + this.writeBuffer.size;
    await this.runWriteOperation(async () => {
      if (this.db) await this.drainWrites(this.db, through);
    });
  }

  async query(query: LogQuery): Promise<LogQueryResult> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }

    const conditions: string[] = [];
    const params: any[] = [];

    if (query.startTime) {
      conditions.push("timestamp >= ?");
      params.push(query.startTime.toISOString());
    }

    if (query.endTime) {
      conditions.push("timestamp <= ?");
      params.push(query.endTime.toISOString());
    }

    if (query.eventTypes && query.eventTypes.length > 0) {
      conditions.push(`event_type IN (${query.eventTypes.map(() => "?").join(", ")})`);
      params.push(...query.eventTypes);
    }

    if (query.pageId) {
      conditions.push("page_id = ?");
      params.push(query.pageId);
    }

    if (query.targetType) {
      conditions.push("target_type = ?");
      params.push(query.targetType);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = query.limit || 100;
    const offset = query.offset || 0;

    const countQuery = `SELECT COUNT(*) as total FROM browser_events ${whereClause}`;
    const countResult = await this.db.all(countQuery, ...params);
    // COUNT(*) may come back as a BigInt from DuckDB bindings – coerce safely for JSON
    const total = Number(countResult[0]?.total ?? 0);

    const eventsQuery = `
      SELECT data, context
      FROM browser_events
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `;
    const rows = await this.db.all(eventsQuery, ...params, limit, offset);

    const events: BrowserEventUnion[] = rows.map((row: any) => {
      const data = JSON.parse(row.data);
      const context = JSON.parse(row.context);
      return { ...data, ...context };
    });

    return {
      events,
      total,
      hasMore: offset + limit < total,
    };
  }

  supportsParquetExport(): boolean {
    return true;
  }

  async exportToParquet(filePath: string, query?: LogQuery): Promise<string> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }

    // Build WHERE clause if query is provided
    let whereClause = "";
    const params: any[] = [];

    if (query) {
      const conditions: string[] = [];

      if (query.startTime) {
        conditions.push("timestamp >= ?");
        params.push(query.startTime.toISOString());
      }

      if (query.endTime) {
        conditions.push("timestamp <= ?");
        params.push(query.endTime.toISOString());
      }

      if (query.eventTypes && query.eventTypes.length > 0) {
        conditions.push(`event_type IN (${query.eventTypes.map(() => "?").join(", ")})`);
        params.push(...query.eventTypes);
      }

      if (query.pageId) {
        conditions.push("page_id = ?");
        params.push(query.pageId);
      }

      if (query.targetType) {
        conditions.push("target_type = ?");
        params.push(query.targetType);
      }

      whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    }

    // Ensure output directory exists
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // Export to Parquet with configurable compression
    const sanitizedPath = filePath.replace(/'/g, "''");
    const compressionClause =
      this.parquetCompression === "none"
        ? ""
        : `, COMPRESSION ${this.parquetCompression.toUpperCase()}`;
    const exportQuery = `
      COPY (
        SELECT * FROM browser_events ${whereClause}
      ) TO '${sanitizedPath}' (FORMAT PARQUET${compressionClause})
    `;

    await this.db.run(exportQuery);

    return filePath;
  }

  async getStats(): Promise<{
    totalEvents: number;
    oldestEvent: Date | null;
    newestEvent: Date | null;
    sizeBytes: number;
  }> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }

    const result = await this.db.all(`
      SELECT
        COUNT(*) as total,
        MIN(timestamp) as oldest,
        MAX(timestamp) as newest
      FROM browser_events
    `);

    const row = result[0];
    let sizeBytes = 0;

    // Get file size if using file-based storage
    if (this.dbPath !== ":memory:") {
      const stats = await fs.stat(this.dbPath);
      sizeBytes = stats.size;
    }

    return {
      totalEvents: Number(row?.total ?? 0),
      oldestEvent: row?.oldest ? new Date(row.oldest) : null,
      newestEvent: row?.newest ? new Date(row.newest) : null,
      sizeBytes,
    };
  }

  async clear(options: { vacuum?: boolean } = {}): Promise<void> {
    const through = this.committedWrites + this.writeBuffer.size;
    await this.runWriteOperation(async () => {
      const db = this.requireDatabase();
      await this.drainWrites(db, through);
      await db.run("DELETE FROM browser_events");

      const vacuum = db.run("VACUUM");
      if (options.vacuum) {
        await vacuum;
      } else {
        vacuum.catch((err) => {
          console.error("Background VACUUM error:", err);
        });
      }
    });
  }

  /**
   * Run VACUUM manually when CPU is idle. This reclaims disk space
   * and optimizes the database, but is CPU-intensive.
   */
  async vacuum(): Promise<void> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }
    await this.db.run("VACUUM");
  }

  async close(): Promise<void> {
    await this.runWriteOperation(async () => {
      const db = this.db;
      if (!db) return;

      // A failed drain leaves the database and timer available for recovery.
      while (this.writeBuffer.size) {
        await this.drainWrites(db, this.committedWrites + this.writeBuffer.size);
      }
      this.db = null;
      try {
        await db.close();
      } catch (err) {
        this.db = db;
        throw err;
      }
      if (this.flushTimer) {
        clearInterval(this.flushTimer);
        this.flushTimer = null;
      }
    });
  }

  /**
   * Get current buffer stats for monitoring
   */
  getBufferStats(): { bufferedEvents: number; isBufferingEnabled: boolean } {
    return {
      bufferedEvents: this.writeBuffer.size,
      isBufferingEnabled: this.writeBufferEnabled,
    };
  }
}
