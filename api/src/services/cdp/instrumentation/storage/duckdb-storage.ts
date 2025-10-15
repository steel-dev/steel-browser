import { Database } from "duckdb-async";
import path from "path";
import fs from "fs/promises";
import { LogStorage, LogQuery, LogQueryResult } from "./log-storage.interface.js";
import { BrowserEventUnion } from "../types.js";
import { randomUUID } from "crypto";

export interface DuckDBStorageOptions {
  /**
   * Path to the database file. If not provided, uses in-memory database.
   */
  dbPath?: string;
}

export class DuckDBStorage implements LogStorage {
  private db: Database | null = null;
  private dbPath: string;
  private isInitialized = false;

  constructor(options: DuckDBStorageOptions = {}) {
    this.dbPath = options.dbPath || ":memory:";
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    this.db = await Database.create(this.dbPath, {});

    console.log("Created database");

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

    this.isInitialized = true;
  }

  async write(event: BrowserEventUnion, context: Record<string, any>): Promise<void> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }

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
    // No-op: writes happen immediately in DuckDB
    return;
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

    // Export to Parquet
    const sanitizedPath = filePath.replace(/'/g, "''");
    const exportQuery = `
      COPY (
        SELECT * FROM browser_events ${whereClause}
      ) TO '${sanitizedPath}' (FORMAT PARQUET, COMPRESSION ZSTD)
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

  async clear(): Promise<void> {
    if (!this.db) {
      throw new Error("Database not initialized");
    }
    await this.db.run("DELETE FROM browser_events");
    await this.db.run("VACUUM");
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }

    this.isInitialized = false;
  }
}
