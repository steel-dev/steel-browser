import { LogStorage, LogQuery, LogQueryResult } from "./log-storage.interface.js";
import { BrowserEventUnion } from "../types.js";

interface StoredEvent {
  event: BrowserEventUnion;
  context: Record<string, any>;
  timestamp: Date;
}

/**
 * Simple in-memory log storage for testing or when persistence is not needed.
 * Note: This implementation does not support Parquet export.
 */
export class InMemoryStorage implements LogStorage {
  private events: StoredEvent[] = [];
  private maxEvents: number;

  constructor(maxEvents: number = 10000) {
    this.maxEvents = maxEvents;
  }

  async initialize(): Promise<void> {
    // No initialization needed
  }

  async write(event: BrowserEventUnion, context: Record<string, any>): Promise<void> {
    this.events.push({
      event,
      context,
      timestamp: new Date(event.timestamp),
    });

    // Trim old events if we exceed the max
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
  }

  async writeBatch(
    events: Array<{ event: BrowserEventUnion; context: Record<string, any> }>,
  ): Promise<void> {
    for (const { event, context } of events) {
      await this.write(event, context);
    }
  }

  async query(query: LogQuery): Promise<LogQueryResult> {
    let filtered = [...this.events];

    // Apply filters
    if (query.startTime) {
      filtered = filtered.filter((e) => e.timestamp >= query.startTime!);
    }

    if (query.endTime) {
      filtered = filtered.filter((e) => e.timestamp <= query.endTime!);
    }

    if (query.eventTypes && query.eventTypes.length > 0) {
      filtered = filtered.filter((e) => query.eventTypes!.includes(e.event.type));
    }

    if (query.pageId) {
      filtered = filtered.filter((e) => e.event.pageId === query.pageId);
    }

    if (query.targetType) {
      filtered = filtered.filter((e) => e.event.targetType === query.targetType);
    }

    // Sort by timestamp descending
    filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const total = filtered.length;
    const limit = query.limit || 100;
    const offset = query.offset || 0;

    const events: BrowserEventUnion[] = filtered
      .slice(offset, offset + limit)
      .map((e) => ({ ...e.event, ...e.context }));

    return {
      events,
      total,
      hasMore: offset + limit < total,
    };
  }

  async exportToParquet(filePath: string, query?: LogQuery): Promise<string> {
    throw new Error("Parquet export not supported in InMemoryStorage. Use DuckDBStorage instead.");
  }

  async getStats(): Promise<{
    totalEvents: number;
    oldestEvent: Date | null;
    newestEvent: Date | null;
    sizeBytes: number;
  }> {
    const timestamps = this.events.map((e) => e.timestamp.getTime());

    return {
      totalEvents: this.events.length,
      oldestEvent: timestamps.length > 0 ? new Date(Math.min(...timestamps)) : null,
      newestEvent: timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null,
      sizeBytes: JSON.stringify(this.events).length, // Approximate
    };
  }

  async clear(): Promise<void> {
    this.events = [];
  }

  async flush(): Promise<void> {
    // No-op for in-memory storage
  }

  async close(): Promise<void> {
    this.events = [];
  }
}
