import { Database } from "duckdb-async";
import path from "path";
import fs from "fs/promises";
import { LogStorage, LogQuery, LogQueryResult } from "./log-storage.interface.js";
import { BrowserEventUnion } from "../types.js";
import { randomUUID } from "crypto";

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

export class DuckDBStorage implements LogStorage {
  private db: Database | null = null;
  private dbPath: string;
  private maxThreads: number;
  private memoryLimit: string;
  private parquetCompression: ParquetCompression;
  private isInitialized = false;

  // Write buffer for batching
  private writeBuffer: Array<{ event: BrowserEventUnion; context: Record<string, any> }> = [];
  private writeBufferEnabled: boolean;
  private writeBufferSize: number;
  private writeBufferFlushInterval: number;
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;

  constructor(options: DuckDBStorageOptions = {}) {
    this.dbPath = options.dbPath || ":memory:";
    this.maxThreads = options.maxThreads ?? 2;
    this.memoryLimit = options.memoryLimit ?? "256MB";
    this.parquetCompression = options.parquetCompression ?? "snappy";
    this.writeBufferEnabled = options.enableWriteBuffer ?? true;
    this.writeBufferSize = options.writeBufferSize ?? 100;
    this.writeBufferFlushInterval = options.writeBufferFlushInterval ?? 1000;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    this.db = await Database.create(this.dbPath, {});

    // Throttle CPU usage: limit threads and memory
    await this.db.run(`SET threads = ${this.maxThreads}`);
    await this.db.run(`SET memory_limit = '${this.memoryLimit}'`);

    console.log(`DuckDB initialized: threads=${this.maxThreads}, memory=${this.memoryLimit}`);

    await this.db.run(`
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

    console.log("Created browser_events table");

    await this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_timestamp ON browser_events(timestamp);
    `);
    await this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_event_type ON browser_events(event_type);
    `);
    await this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_page_id ON browser_events(page_id);
    `);

    // Start periodic flush timer if write buffering is enabled
    if (this.writeBufferEnabled) {
      this.startFlushTimer();
    }

    this.isInitialized = true;
  }

  private startFlushTimer(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => {
      this.flushWriteBuffer().catch((err) => {
        console.error("DuckDB flush error:", err);
      });
    }, this.writeBufferFlushInterval);
    // Don't block process exit
    this.flushTimer.unref();
  }

  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private async flushWriteBuffer(): Promise<void> {
    if (this.isFlushing || this.writeBuffer.length === 0 || !this.db) return;

    this.isFlushing = true;
    const toFlush = this.writeBuffer.splice(0, this.writeBuffer.length);

    try {
      await this.writeBatchInternal(toFlush);
    } catch (err) {
      // Put events back on failure (at the front)
      this.writeBuffer.unshift(...toFlush);
      throw err;
    } finally {
      this.isFlushing = false;
    }
  }

  async write(event: BrowserEventUnion, context: Record<string, any>): Promise<void> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }

    if (this.writeBufferEnabled) {
      // Add to buffer
      this.writeBuffer.push({ event, context });

      // Flush if buffer is full
      if (this.writeBuffer.length >= this.writeBufferSize) {
        await this.flushWriteBuffer();
      }
      return;
    }

    // Direct write (no buffering)
    await this.writeSingle(event, context);
  }

  private async writeSingle(event: BrowserEventUnion, context: Record<string, any>): Promise<void> {
    if (!this.db) return;

    const stmt = await this.db.prepare(`
        INSERT INTO browser_events (id, timestamp, event_type, target_type, page_id, data, context, indexed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);

    const id = randomUUID();
    const timestamp = event.timestamp;
    const eventType = event.type;
    const targetType = event.targetType || null;
    const pageId = event.pageId || null;
    const data = JSON.stringify(event);
    const contextJson = JSON.stringify(context);

    await stmt.run(id, timestamp, eventType, targetType, pageId, data, contextJson);
    await stmt.finalize();
  }

  async writeBatch(
    events: Array<{ event: BrowserEventUnion; context: Record<string, any> }>,
  ): Promise<void> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }

    if (events.length === 0) return;

    if (this.writeBufferEnabled) {
      // Add all to buffer
      this.writeBuffer.push(...events);

      // Flush if buffer exceeds threshold
      if (this.writeBuffer.length >= this.writeBufferSize) {
        await this.flushWriteBuffer();
      }
      return;
    }

    // Direct batch write (no buffering)
    await this.writeBatchInternal(events);
  }

  private async writeBatchInternal(
    events: Array<{ event: BrowserEventUnion; context: Record<string, any> }>,
  ): Promise<void> {
    if (!this.db || events.length === 0) return;

    const values: string[] = [];
    const params: any[] = [];

    for (const { event, context } of events) {
      values.push("(?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)");

      const id = randomUUID();
      const timestamp = event.timestamp;
      const eventType = event.type;
      const targetType = event.targetType || null;
      const pageId = event.pageId || null;
      const data = JSON.stringify(event);
      const contextJson = JSON.stringify(context);

      params.push(id, timestamp, eventType, targetType, pageId, data, contextJson);
    }

    const sql = `
      INSERT INTO browser_events (id, timestamp, event_type, target_type, page_id, data, context, indexed_at)
      VALUES ${values.join(", ")}
    `;

    await this.db.run(sql, ...params);
  }

  async flush(): Promise<void> {
    // Flush any buffered writes
    await this.flushWriteBuffer();
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
    if (!this.db) {
      throw new Error("Database not initialized");
    }

    // Flush any pending writes first
    await this.flushWriteBuffer();

    await this.db.run("DELETE FROM browser_events");

    // VACUUM is CPU-intensive; run in background by default
    if (options.vacuum) {
      await this.db.run("VACUUM");
    } else {
      // Fire-and-forget vacuum (don't block)
      this.db.run("VACUUM").catch((err) => {
        console.error("Background VACUUM error:", err);
      });
    }
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
    // Stop the flush timer
    this.stopFlushTimer();

    // Flush any remaining buffered writes
    if (this.writeBuffer.length > 0 && this.db) {
      try {
        await this.flushWriteBuffer();
      } catch (err) {
        console.error("Error flushing buffer on close:", err);
      }
    }

    if (this.db) {
      await this.db.close();
      this.db = null;
    }

    this.isInitialized = false;
  }

  /**
   * Get current buffer stats for monitoring
   */
  getBufferStats(): { bufferedEvents: number; isBufferingEnabled: boolean } {
    return {
      bufferedEvents: this.writeBuffer.length,
      isBufferingEnabled: this.writeBufferEnabled,
    };
  }
}
