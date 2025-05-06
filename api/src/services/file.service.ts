import archiver from "archiver";
import chokidar, { FSWatcher } from "chokidar";
import fs from "fs";
import { debounce, DebouncedFunc } from "lodash";
import { tmpdir } from "os";
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
  private static instance: FileService | null = null;

  // --- Archive related ---
  private prebuiltArchiveDir: string;
  private prebuiltArchivePath: string | null = null;
  private isArchiving: boolean = false;
  private archiveDebounceTime = 500;
  private debouncedCreateArchive: DebouncedFunc<() => Promise<string | null>>;
  private currentSessionId: string | null = null;
  // -----------------------

  private constructor() {
    this.baseFilesPath = env.NODE_ENV === "development" ? path.join(tmpdir(), "/files") : "/files";
    this.prebuiltArchiveDir = "/tmp/.steel";

    fs.mkdirSync(this.baseFilesPath, { recursive: true });

    const boundCreateArchive = this._createArchive.bind(this);
    this.debouncedCreateArchive = debounce(boundCreateArchive, this.archiveDebounceTime);

    this.initFileWatcher();
  }

  public setCurrentSessionId(sessionId: string | null) {
    this.currentSessionId = sessionId;
    if (sessionId) {
      this.prebuiltArchivePath = path.join(this.prebuiltArchiveDir, `${sessionId}.zip`);
    } else {
      this.prebuiltArchivePath = null;
    }
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
      depth: undefined,
    });

    console.log(`[FileService] File watcher initialized for ${this.baseFilesPath}`);

    this.fileWatcher
      .on("add", (filePath) => this.handleFileAdd(filePath))
      .on("unlink", (filePath) => this.handleFileDelete(filePath))
      .on("addDir", (filePath) => this.handleDirChange(filePath))
      .on("unlinkDir", (filePath) => this.handleDirChange(filePath))
      .on("error", (error) => console.error(`Watcher error: ${error}`))
      .on("ready", () => {
        console.log("[FileService] Initial scan complete. Ready for changes.");
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

  private async exists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.stat(filePath);

      return true;
    } catch (err: any) {
      if (err.code === "ENOENT") return false;
      throw err;
    }
  }

  public async saveFile({
    filePath,
    stream,
  }: {
    filePath: string;
    stream: Readable;
  }): Promise<File & { path: string }> {
    await fs.promises.mkdir(this.baseFilesPath, { recursive: true });

    const safeFilePath = this.getSafeFilePath(filePath);

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
      console.error(`[FileService] Error saving file ${safeFilePath}:`, error);

      try {
        if (await this.exists(safeFilePath)) {
          await fs.promises.unlink(safeFilePath);
        }
      } catch (cleanupErr) {
        console.error(`[FileService] Failed to cleanup file ${safeFilePath} after save error:`, cleanupErr);
      }
      throw error;
    }
  }

  public async downloadFile({ filePath }: { filePath: string }): Promise<{ stream: Readable } & File> {
    await fs.promises.mkdir(this.baseFilesPath, { recursive: true });
    const safeFilePath = this.getSafeFilePath(filePath);

    try {
      const stats = await fs.promises.stat(safeFilePath);
      if (!stats.isFile()) {
        throw new Error(`Requested path is not a file: ${safeFilePath}`);
      }
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
      console.error(`[FileService] Error accessing file ${safeFilePath} for download:`, error);
      throw new Error(`File not found or inaccessible: ${safeFilePath}`);
    }
  }

  public async getFile({ sessionId, filePath }: { sessionId: string; filePath: string }): Promise<File> {
    await fs.promises.mkdir(this.baseFilesPath, { recursive: true });
    const safeFilePath = this.getSafeFilePath(filePath);

    try {
      const stats = await fs.promises.stat(safeFilePath);
      if (!stats.isFile()) {
        throw new Error(`Requested path is not a file: ${safeFilePath}`);
      }
      const file: File = {
        size: stats.size,
        lastModified: stats.mtime,
      };
      return file;
    } catch (error: any) {
      if (error.code === "ENOENT") {
        throw new Error(`File not found: ${safeFilePath}`);
      }
      console.error(`[FileService] Error accessing file ${safeFilePath} for getFile:`, error);
      throw new Error(`File not found or inaccessible: ${safeFilePath}`);
    }
  }

  public async listFiles({ sessionId }: { sessionId: string }): Promise<Array<{ path: string } & File>> {
    await fs.promises.mkdir(this.baseFilesPath, { recursive: true });

    try {
      const filesAndDirs = await fs.promises.readdir(this.baseFilesPath, { withFileTypes: true });
      const fileDetailsPromises = filesAndDirs.map(async (dirent) => {
        const entryPath = path.join(this.baseFilesPath, dirent.name);
        try {
          if (dirent.isFile()) {
            const stats = await fs.promises.stat(entryPath);
            return {
              path: entryPath,
              size: stats.size,
              lastModified: stats.mtime,
            };
          }
        } catch (statError) {
          console.error(`[FileService] Error getting stats for file ${entryPath} during listFiles:`, statError);
        }
        return null;
      });

      const fileDetails = (await Promise.all(fileDetailsPromises)).filter(
        (file): file is { path: string } & File => file !== null,
      );

      fileDetails.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());

      return fileDetails;
    } catch (error) {
      console.error(`[FileService] Error reading directory ${this.baseFilesPath} for listFiles:`, error);
      return [];
    }
  }

  public async deleteFile({ sessionId, filePath }: { sessionId: string; filePath: string }): Promise<void> {
    await fs.promises.mkdir(this.baseFilesPath, { recursive: true });
    const safeFilePath = this.getSafeFilePath(filePath);

    if (!(await this.exists(safeFilePath))) {
      console.log(`[FileService] File ${safeFilePath} not found on disk during delete operation. Skipping.`);
      return;
    }

    try {
      const stats = await fs.promises.stat(safeFilePath);
      if (!stats.isFile()) {
        console.warn(`[FileService] Path ${safeFilePath} is not a file. Skipping delete.`);
        return;
      }
      await fs.promises.unlink(safeFilePath);
      console.log(`[FileService] File deleted: ${safeFilePath}`);
      this.debouncedCreateArchive();
    } catch (unlinkError) {
      console.error(`Error unlinking file ${safeFilePath}:`, unlinkError);
      throw unlinkError;
    }

    return;
  }

  public async cleanupFiles(): Promise<void> {
    console.log(`[FileService cleanupFiles] Starting cleanup for directory: ${this.baseFilesPath}`);
    try {
      const items = await fs.promises.readdir(this.baseFilesPath);
      for (const item of items) {
        const itemPath = path.join(this.baseFilesPath, item);
        try {
          const stats = await fs.promises.lstat(itemPath);
          if (stats.isDirectory()) {
            await fs.promises.rm(itemPath, { recursive: true, force: true });
            console.log(`[FileService cleanupFiles] Deleted directory: ${itemPath}`);
          } else {
            await fs.promises.unlink(itemPath);
            console.log(`[FileService cleanupFiles] Deleted file: ${itemPath}`);
          }
        } catch (err: any) {
          if (err.code !== "ENOENT") {
            console.error(`[FileService cleanupFiles] Error deleting item ${itemPath}:`, err);
          }
        }
      }
    } catch (err: any) {
      if (err.code === "ENOENT") {
        console.log(
          `[FileService cleanupFiles] Base directory ${this.baseFilesPath} does not exist, no cleanup needed or already clean.`,
        );
      } else {
        console.error(`[FileService cleanupFiles] Error reading directory ${this.baseFilesPath} for cleanup:`, err);
      }
    }

    await fs.promises.mkdir(this.baseFilesPath, { recursive: true });
    console.log(
      `[FileService cleanupFiles] Files cleaned. Triggering debounced archive creation for the new (empty) state.`,
    );
    this.debouncedCreateArchive();
  }

  public getBaseFilesPath(): string {
    return this.baseFilesPath;
  }

  public getPrebuiltArchivePath(): string | null {
    if (this.currentSessionId) {
      const expectedArchivePath = path.join(this.prebuiltArchiveDir, `${this.currentSessionId}.zip`);
      if (fs.existsSync(expectedArchivePath)) {
        return expectedArchivePath;
      }
      return this.prebuiltArchivePath;
    }
    return null;
  }

  private _createArchive(): Promise<string | null> {
    return new Promise(async (resolvePromise, rejectPromise) => {
      if (this.currentSessionId === null) {
        console.log("[_createArchive] No session ID found, skipping archive creation.");
        return resolvePromise(null);
      }

      if (this.isArchiving) {
        console.warn(
          `[_createArchive] Warning: Archiving process for session ${this.currentSessionId} initiated while another is already in progress. This might lead to conflicts if not handled by caller.`,
        );
      }

      this.isArchiving = true;
      this.prebuiltArchivePath = null;
      console.log(`[_createArchive] Starting archive creation for session: ${this.currentSessionId}`);

      const tempArchivePath = path.join(this.prebuiltArchiveDir, `${this.currentSessionId}-${Date.now()}.zip.tmp`);
      const finalArchivePath = path.join(this.prebuiltArchiveDir, `${this.currentSessionId}.zip`);

      try {
        await fs.promises.mkdir(this.prebuiltArchiveDir, { recursive: true });
      } catch (mkdirError) {
        console.error(`[_createArchive] Error creating archive directory ${this.prebuiltArchiveDir}:`, mkdirError);
        this.isArchiving = false;
        return rejectPromise(mkdirError);
      }

      const output = fs.createWriteStream(tempArchivePath);
      const archive = archiver("zip", { zlib: { level: 9 } });
      let errorOccurredStream = false;

      const operationCleanup = async (success: boolean, archivePath: string | null = null, error?: any) => {
        this.isArchiving = false;
        this.prebuiltArchivePath = archivePath;

        if (!success && tempArchivePath && (await this.exists(tempArchivePath))) {
          try {
            await fs.promises.unlink(tempArchivePath);
            console.log("[_createArchive] Cleaned up temporary archive file due to error.");
          } catch (unlinkErr) {
            console.error("[_createArchive] Failed to clean up temp archive file after error:", unlinkErr);
          }
        }
        if (success && archivePath) {
          resolvePromise(archivePath);
        } else {
          rejectPromise(error || new Error("Archiving failed due to an unknown reason."));
        }
      };

      output.on("close", async () => {
        if (errorOccurredStream) {
          console.log("[_createArchive] Output stream closed after an error was emitted and handled.");
          return;
        }
        try {
          if (await this.exists(finalArchivePath)) {
            await fs.promises.unlink(finalArchivePath);
          }
          await fs.promises.rename(tempArchivePath, finalArchivePath);
          console.log(
            `[_createArchive] Archive successfully created: ${finalArchivePath}, size: ${archive.pointer()} bytes`,
          );
          operationCleanup(true, finalArchivePath);
        } catch (renameError) {
          console.error("[_createArchive] Error renaming temporary archive file:", renameError);
          operationCleanup(false, null, renameError);
        }
      });

      output.on("error", (err) => {
        console.error("[_createArchive] Archive output stream error:", err);
        errorOccurredStream = true;
        if (!output.writableFinished) {
          output.destroy();
        }
        operationCleanup(false, null, err);
      });

      archive.on("warning", (err) => {
        if (err.code === "ENOENT") {
          console.warn(`[_createArchive] Archiving warning (ENOENT): ${err.message}`);
        } else {
          console.error("[_createArchive] Archiving warning:", err);
        }
      });

      archive.on("error", (err) => {
        console.error("[_createArchive] Archiving process error (archive.on('error')):", err);
        errorOccurredStream = true;
        if (!output.writableFinished) {
          output.destroy(err instanceof Error ? err : new Error(String(err)));
        }
        operationCleanup(false, null, err);
      });

      try {
        if (!(await this.exists(this.baseFilesPath))) {
          console.warn(`[_createArchive] Base directory ${this.baseFilesPath} does not exist. Creating empty archive.`);
        } else {
          const stats = await fs.promises.stat(this.baseFilesPath);
          if (!stats.isDirectory()) {
            console.error(
              `[_createArchive] Base path ${this.baseFilesPath} is not a directory. Creating empty archive.`,
            );
          } else {
            const files = await fs.promises.readdir(this.baseFilesPath);
            if (files.length === 0) {
              console.log("[_createArchive] Base directory is empty. Creating empty archive.");
            } else {
              archive.directory(this.baseFilesPath, false);
            }
          }
        }
        archive.pipe(output);
        await archive.finalize();
      } catch (err: any) {
        console.error("[_createArchive] Error during archive preparation or finalization:", err);
        errorOccurredStream = true;
        if (!output.writableFinished) {
          output.destroy(err instanceof Error ? err : new Error(String(err)));
        }
        operationCleanup(false, null, err);
      }
    });
  }

  public async archiveAndClearSessionFiles(): Promise<string | null> {
    const methodName = "[archiveAndClearSessionFiles]";
    if (!this.currentSessionId) {
      console.log(`${methodName} No current session ID. Skipping operation.`);
      return null;
    }

    console.log(`${methodName} Starting for session: ${this.currentSessionId}`);

    this.debouncedCreateArchive.cancel();
    console.log(`${methodName} Cancelled pending debounced archive creation for session: ${this.currentSessionId}.`);

    let waitCycles = 0;
    const maxWaitCycles = 150;
    while (this.isArchiving) {
      if (waitCycles >= maxWaitCycles) {
        console.error(
          `${methodName} Timeout waiting for ongoing archive operation (session: ${this.currentSessionId}) to complete. Aborting.`,
        );
        return null;
      }
      console.log(
        `${methodName} Another archive operation is in progress for session ${this.currentSessionId}, waiting... (${waitCycles}/${maxWaitCycles})`,
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
      waitCycles++;
    }

    console.log(`${methodName} Initiating archive creation for session: ${this.currentSessionId}.`);
    let archivePath: string | null = null;
    try {
      archivePath = await this._createArchive();
    } catch (error) {
      console.error(
        `${methodName} Error during explicit archive creation for session ${this.currentSessionId}:`,
        error,
      );
      return null;
    }

    if (!archivePath) {
      console.warn(
        `${methodName} Archive creation failed or returned no path for session ${this.currentSessionId}. Not clearing files.`,
      );
      return null;
    }

    console.log(`${methodName} Archive for session ${this.currentSessionId} successfully created at: ${archivePath}`);

    console.log(`${methodName} Proceeding to clear session files for ${this.currentSessionId}.`);
    try {
      await this.cleanupFiles();
      console.log(`${methodName} Session files for ${this.currentSessionId} cleared successfully.`);
    } catch (error) {
      console.error(`${methodName} Error during file cleanup for session ${this.currentSessionId}:`, error);
      console.warn(
        `${methodName} File cleanup failed for session ${this.currentSessionId}, but archive was created at ${archivePath}.`,
      );
      return archivePath;
    }

    console.log(
      `${methodName} Operation completed for session: ${this.currentSessionId}. Archive at ${archivePath}, files cleared.`,
    );
    return archivePath;
  }
}
