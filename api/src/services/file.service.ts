import archiver from "archiver";
import chokidar, { FSWatcher } from "chokidar";
import { randomUUID } from "crypto";
import fs from "fs";
import type { DebouncedFunc } from "lodash-es";
import { debounce } from "lodash-es";
import { tmpdir } from "os";
import path, { resolve } from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { env } from "../env.js";

const UPLOAD_TEMP_PREFIX = ".steel-upload-";

// Crash orphans older than this are safe to GC: staging writes stream for
// well under this in practice, so fresher files may still be live uploads.
const STALE_UPLOAD_MS = 60 * 60 * 1000;

interface File {
  size: number;
  lastModified: Date;
}

export class FileQuotaExceededError extends Error {
  readonly currentBytes: number;
  readonly incomingBytes: number;
  readonly limitBytes: number;

  constructor(currentBytes: number, incomingBytes: number, limitBytes: number) {
    super(
      `File storage quota exceeded: storing ${incomingBytes} more bytes would exceed the limit of ${limitBytes} bytes (currently using ${currentBytes} bytes)`,
    );
    this.name = "FileQuotaExceededError";
    this.currentBytes = currentBytes;
    this.incomingBytes = incomingBytes;
    this.limitBytes = limitBytes;
  }
}

export interface FileServiceOptions {
  baseFilesPath?: string;
  prebuiltArchiveDir?: string;
  watchFiles?: boolean;
  maxSizeBytes?: number;
}

function normalizeQuota(v: number | null | undefined): number | null {
  if (v === undefined || v === null) return null;
  if (!Number.isFinite(v) || v < 0) throw new RangeError(`Invalid maxSizeBytes: ${v}`);
  return v;
}

export class FileService {
  private baseFilesPath: string;
  private fileWatcher: FSWatcher | null = null;
  private static instance: FileService | null = null;
  private prebuiltArchiveDir: string;
  private prebuiltArchivePath: string;
  private isArchiving: boolean = false;
  private currentArchivePromise: Promise<string | null> | null = null;
  private archiveDirty = true;
  private archiveDebounceTime = 500;
  private debouncedCreateArchive: DebouncedFunc<() => Promise<string | null>>;
  private maxSizeBytes: number | null;
  private inFlightBytes = 0;
  // Cached total of committed regular files under baseFilesPath (bytes).
  // Warmed/reconciled only inside serializeCommit from the commit recheck
  // walk (recheckBase + newSize) so check-then-act stays serialized; the
  // pre-check reads it O(1) + a single stat for the overwrite exclusion.
  // External browser downloads / stray writes drift it until the next
  // successful commit re-walks and reconciles. Archive temps live in a
  // different dir and are never counted.
  private committedBytes = 0;
  private committedBytesReady = false;
  private commitQueue: Promise<void> = Promise.resolve();

  public constructor(options: FileServiceOptions = {}) {
    this.baseFilesPath =
      options.baseFilesPath ??
      (env.NODE_ENV === "development" ? path.join(tmpdir(), "files") : "/files");
    this.prebuiltArchiveDir = options.prebuiltArchiveDir ?? "/tmp/.steel";
    this.prebuiltArchivePath = path.join(this.prebuiltArchiveDir, "files.zip");
    this.maxSizeBytes = normalizeQuota(options.maxSizeBytes ?? null);

    fs.mkdirSync(this.baseFilesPath, { recursive: true });

    const boundCreateArchive = this._createArchive.bind(this);
    this.debouncedCreateArchive = debounce(boundCreateArchive, this.archiveDebounceTime);

    if (options.watchFiles !== false) {
      this.initFileWatcher();
    }

    // Startup orphan sweep: boot async, never blocks construction or the
    // commit queue; never invalidates the archive.
    // NOTE: os.tmpdir() `upload_<uuid>` GC lives in the tmpdir-sweep
    // follow-up (see tmpdir-sweep.split.md), not here.
    void this.sweepStaleUploads().catch((error) => {
      console.error("[FileService sweepStaleUploads] Startup sweep failed:", error);
    });
  }

  /**
   * Singleton accessor with quota reconcile: the first call fixes
   * construction-time state (paths, watcher), but a later call carrying an
   * explicit numeric maxSizeBytes updates the live quota (last-wins). Bare
   * calls — no key (e.g. the file-storage plugin passing `{}` through when
   * unset) — keep the
   * existing quota, so call order between configured and bare callers cannot
   * silently drop (or resurrect) the limit. Non-numeric values (including
   * null, which FileServiceOptions does not accept) never clobber.
   *
   * Mid-flight mutation is last-wins with no draining: configure once at boot.
   */
  public static getInstance(options: FileServiceOptions = {}) {
    if (!FileService.instance) {
      FileService.instance = new FileService(options);
    } else if (typeof options.maxSizeBytes === "number") {
      FileService.instance.maxSizeBytes = normalizeQuota(options.maxSizeBytes);
    }
    return FileService.instance;
  }

  private async handleFileAdd(filePath: string) {
    console.log(`[FileService] File added detected: ${filePath}`);
    this.scheduleArchiveCreation();
  }

  private handleFileDelete(filePath: string) {
    console.log(`[FileService] File deleted detected: ${filePath}`);
    this.scheduleArchiveCreation();
  }

  private handleDirChange(filePath: string) {
    console.log(`[FileService] Directory change detected: ${filePath}`);
    this.scheduleArchiveCreation();
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

    console.log(`[FileService] File watcher initialized for ${this.baseFilesPath}`);

    this.fileWatcher
      .on("add", (filePath) => this.handleFileAdd(filePath))
      .on("unlink", (filePath) => this.handleFileDelete(filePath))
      .on("addDir", (filePath) => this.handleDirChange(filePath))
      .on("unlinkDir", (filePath) => this.handleDirChange(filePath))
      .on("error", (error) => console.error(`Watcher error: ${error}`))
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

  private checkQuota(currentBytes: number, incomingBytes: number) {
    if (this.maxSizeBytes !== null && currentBytes + incomingBytes > this.maxSizeBytes) {
      throw new FileQuotaExceededError(currentBytes, incomingBytes, this.maxSizeBytes);
    }
  }

  private async getUsedBytes(excludedPath: string): Promise<number> {
    if (this.maxSizeBytes === null) {
      return 0;
    }
    return this.scanUsedBytesStrict(excludedPath);
  }

  /**
   * Strict file enumeration for quota and archive: same counting parity as
   * listFiles (skips symlinks, non-files, staging temps) but fail-closed on
   * I/O errors. Only ENOENT (concurrent delete/rename race) is benign and
   * skipped; EACCES/EPERM/ELOOP/EMFILE/EIO and any other error propagate so
   * quota cannot undercount to 0/partial and archives cannot go silently
   * incomplete. listFiles stays lenient for the listing endpoint.
   */
  private async scanFilesStrict(): Promise<Array<{ path: string } & File>> {
    await fs.promises.mkdir(this.baseFilesPath, { recursive: true });

    const allFiles: Array<{ path: string } & File> = [];

    const collectStrictRecursively = async (currentDir: string): Promise<void> => {
      let entries: import("fs").Dirent[];
      try {
        entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      } catch (readDirError: any) {
        if (readDirError?.code === "ENOENT") {
          return;
        }
        throw readDirError;
      }
      for (const entry of entries) {
        const entryPath = path.join(currentDir, entry.name);
        if (entry.isFile() && !entry.name.startsWith(UPLOAD_TEMP_PREFIX)) {
          let stats: import("fs").Stats;
          try {
            stats = await fs.promises.lstat(entryPath);
          } catch (statError: any) {
            if (statError?.code === "ENOENT") {
              continue;
            }
            throw statError;
          }
          if (!stats.isFile()) {
            continue;
          }
          allFiles.push({
            path: entryPath,
            size: stats.size,
            lastModified: stats.mtime,
          });
        } else if (entry.isDirectory()) {
          await collectStrictRecursively(entryPath);
        }
      }
    };

    await collectStrictRecursively(this.baseFilesPath);
    allFiles.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
    return allFiles;
  }

  /**
   * Strict quota input: fail-closed byte total excluding the overwrite target.
   * Throws on EACCES/EPERM/ELOOP/EMFILE/EIO (any non-ENOENT walk error) so
   * cold pre-check and commit recheck never check-then-act on an undercount,
   * and the committedBytes reconcile never caches a poisoned total.
   */
  private async scanUsedBytesStrict(excludedPath: string): Promise<number> {
    const files = await this.scanFilesStrict();
    return files.reduce(
      (total, file) => (file.path === excludedPath ? total : total + file.size),
      0,
    );
  }

  /**
   * Single-stat size of a committed file for the quota pre-check, with the
   * same counting parity as listFiles: symlinks, non-files, and staging
   * temps never count (0). Missing paths (new files) are 0. ENOTDIR/EEXIST
   * mean the path cannot be a counted regular file, so 0 — later commit
   * asserts still enforce path validity.
   */
  private async getRegularFileSize(filePath: string): Promise<number> {
    let entry;
    try {
      entry = await fs.promises.lstat(filePath);
    } catch (error: any) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR" || error?.code === "EEXIST") {
        return 0;
      }
      throw error;
    }
    if (!entry || entry.isSymbolicLink() || !entry.isFile()) {
      return 0;
    }
    if (path.basename(filePath).startsWith(UPLOAD_TEMP_PREFIX)) {
      return 0;
    }
    return entry.size;
  }

  /**
   * O(1) pre-check usage (cached total minus the overwritten file), warmed
   * by the commit recheck walk. Cold cache falls back to one full walk
   * without warming here — the counter is only ever mutated inside
   * serializeCommit. Null quota returns 0 with no I/O.
   */
  private async getPreCheckUsedBytes(excludedPath: string): Promise<number> {
    if (this.maxSizeBytes === null) {
      return 0;
    }
    if (!this.committedBytesReady) {
      return this.getUsedBytes(excludedPath);
    }
    const oldSize = await this.getRegularFileSize(excludedPath);
    const used = this.committedBytes - oldSize;
    if (used < 0) {
      return this.getUsedBytes(excludedPath);
    }
    return used;
  }

  /**
   * Removes orphaned staging files left by crashes between pipeline and
   * rename. Staging files are invisible to listFiles/quota/archive and the
   * watcher ignores dotfiles, so without this they leak uncounted disk.
   * Only regular files older than STALE_UPLOAD_MS are removed to preserve
   * live uploads; symlinked dirs are skipped and never followed; ENOENT
   * races are tolerated; never touches the archive.
   */
  private async sweepStaleUploads(): Promise<void> {
    const walk = async (dir: string): Promise<void> => {
      let entries: import("fs").Dirent[];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch (error) {
        console.warn(`[FileService sweepStaleUploads] Failed to read ${dir}:`, error);
        return;
      }
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        try {
          if (entry.isDirectory()) {
            await walk(fullPath);
          } else if (entry.isFile() && entry.name.startsWith(UPLOAD_TEMP_PREFIX)) {
            const stats = await fs.promises.lstat(fullPath).catch(() => null);
            if (!stats || !stats.isFile()) {
              continue;
            }
            if (Date.now() - stats.mtimeMs < STALE_UPLOAD_MS) {
              continue;
            }
            try {
              await fs.promises.rm(fullPath, { force: true });
            } catch (rmError: any) {
              if (rmError?.code !== "ENOENT") {
                console.error(
                  `[FileService sweepStaleUploads] Failed to remove ${fullPath}:`,
                  rmError,
                );
              }
              continue;
            }
            console.log(`[FileService sweepStaleUploads] Removed stale upload ${fullPath}`);
          }
        } catch (error: any) {
          if (error?.code === "ENOENT") {
            continue;
          }
        }
      }
    };
    await walk(this.baseFilesPath);
  }

  /**
   * Serializes commit-phase mutations (save rename, single delete, delete-all)
   * so their check-then-act sequences cannot interleave: without this, a
   * cleanup could run between a save's quota check and its rename (ENOENT on
   * commit or a resurrected file), and a delete could land between another
   * delete's existence check and its unlink (double-delete 500).
   *
   * Staging writes intentionally stay outside this queue; only the commit
   * (quota recheck + rename) is serialized with deletes.
   *
   * Deletes intentionally don't adjust inFlightBytes: over-counting held bytes
   * is benign (quota stays conservative until in-flight uploads settle) and
   * avoids coupling the delete path to upload bookkeeping.
   */
  private serializeCommit(task: () => Promise<void>): Promise<void> {
    const result = this.commitQueue.then(task);
    this.commitQueue = result.catch(() => {});
    return result;
  }

  public async saveFile({
    filePath,
    stream,
    size,
  }: {
    filePath: string;
    stream: Readable;
    size?: number;
  }): Promise<File & { path: string }> {
    let tempFilePath: string | null = null;
    let receivedBytes = 0;
    let heldBytes = 0;
    const releaseHeldBytes = () => {
      this.inFlightBytes -= heldBytes;
      heldBytes = 0;
    };

    try {
      await fs.promises.mkdir(this.baseFilesPath, { recursive: true });

      const safeFilePath = this.getSafeFilePath(filePath);
      if (
        safeFilePath === this.baseFilesPath ||
        path.basename(safeFilePath).startsWith(UPLOAD_TEMP_PREFIX)
      ) {
        throw new Error("Invalid path");
      }
      const parentDir = path.dirname(safeFilePath);
      await fs.promises.mkdir(parentDir, { recursive: true });

      const usedBytes = await this.getPreCheckUsedBytes(safeFilePath);
      const committedAtStart = this.committedBytesReady ? this.committedBytes : null;
      const incomingHint = Number.isFinite(size) && (size as number) >= 0 ? (size as number) : 0;
      this.checkQuota(usedBytes + this.inFlightBytes, incomingHint);

      const quotaGuard = new Transform({
        transform: (chunk: Buffer, _encoding, callback) => {
          try {
            const delta =
              committedAtStart !== null && this.committedBytesReady
                ? Math.max(0, this.committedBytes - committedAtStart)
                : 0;
            this.checkQuota(
              usedBytes + delta + this.inFlightBytes - heldBytes,
              receivedBytes + chunk.length,
            );
          } catch (error) {
            releaseHeldBytes();
            callback(error as Error);
            return;
          }
          receivedBytes += chunk.length;
          heldBytes += chunk.length;
          this.inFlightBytes += chunk.length;
          callback(null, chunk);
        },
      });

      const stagingPath = path.join(parentDir, `${UPLOAD_TEMP_PREFIX}${randomUUID()}`);
      tempFilePath = stagingPath;
      await pipeline(stream, quotaGuard, fs.createWriteStream(stagingPath));

      // The post-commit stat lives inside the queue so a queued delete cannot
      // slip between the rename and the stat.
      const file: File = { size: 0, lastModified: new Date(0) };
      // Staging writes above stay outside the queue; only this commit is
      // serialized with deletes (see serializeCommit).
      await this.serializeCommit(async () => {
        // Lazy GC for crash orphans: grace-protected, never fails the commit,
        // never invalidates the archive. Tmpdir orphans are startup-only (see
        // constructor) so commits never scan the shared tmpdir.
        await this.sweepStaleUploads().catch(() => {});
        // TOCTOU + concurrent-save safety net: always a fresh walk, never
        // removed or replaced by the cached pre-check. Its result also
        // reconciles the cache (external downloads / stray writes drift it
        // between commits). Excludes the target so overwrites count as delta.
        const recheckBase = await this.getUsedBytes(safeFilePath);
        this.checkQuota(recheckBase, receivedBytes);
        try {
          await fs.promises.rename(stagingPath, safeFilePath);
        } catch (renameError: any) {
          if (renameError?.code !== "ENOENT") throw renameError;
          if (!(await this.exists(stagingPath))) {
            // A serialized delete-all removed the staging file before this
            // commit ran: the upload loses to the delete. Surface a clean
            // error instead of raw ENOENT.
            throw new Error(`Upload target was removed during save: ${safeFilePath}`);
          }
          // The parent dir was removed concurrently but the staged upload
          // survived; recreate it and retry once.
          await fs.promises.mkdir(parentDir, { recursive: true });
          try {
            await fs.promises.rename(stagingPath, safeFilePath);
          } catch (retryError: any) {
            if (retryError?.code === "ENOENT") {
              throw new Error(`Upload target was removed during save: ${safeFilePath}`);
            }
            throw retryError;
          }
        }
        const stats = await fs.promises.stat(safeFilePath);
        file.size = stats.size;
        file.lastModified = stats.mtime;
        if (this.maxSizeBytes !== null) {
          // Success-only: rejected overwrites leave the counter unchanged.
          // recheckBase excludes the target, so + new size is the overwrite
          // delta and simultaneously reconciles external drift. No extra I/O.
          this.committedBytes = recheckBase + stats.size;
          this.committedBytesReady = true;
        }
        releaseHeldBytes();
      });
      tempFilePath = null;

      console.log(`File saved: ${safeFilePath}, Size: ${file.size}`);
      this.scheduleArchiveCreation();
      return { ...file, path: safeFilePath };
    } catch (error) {
      releaseHeldBytes();
      stream.destroy();
      console.error(`[FileService] Error saving file ${filePath}:`, error);

      if (tempFilePath) {
        await fs.promises.rm(tempFilePath, { force: true }).catch((cleanupErr) => {
          console.error(
            `[FileService] Failed to remove temp file ${tempFilePath} after save error:`,
            cleanupErr,
          );
        });
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
    if (
      safeFilePath === this.baseFilesPath ||
      path.basename(safeFilePath).startsWith(UPLOAD_TEMP_PREFIX)
    ) {
      throw new Error("Invalid path");
    }
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
      if (error?.message === "Invalid path") {
        throw error;
      }
      if (error?.code === "ELOOP" || error?.code === "EMLINK") {
        throw new Error("Invalid path");
      }
      if (error?.code === "ENOENT" || error?.message?.startsWith("File not found:")) {
        throw new Error(`File not found: ${safeFilePath}`);
      }
      if (error?.message?.startsWith("Requested path is not a file:")) {
        console.warn(`[FileService] Path is not a file ${safeFilePath} for download.`);
      } else {
        console.error(`[FileService] Error accessing file ${safeFilePath} for download:`, error);
      }
      throw new Error(`File not found or inaccessible: ${safeFilePath}`);
    }
  }

  public async getFile({ filePath }: { filePath: string }): Promise<File> {
    await fs.promises.mkdir(this.baseFilesPath, { recursive: true });
    const safeFilePath = this.getSafeFilePath(filePath);
    if (
      safeFilePath === this.baseFilesPath ||
      path.basename(safeFilePath).startsWith(UPLOAD_TEMP_PREFIX)
    ) {
      throw new Error("Invalid path");
    }
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
      if (error?.message === "Invalid path") {
        throw error;
      }
      if (error?.code === "ELOOP" || error?.code === "EMLINK") {
        throw new Error("Invalid path");
      }
      if (error?.code === "ENOENT" || error?.message?.startsWith("File not found:")) {
        throw new Error(`File not found: ${safeFilePath}`);
      }
      if (error?.message?.startsWith("Requested path is not a file:")) {
        console.warn(`[FileService] Path is not a file ${safeFilePath} for getFile.`);
      } else {
        console.error(`[FileService] Error accessing file ${safeFilePath} for getFile:`, error);
      }
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
          if (entry.isFile() && !entry.name.startsWith(UPLOAD_TEMP_PREFIX)) {
            try {
              const stats = await fs.promises.lstat(entryPath);
              if (!stats.isFile()) {
                continue;
              }
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
    if (
      safeFilePath === this.baseFilesPath ||
      path.basename(safeFilePath).startsWith(UPLOAD_TEMP_PREFIX)
    ) {
      throw new Error("Invalid path");
    }

    // Serialized with save commits and cleanups so this delete cannot land
    // between another operation's check and its act (or vice versa).
    await this.serializeCommit(async () => {
      let entry;
      try {
        entry = await fs.promises.lstat(safeFilePath);
      } catch (statError: any) {
        if (statError?.code === "ENOENT") {
          console.log(
            `[FileService] File ${safeFilePath} not found on disk during delete operation. Skipping.`,
          );
          return;
        }
        if (statError?.code === "ENOTDIR" || statError?.code === "EEXIST") {
          throw new Error("Invalid path");
        }
        throw statError;
      }
      if (!entry.isFile()) {
        console.warn(`[FileService] Path ${safeFilePath} is not a file. Skipping delete.`);
        return;
      }
      try {
        await fs.promises.unlink(safeFilePath);
      } catch (unlinkError: any) {
        if (unlinkError?.code === "ENOENT") {
          // Lost a race with a concurrent delete/cleanup; already gone.
          console.log(
            `[FileService] File ${safeFilePath} not found on disk during delete operation. Skipping.`,
          );
          return;
        }
        if (unlinkError?.code === "ENOTDIR" || unlinkError?.code === "EEXIST") {
          throw new Error("Invalid path");
        }
        console.error(`Error unlinking file ${safeFilePath}:`, unlinkError);
        throw unlinkError;
      }
      console.log(`[FileService] File deleted: ${safeFilePath}`);
      // Decrement only on successful unlink with no extra I/O (entry.size is
      // already known). ENOENT / non-file early returns above leave the
      // counter unchanged, so double-deletes are idempotent.
      if (this.committedBytesReady) {
        this.committedBytes -= entry.size;
        if (this.committedBytes < 0) {
          this.committedBytes = 0;
        }
      }
      this.scheduleArchiveCreation();
    });

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

    // Serialized with save commits and single deletes so no commit's
    // quota-check/rename can slip between this listing and its removals
    // (which would resurrect a file after delete-all) and no delete can
    // interleave mid-cleanup. Archive coordination above/below is unchanged.
    try {
      await this.serializeCommit(async () => {
        const files = await fs.promises.readdir(this.baseFilesPath);
        for (const file of files) {
          await fs.promises.rm(path.join(this.baseFilesPath, file), {
            recursive: true,
            force: true,
          });
        }
        // The directory was just emptied: zero with no extra I/O. External
        // writes after this reconcile on the next successful save commit.
        this.committedBytes = 0;
        this.committedBytesReady = true;
      });
      console.log(
        `[FileService cleanupFiles] Cleared contents of directory: ${this.baseFilesPath}`,
      );
    } catch (err: any) {
      if (err?.code !== "ENOENT") {
        console.error(
          `[FileService cleanupFiles] Error cleaning directory ${this.baseFilesPath}:`,
          err,
        );
      } else {
        this.committedBytes = 0;
        this.committedBytesReady = true;
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
      await (this.currentArchivePromise ?? this._createArchive());
      this.debouncedCreateArchive.cancel();
    }

    return this.prebuiltArchivePath;
  }

  private async waitForArchiveToFinish(): Promise<void> {
    if (!this.currentArchivePromise) return;

    try {
      await this.currentArchivePromise;
    } catch (err) {
      console.warn("[FileService cleanupFiles] Archive in progress failed before cleanup:", err);
    }
  }

  private _createArchive(): Promise<string | null> {
    if (this.currentArchivePromise) {
      return this.currentArchivePromise;
    }

    this.archiveDirty = false;
    const archivePromise = new Promise<string | null>(async (resolvePromise, rejectPromise) => {
      if (this.isArchiving) {
        console.warn(
          `[_createArchive] Warning: Archiving process initiated while another is already in progress. This might lead to conflicts if not handled by caller.`,
        );
      }

      this.isArchiving = true;
      console.log(`[_createArchive] Starting archive creation`);

      const tempArchivePath = path.join(this.prebuiltArchiveDir, `files-${Date.now()}.zip.tmp`);
      const finalArchivePath = path.join(this.prebuiltArchiveDir, "files.zip");

      try {
        await fs.promises.mkdir(this.prebuiltArchiveDir, { recursive: true });
      } catch (mkdirError) {
        console.error(
          `[_createArchive] Error creating archive directory ${this.prebuiltArchiveDir}:`,
          mkdirError,
        );
        this.isArchiving = false;
        return rejectPromise(mkdirError);
      }

      const output = fs.createWriteStream(tempArchivePath);
      const archive = archiver("zip", { zlib: { level: 9 } });
      let errorOccurredStream = false;

      const operationCleanup = async (
        success: boolean,
        archivePath: string | null = null,
        error?: any,
      ) => {
        this.isArchiving = false;

        if (!success && tempArchivePath && (await this.exists(tempArchivePath))) {
          try {
            await fs.promises.unlink(tempArchivePath);
            console.log("[_createArchive] Cleaned up temporary archive file due to error.");
          } catch (unlinkErr) {
            console.error(
              "[_createArchive] Failed to clean up temp archive file after error:",
              unlinkErr,
            );
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
          console.log(
            "[_createArchive] Output stream closed after an error was emitted and handled.",
          );
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
          console.warn(
            `[_createArchive] Base directory ${this.baseFilesPath} does not exist. Creating empty archive.`,
          );
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

    this.currentArchivePromise = archivePromise
      .catch((error) => {
        this.archiveDirty = true;
        throw error;
      })
      .finally(() => {
        this.currentArchivePromise = null;
      });

    return this.currentArchivePromise;
  }
}
