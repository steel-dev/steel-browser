import fs from "fs";
import path from "path";
import { BrowserEventUnion } from "../../services/cdp/instrumentation/types.js";
import {
  LogQuery,
  LogQueryResult,
  LogStorage,
} from "../../services/cdp/instrumentation/storage/log-storage.interface.js";

export interface RollingFileStorageOptions {
  directory: string;
  filenamePrefix: string;
  maxFileSizeBytes: number;
  maxFiles: number;
}

export class RollingFileStorage implements LogStorage {
  private directory: string;
  private filenamePrefix: string;
  private maxFileSizeBytes: number;
  private maxFiles: number;
  private currentFilePath: string;
  private currentFileSize: number = 0;

  constructor(options: RollingFileStorageOptions) {
    this.directory = options.directory;
    this.filenamePrefix = options.filenamePrefix;
    this.maxFileSizeBytes = options.maxFileSizeBytes;
    this.maxFiles = options.maxFiles;
    this.currentFilePath = path.join(this.directory, `${this.filenamePrefix}-0.ndjson`);
  }

  async initialize(): Promise<void> {
    if (!fs.existsSync(this.directory)) {
      await fs.promises.mkdir(this.directory, { recursive: true });
    }

    // Find the latest file or create a new one
    const files = await this.getLogFiles();
    if (files.length > 0) {
      this.currentFilePath = path.join(this.directory, files[files.length - 1]);
      const stats = await fs.promises.stat(this.currentFilePath);
      this.currentFileSize = stats.size;
    } else {
      this.currentFilePath = path.join(this.directory, `${this.filenamePrefix}-0.ndjson`);
      this.currentFileSize = 0;
    }
  }

  async write(event: BrowserEventUnion, context: Record<string, any>): Promise<void> {
    const logEntry = JSON.stringify({ ...event, ...context }) + "\n";
    const entrySize = Buffer.byteLength(logEntry, "utf8");

    if (this.currentFileSize + entrySize > this.maxFileSizeBytes) {
      await this.rotate();
    }

    await fs.promises.appendFile(this.currentFilePath, logEntry);
    this.currentFileSize += entrySize;
  }

  async writeBatch(
    events: Array<{ event: BrowserEventUnion; context: Record<string, any> }>,
  ): Promise<void> {
    for (const { event, context } of events) {
      await this.write(event, context);
    }
  }

  async query(query: LogQuery): Promise<LogQueryResult> {
    // Basic implementation: read current file only for now, or all files if needed.
    // For debugging state transitions, we usually just need the latest.
    const files = await this.getLogFiles();
    const allEvents: BrowserEventUnion[] = [];

    // Reverse to get latest first
    for (const file of [...files].reverse()) {
      const content = await fs.promises.readFile(path.join(this.directory, file), "utf8");
      const lines = content.trim().split("\n");
      for (const line of lines) {
        if (!line) continue;
        try {
          allEvents.push(JSON.parse(line));
        } catch (e) {}
      }
      if (allEvents.length >= (query.limit || 100)) break;
    }

    return {
      events: allEvents.slice(0, query.limit || 100),
      total: allEvents.length,
      hasMore: false,
    };
  }

  supportsParquetExport(): boolean {
    return false;
  }

  async exportToParquet(filePath: string, query?: LogQuery): Promise<string> {
    throw new Error("Parquet export not supported in RollingFileStorage");
  }

  async getStats(): Promise<{
    totalEvents: number;
    oldestEvent: Date | null;
    newestEvent: Date | null;
    sizeBytes: number;
  }> {
    const files = await this.getLogFiles();
    let totalSize = 0;
    for (const file of files) {
      const stats = await fs.promises.stat(path.join(this.directory, file));
      totalSize += stats.size;
    }

    return {
      totalEvents: 0, // Hard to calculate without parsing all files
      oldestEvent: null,
      newestEvent: null,
      sizeBytes: totalSize,
    };
  }

  async clear(): Promise<void> {
    const files = await this.getLogFiles();
    for (const file of files) {
      await fs.promises.unlink(path.join(this.directory, file));
    }
    this.currentFileSize = 0;
    this.currentFilePath = path.join(this.directory, `${this.filenamePrefix}-0.ndjson`);
  }

  async flush(): Promise<void> {
    // appendFile is atomic enough for this
  }

  async close(): Promise<void> {
    // No-op
  }

  private async rotate(): Promise<void> {
    const files = await this.getLogFiles();
    const nextIndex = files.length > 0 ? this.getFileIndex(files[files.length - 1]) + 1 : 0;

    this.currentFilePath = path.join(this.directory, `${this.filenamePrefix}-${nextIndex}.ndjson`);
    this.currentFileSize = 0;

    // Cleanup old files
    // After the next write, we will have (updatedFiles.length + 1) files on disk
    // We want to keep at most maxFiles total
    const updatedFiles = await this.getLogFiles();
    const maxOldFiles = this.maxFiles - 1;
    if (updatedFiles.length > maxOldFiles) {
      const filesToDelete = updatedFiles.slice(0, updatedFiles.length - maxOldFiles);
      for (const file of filesToDelete) {
        await fs.promises.unlink(path.join(this.directory, file));
      }
    }
  }

  private async getLogFiles(): Promise<string[]> {
    if (!fs.existsSync(this.directory)) return [];
    const files = await fs.promises.readdir(this.directory);
    return files
      .filter((f) => f.startsWith(this.filenamePrefix) && f.endsWith(".ndjson"))
      .sort((a, b) => this.getFileIndex(a) - this.getFileIndex(b));
  }

  private getFileIndex(filename: string): number {
    const match = filename.match(new RegExp(`${this.filenamePrefix}-(\\d+)\\.ndjson`));
    return match ? parseInt(match[1], 10) : 0;
  }
}
