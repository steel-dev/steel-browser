import archiver from "archiver";
import chokidar, { FSWatcher } from "chokidar";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import { finished, pipeline } from "node:stream/promises";
import type { DebouncedFunc } from "lodash-es";
import debounce from "lodash-es/debounce.js";
import { tmpdir } from "os";
import path, { resolve } from "path";
import { Readable } from "stream";
import { env } from "../env.js";

export function getArchiveErrorCode(error: unknown): string | undefined {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{0,39}$/.test(code) ? code : undefined;
}

interface File {
  size: number;
  lastModified: Date;
}

export interface FileServiceOptions {
  baseFilesPath?: string;
  prebuiltArchiveDir?: string;
  watchFiles?: boolean;
}

export class FileService {
  private baseFilesPath: string;
  private fileWatcher: FSWatcher | null = null;
  private static instance: FileService | null = null;
  private prebuiltArchiveDir: string;
  private prebuiltArchivePath: string;
  private currentArchivePromise: Promise<void> | null = null;
  private archiveDirty = true;
  private archiveDebounceTime = 500;
  private debouncedCreateArchive: DebouncedFunc<() => void>;

  public constructor(options: FileServiceOptions = {}) {
    this.baseFilesPath = options.baseFilesPath ?? path.join(tmpdir(), "steel-files");
    this.prebuiltArchiveDir = options.prebuiltArchiveDir ?? "/tmp/.steel";
    this.prebuiltArchivePath = path.join(this.prebuiltArchiveDir, "files.zip");

    fs.mkdirSync(this.baseFilesPath, { recursive: true });

    this.debouncedCreateArchive = debounce(() => {
      // Background work observes the rejection. Foreground callers still await the shared promise.
      void this.startArchive().catch(() => {});
    }, this.archiveDebounceTime);

    if (options.watchFiles !== false) {
      this.initFileWatcher();
    }
  }

  public static getInstance() {
    if (!FileService.instance) {
      FileService.instance = new FileService();
    }
    return FileService.instance;
  }

  private scheduleArchiveCreation() {
    this.archiveDirty = true;
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

    this.fileWatcher
      .on("add", () => this.scheduleArchiveCreation())
      .on("unlink", () => this.scheduleArchiveCreation())
      .on("addDir", () => this.scheduleArchiveCreation())
      .on("unlinkDir", () => this.scheduleArchiveCreation())
      .on("error", (error) => {
        console.error("[FileService] File watcher failed", { code: getArchiveErrorCode(error) });
      })
      .on("ready", () => {
        console.log("[FileService] Initial scan complete. Ready for changes.");
        this.scheduleArchiveCreation();
      });
  }

  private getSafeFilePath(relativePath: string) {
    const resolvedPath = resolve(this.baseFilesPath, relativePath);
    if (
      !resolvedPath.startsWith(this.baseFilesPath + path.sep) &&
      resolvedPath !== this.baseFilesPath
    ) {
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
    const parentDir = path.dirname(safeFilePath);
    await fs.promises.mkdir(parentDir, { recursive: true });

    try {
      await fs.promises.writeFile(safeFilePath, stream);
      const stats = await fs.promises.stat(safeFilePath);
      const file: File = {
        size: stats.size,
        lastModified: stats.mtime,
      };
      console.log(`File saved: ${safeFilePath}, Size: ${file.size}`);
      this.scheduleArchiveCreation();
      return { ...file, path: safeFilePath };
    } catch (error) {
      console.error(`[FileService] Error saving file ${safeFilePath}:`, error);

      try {
        if (await this.exists(safeFilePath)) {
          await fs.promises.unlink(safeFilePath);
        }
      } catch (cleanupErr) {
        console.error(
          `[FileService] Failed to cleanup file ${safeFilePath} after save error:`,
          cleanupErr,
        );
      }
      throw error;
    }
  }

  public async downloadFile({
    filePath,
  }: {
    filePath: string;
  }): Promise<{ stream: Readable } & File> {
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

  public async getFile({ filePath }: { filePath: string }): Promise<File> {
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

  public async listFiles(): Promise<Array<{ path: string } & File>> {
    await fs.promises.mkdir(this.baseFilesPath, { recursive: true });

    const allFiles: Array<{ path: string } & File> = [];

    const collectFilesRecursively = async (currentDir: string) => {
      try {
        const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          const entryPath = path.join(currentDir, entry.name);
          if (entry.isFile()) {
            try {
              const stats = await fs.promises.stat(entryPath);
              allFiles.push({
                path: entryPath,
                size: stats.size,
                lastModified: stats.mtime,
              });
            } catch (statError) {
              console.error(
                `[FileService] Error getting stats for file ${entryPath} during listFiles:`,
                statError,
              );
            }
          } else if (entry.isDirectory()) {
            await collectFilesRecursively(entryPath);
          }
        }
      } catch (readDirError) {
        console.error(
          `[FileService] Error reading directory ${currentDir} during listFiles:`,
          readDirError,
        );
      }
    };

    try {
      await collectFilesRecursively(this.baseFilesPath);
      allFiles.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
      return allFiles;
    } catch (error) {
      console.error(
        `[FileService] Error listing files recursively from ${this.baseFilesPath}:`,
        error,
      );
      return [];
    }
  }

  public async deleteFile({ filePath }: { filePath: string }): Promise<void> {
    await fs.promises.mkdir(this.baseFilesPath, { recursive: true });
    const safeFilePath = this.getSafeFilePath(filePath);

    if (!(await this.exists(safeFilePath))) {
      console.log(
        `[FileService] File ${safeFilePath} not found on disk during delete operation. Skipping.`,
      );
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
      this.scheduleArchiveCreation();
    } catch (unlinkError) {
      console.error(`Error unlinking file ${safeFilePath}:`, unlinkError);
      throw unlinkError;
    }

    return;
  }

  public async cleanupFiles(): Promise<void> {
    console.log(`[FileService cleanupFiles] Starting cleanup for directory: ${this.baseFilesPath}`);

    this.debouncedCreateArchive.cancel();
    await this.waitForArchiveToFinish();

    try {
      const archivePath = path.join(this.prebuiltArchiveDir, "files.zip");
      if (fs.existsSync(archivePath)) {
        await fs.promises.unlink(archivePath);
        console.log(`[FileService cleanupFiles] Deleted archive file: ${archivePath}`);
      }

      const archiveDir = await fs.promises.readdir(this.prebuiltArchiveDir).catch(() => []);
      for (const file of archiveDir) {
        if (file.startsWith("files-") && file.endsWith(".zip.tmp")) {
          const tempFilePath = path.join(this.prebuiltArchiveDir, file);
          await fs.promises.unlink(tempFilePath).catch((err) => {
            console.error(
              `[FileService cleanupFiles] Error deleting temp archive ${tempFilePath}:`,
              err,
            );
          });
        }
      }
    } catch (err: any) {
      console.error(`[FileService cleanupFiles] Error cleaning up archive files:`, err);
    }

    try {
      const files = await fs.promises.readdir(this.baseFilesPath);
      for (const file of files) {
        await fs.promises.rm(path.join(this.baseFilesPath, file), {
          recursive: true,
          force: true,
        });
      }
      console.log(
        `[FileService cleanupFiles] Cleared contents of directory: ${this.baseFilesPath}`,
      );
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        console.error(
          `[FileService cleanupFiles] Error cleaning directory ${this.baseFilesPath}:`,
          err,
        );
      }
    }
    console.log(`[FileService cleanupFiles] Files cleaned. Creating empty archive.`);
    this.scheduleArchiveCreation();
  }

  public getBaseFilesPath(): string {
    return this.baseFilesPath;
  }

  public async getPrebuiltArchivePath(): Promise<string> {
    this.debouncedCreateArchive.cancel();

    while (this.currentArchivePromise || this.archiveDirty) {
      await (this.currentArchivePromise ?? this.startArchive());
      this.debouncedCreateArchive.cancel();
    }

    return this.prebuiltArchivePath;
  }

  private async waitForArchiveToFinish(): Promise<void> {
    if (!this.currentArchivePromise) return;

    try {
      await this.currentArchivePromise;
    } catch (err) {
      console.warn("[FileService cleanupFiles] Archive in progress failed before cleanup", {
        code: getArchiveErrorCode(err),
      });
    }
  }

  private startArchive(): Promise<void> {
    if (this.currentArchivePromise) {
      return this.currentArchivePromise;
    }

    this.archiveDirty = false;
    this.currentArchivePromise = this.buildArchive()
      .catch((error: unknown) => {
        this.archiveDirty = true;
        console.error("[FileService] Archive build failed", { code: getArchiveErrorCode(error) });
        throw error;
      })
      .finally(() => {
        this.currentArchivePromise = null;
      });

    return this.currentArchivePromise;
  }

  private async buildArchive(): Promise<void> {
    await fs.promises.mkdir(this.prebuiltArchiveDir, { recursive: true });
    const stagingPath = path.join(this.prebuiltArchiveDir, `files-${randomUUID()}.zip.tmp`);
    const archive = archiver("zip", { zlib: { level: 9 } });
    const output = fs.createWriteStream(stagingPath, { flags: "wx" });
    let ownsStagingFile = false;
    output.once("open", () => {
      ownsStagingFile = true;
    });

    try {
      await this.writeArchive(archive, output);
      await fs.promises.rename(stagingPath, this.prebuiltArchivePath);
      ownsStagingFile = false;
    } finally {
      if (ownsStagingFile) {
        try {
          await fs.promises.unlink(stagingPath);
        } catch (error) {
          const code = getArchiveErrorCode(error);
          if (code !== "ENOENT") {
            console.warn("[FileService] Archive staging cleanup failed", { code });
          }
        }
      }
    }
  }

  private async writeArchive(archive: archiver.Archiver, output: fs.WriteStream): Promise<void> {
    const closed = new Promise<void>((resolve) => output.once("close", resolve));
    const abort = new AbortController();
    const writing = pipeline(archive, output);
    const entries = this.appendArchiveDirectory(archive, this.baseFilesPath, abort.signal);
    const finalizing = entries.then(() => archive.finalize());

    try {
      await Promise.all([writing, finalizing]);
    } catch (error) {
      abort.abort();
      try {
        archive.abort();
      } catch (abortError) {
        console.warn("[FileService] Archive abort failed", {
          code: getArchiveErrorCode(abortError),
        });
      }
      archive.destroy();
      output.destroy();

      // Archiver may leave finalize() pending after abort. Its rejection is already observed.
      // Wait for the owned input and output streams to close before removing the staging file.
      await Promise.allSettled([entries, writing]);
      throw error;
    } finally {
      await closed;
    }
  }

  private async appendArchiveDirectory(
    archive: archiver.Archiver,
    directory: string,
    signal: AbortSignal,
  ): Promise<void> {
    let names: string[];
    try {
      names = await fs.promises.readdir(directory);
    } catch (error) {
      const code = getArchiveErrorCode(error);
      if (code === "ENOENT" || code === "ENOTDIR") return;
      throw error;
    }

    for (const name of names) {
      signal.throwIfAborted();
      const filePath = path.join(directory, name);
      const stats = await fs.promises.lstat(filePath).catch((error: unknown) => {
        if (getArchiveErrorCode(error) === "ENOENT") return undefined;
        throw error;
      });
      if (!stats) continue;

      const metadata = { name: path.relative(this.baseFilesPath, filePath), stats };
      if (stats.isFile()) {
        await this.appendArchiveFile(archive, filePath, metadata, signal);
      } else if (stats.isDirectory()) {
        await this.appendArchiveEntry(archive, { ...metadata, name: metadata.name + "/" }, signal);
        await this.appendArchiveDirectory(archive, filePath, signal);
      } else if (stats.isSymbolicLink()) {
        const target = await fs.promises.readlink(filePath);
        const link = {
          ...metadata,
          type: "symlink",
          linkname: path.relative(directory, path.resolve(directory, target)),
        };
        await this.appendArchiveEntry(archive, link, signal);
      }
    }
  }

  private async appendArchiveEntry(
    archive: archiver.Archiver,
    metadata: archiver.EntryData,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    await Promise.all([
      once(archive, "entry", { signal }),
      Promise.resolve().then(() => archive.append(Buffer.alloc(0), metadata)),
    ]);
  }

  private async appendArchiveFile(
    archive: archiver.Archiver,
    filePath: string,
    metadata: archiver.EntryData,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    // Own the input stream so output failure can interrupt a backpressured file read.
    const input = fs.createReadStream(filePath, { signal });
    const closed = new Promise<void>((resolve) => input.once("close", resolve));

    try {
      await Promise.all([
        once(archive, "entry", { signal }),
        finished(input),
        Promise.resolve().then(() => archive.append(input, metadata)),
      ]);
    } finally {
      input.destroy();
      await closed;
    }
  }
}
