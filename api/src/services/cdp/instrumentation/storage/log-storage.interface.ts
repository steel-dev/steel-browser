import { BrowserEventUnion } from "../types.js";

export interface LogQuery {
  startTime?: Date;
  endTime?: Date;
  eventTypes?: string[];
  pageId?: string;
  targetType?: string;
  limit?: number;
  offset?: number;
}

export interface LogQueryResult {
  events: BrowserEventUnion[];
  total: number;
  hasMore: boolean;
}

export interface LogStorage {
  /**
   * Initialize the storage backend
   */
  initialize(): Promise<void>;

  /**
   * Write a single event to storage
   */
  write(event: BrowserEventUnion, context: Record<string, any>): Promise<void>;

  /**
   * Write multiple events in batch
   */
  writeBatch(
    events: Array<{ event: BrowserEventUnion; context: Record<string, any> }>,
  ): Promise<void>;

  /**
   * Query events from storage
   */
  query(query: LogQuery): Promise<LogQueryResult>;

  /**
   * Export logs to Parquet format
   */
  exportToParquet(filePath: string, query?: LogQuery): Promise<string>;

  /**
   * Get statistics about stored logs
   */
  getStats(): Promise<{
    totalEvents: number;
    oldestEvent: Date | null;
    newestEvent: Date | null;
    sizeBytes: number;
  }>;

  /**
   * Clear all logs
   */
  clear(): Promise<void>;

  /**
   * Flush any pending writes
   */
  flush(): Promise<void>;

  /**
   * Close the storage connection
   */
  close(): Promise<void>;
}
