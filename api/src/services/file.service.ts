import archiver from "archiver";
import chokidar, { FSWatcher } from "chokidar";
import fs from "fs";
import { debounce } from "lodash";
import path, { resolve } from "path";
import { Readable } from "stream";
import { env } from "../env";

interface File {
  size: number;
  lastModified: Date;
  // metadata?: Record<string, any>;
}

export class FileService {
  private baseFilesPath: string;
  private fileWatcher: FSWatcher | null = null;
  private processingFiles: Set<string> = new Set();
  private static instance: FileService | null = null;
  // --- Archive related ---
  private prebuiltArchiveDir: string;
  private prebuiltArchivePath: string | null = null;
  private isArchiving: boolean = false;
  private archiveDebounceTime = 1000; // 1 seconds debounce time
  private debouncedCreateArchive: () => void;
  private currentSessionId: string | null = null;
  // -----------------------

  private constructor() {
    this.baseFilesPath = env.NODE_ENV === "development" ? path.join(process.cwd(), "/files") : "/files";
    this.prebuiltArchiveDir = env.ARCHIVE_DIR;

    fs.mkdirSync(this.baseFilesPath, { recursive: true });

    this.debouncedCreateArchive = debounce(this._createArchive.bind(this), this.archiveDebounceTime);

    this.initFileWatcher();
  }

  public setCurrentSessionId(sessionId: string | null) {
    this.currentSessionId = sessionId;
  }

  public getCurrentSessionId() {
    return this.currentSessionId;
  }

  public static getInstance() {
    if (!FileService.instance) {
      FileService.instance = new FileService();
    }
    return FileService.instance;
  }

  private async handleFileAdd(filePath: string) {
    console.log(`[FileService] File added detected: ${filePath}`);
    this.debouncedCreateArchive();
  }

  private handleFileDelete(filePath: string) {
    console.log(`[FileService] File deleted detected: ${filePath}`);
    this.debouncedCreateArchive();
  }

  private handleDirChange(filePath: string) {
    console.log(`[FileService] Directory change detected: ${filePath}`);
    this.debouncedCreateArchive();
  }

  private initFileWatcher() {
    this.fileWatcher = chokidar.watch(this.baseFilesPath, {
      ignored: /(^|[\/\\])\../,
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
      depth: 0,
    });

    console.log(`File watcher initialized for ${this.baseFilesPath}`);

    this.fileWatcher
      .on("add", (filePath) => this.handleFileAdd(filePath))
      .on("unlink", (filePath) => this.handleFileDelete(filePath))
      .on("addDir", (filePath) => this.handleDirChange(filePath))
      .on("unlinkDir", (filePath) => this.handleDirChange(filePath))
      .on("error", (error) => console.error(`Watcher error: ${error}`))
      .on("ready", () => {
        console.log("Initial scan complete. Ready for changes.");
        this.debouncedCreateArchive();
      });
  }

  private getSafeFilePath(relativePath: string) {
    const resolvedPath = resolve(this.baseFilesPath, relativePath);
    if (!resolvedPath.startsWith(this.baseFilesPath + path.sep) && resolvedPath !== this.baseFilesPath) {
      throw new Error("Invalid path");
    }
    return resolvedPath;
  }

  private addTimestampToFilePath(filePath: string): string {
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const baseName = path.basename(filePath, ext);

    const timestamp = Date.now();
    const newFileName = `${baseName}-${timestamp}${ext}`;

    const newPath = path.join(dir, newFileName);
    return newPath;
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.stat(filePath);

      return true;
    } catch (err: any) {
      if (err.code === "ENOENT") return false;
      throw err;
    }
  }

  // ============================================================
  // Public Methods
  // ============================================================

  public async saveFile({
    filePath,
    stream,
  }: {
    filePath: string;
    stream: Readable;
  }): Promise<File & { path: string }> {
    await fs.promises.mkdir(this.baseFilesPath, { recursive: true });

    const safeFilePath = this.addTimestampToFilePath(this.getSafeFilePath(filePath));

    try {
      await fs.promises.writeFile(safeFilePath, stream);
      const stats = await fs.promises.stat(safeFilePath);
      const file: File = {
        size: stats.size,
        lastModified: stats.mtime,
      };
      console.log(`File saved: ${safeFilePath}, Size: ${file.size}`);
      this.debouncedCreateArchive();
      return { ...file, path: safeFilePath };
    } catch (error) {
      console.error(`Error saving file ${safeFilePath}:`, error);
      try {
        if (await this.exists(safeFilePath)) {
          await fs.promises.unlink(safeFilePath);
        }
      } catch (cleanupErr) {
        console.error(`Failed to cleanup file ${safeFilePath} after save error:`, cleanupErr);
      }
      throw error;
    }
  }

  public async downloadFile({ filePath }: { filePath: string }): Promise<{ stream: Readable } & File> {
    await fs.promises.mkdir(this.baseFilesPath, { recursive: true });
    const safeFilePath = this.getSafeFilePath(filePath);

    try {
      const stats = await fs.promises.stat(safeFilePath);
      const file: File = {
        size: stats.size,
        lastModified: stats.mtime,
      };
      const stream = fs.createReadStream(safeFilePath);
      return {
        stream,
        ...file,
      };
    } catch (error: any) {
      if (error.code === "ENOENT") {
        throw new Error(`File not found: ${safeFilePath}`);
      }
      console.error(`Error accessing file ${safeFilePath} for download:`, error);
      throw new Error(`File not found or inaccessible: ${safeFilePath}`);
    }
  }

  public async getFile({ sessionId, filePath }: { sessionId: string; filePath: string }): Promise<File> {
    await fs.promises.mkdir(this.baseFilesPath, { recursive: true });
    const safeFilePath = this.getSafeFilePath(filePath);

    try {
      const stats = await fs.promises.stat(safeFilePath);
      const file: File = {
        size: stats.size,
        lastModified: stats.mtime,
      };
      return file;
    } catch (error: any) {
      if (error.code === "ENOENT") {
        throw new Error(`File not found: ${safeFilePath}`);
      }
      console.error(`Error accessing file ${safeFilePath} for getFile:`, error);
      throw new Error(`File not found or inaccessible: ${safeFilePath}`);
    }
  }

  public async listFiles({ sessionId }: { sessionId: string }): Promise<Array<{ path: string } & File>> {
    await fs.promises.mkdir(this.baseFilesPath, { recursive: true });

    try {
      const fileNames = await fs.promises.readdir(this.baseFilesPath);
      const fileDetailsPromises = fileNames.map(async (fileName) => {
        const filePath = path.join(this.baseFilesPath, fileName);
        try {
          const stats = await fs.promises.stat(filePath);
          if (stats.isFile()) {
            return {
              path: filePath,
              size: stats.size,
              lastModified: stats.mtime,
            };
          }
        } catch (statError) {
          console.error(`Error getting stats for file ${filePath} during listFiles:`, statError);
        }
        return null;
      });

      const fileDetails = (await Promise.all(fileDetailsPromises)).filter(
        (file): file is { path: string } & File => file !== null,
      );

      fileDetails.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());

      return fileDetails;
    } catch (error) {
      console.error(`Error reading directory ${this.baseFilesPath} for listFiles:`, error);
      return [];
    }
  }

  public async deleteFile({ sessionId, filePath }: { sessionId: string; filePath: string }): Promise<void> {
    await fs.promises.mkdir(this.baseFilesPath, { recursive: true });

    const safeFilePath = this.getSafeFilePath(filePath);

    if (!(await this.exists(safeFilePath))) {
      console.log(`File ${safeFilePath} not found on disk during delete operation. Skipping.`);
      return;
    }

    try {
      await fs.promises.unlink(safeFilePath);
      console.log(`File deleted: ${safeFilePath}`);
    } catch (unlinkError) {
      console.error(`Error unlinking file ${safeFilePath}:`, unlinkError);
      throw unlinkError;
    }

    return;
  }

  public async cleanupFiles(): Promise<void> {
    try {
      const files = await fs.promises.readdir(this.baseFilesPath);
      for (const file of files) {
        const filePath = path.join(this.baseFilesPath, file);
        try {
          const stats = await fs.promises.lstat(filePath);
          if (stats.isDirectory()) {
            await fs.promises.rm(filePath, { recursive: true, force: true });
          } else {
            await fs.promises.unlink(filePath);
          }
        } catch (err) {
          console.error(`Error deleting item ${filePath} during cleanup:`, err);
        }
      }
    } catch (err) {
      console.error(`Error reading directory ${this.baseFilesPath} for cleanup:`, err);
      await fs.promises.mkdir(this.baseFilesPath, { recursive: true });
    }

    await fs.promises.mkdir(this.baseFilesPath, { recursive: true });

    this.debouncedCreateArchive();

    return;
  }

  public getBaseFilesPath(): string {
    return this.baseFilesPath;
  }

  // --- Archive Methods ---
  public getPrebuiltArchivePath(): string | null {
    return this.prebuiltArchivePath;
  }

  private async _createArchive(): Promise<void> {
    if (this.currentSessionId === null) {
      console.log("No session ID found, skipping archive creation.");
      return;
    }

    if (this.isArchiving) {
      console.log("Archiving already in progress, skipping.");
      return;
    }
    this.isArchiving = true;
    this.prebuiltArchivePath = null;
    console.log("Starting archive creation...");

    const tempArchivePath = path.join(this.prebuiltArchiveDir, `${this.currentSessionId}-${Date.now()}.zip.tmp`);
    const finalArchivePath = path.join(this.prebuiltArchiveDir, `${this.currentSessionId}.zip`);

    const output = fs.createWriteStream(tempArchivePath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    let errorOccurred = false;

    output.on("close", async () => {
      if (!errorOccurred) {
        try {
          await fs.promises.rename(tempArchivePath, finalArchivePath);
          this.prebuiltArchivePath = finalArchivePath;
          console.log(`Archive successfully created: ${this.prebuiltArchivePath}, size: ${archive.pointer()} bytes`);
        } catch (renameError) {
          console.error("Error renaming temporary archive file:", renameError);
          this.prebuiltArchivePath = null;
          try {
            await fs.promises.unlink(tempArchivePath);
          } catch (unlinkErr) {
            console.error("Failed to clean up temp archive file after rename error:", unlinkErr);
          }
        }
      } else {
        try {
          if (await this.exists(tempArchivePath)) {
            await fs.promises.unlink(tempArchivePath);
            console.log("Cleaned up temporary archive file due to error.");
          }
        } catch (unlinkErr) {
          console.error("Failed to clean up temp archive file after error:", unlinkErr);
        }
      }
      this.isArchiving = false;
    });

    output.on("error", (err) => {
      console.error("Archive output stream error:", err);
      errorOccurred = true;
      this.isArchiving = false;
      this.prebuiltArchivePath = null;
    });

    archive.on("warning", (err) => {
      if (err.code === "ENOENT") {
        console.warn(`Archiving warning (ENOENT): ${err.message}`);
      } else {
        console.error("Archiving warning:", err);
      }
    });

    archive.on("error", (err) => {
      console.error("Archiving failed:", err);
      errorOccurred = true;
      this.isArchiving = false;
      this.prebuiltArchivePath = null;
      if (!output.closed) {
        output.destroy(err instanceof Error ? err : new Error(String(err)));
      }
    });

    try {
      if (!(await this.exists(this.baseFilesPath))) {
        console.warn(`Base directory ${this.baseFilesPath} does not exist. Creating empty archive.`);
      } else {
        const fileStats = await fs.promises.stat(this.baseFilesPath);
        if (!fileStats.isDirectory()) {
          console.error(`Base path ${this.baseFilesPath} is not a directory. Creating empty archive.`);
        } else {
          const files = await fs.promises.readdir(this.baseFilesPath);
          if (files.length === 0) {
            console.log("Base directory is empty. Creating empty archive.");
          } else {
            archive.directory(this.baseFilesPath, false);
          }
        }
      }

      archive.pipe(output);
      await archive.finalize();
    } catch (err: any) {
      console.error("Error during archive preparation:", err);
      errorOccurred = true;
      this.isArchiving = false;
      this.prebuiltArchivePath = null;
      if (!output.closed) {
        output.destroy(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }
}
