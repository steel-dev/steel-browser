import chokidar, { FSWatcher } from "chokidar";
import { createHash } from "crypto";
import { FastifyBaseLogger } from "fastify";
import fs from "fs";
import { rename, unlink } from "fs/promises";
import mime from "mime-types";
import path, { relative, resolve } from "path";
import { Readable } from "stream";
import { v4 as uuidv4 } from "uuid";
import { env } from "../env";

interface File {
  size: number;
  lastModified: Date;
  // metadata?: Record<string, any>;
}

export class FileService {
  private db: Map<string, File>;
  private baseFilesPath: string;
  private fileWatcher: FSWatcher | null = null;
  private processingFiles: Set<string> = new Set();
  private static instance: FileService | null = null;
  private constructor() {
    this.db = new Map();
    this.baseFilesPath = env.NODE_ENV === "development" ? path.join(process.cwd(), "/files") : "/files";
    fs.mkdirSync(this.baseFilesPath, { recursive: true });
    // this.initFileWatcher();
  }

  public static getInstance() {
    if (!FileService.instance) {
      FileService.instance = new FileService();
    }
    return FileService.instance;
  }

  // private initFileWatcher() {
  //   this.fileWatcher = chokidar.watch(this.baseFilesPath, {
  //     ignored: /(^|[\/\\])\../, // ignore dotfiles
  //     persistent: true,
  //     ignoreInitial: false,
  //     awaitWriteFinish: {
  //       stabilityThreshold: 100,
  //       pollInterval: 50,
  //     },
  //   });

  //   this.fileWatcher.on("add", async (filePath) => {
  //     if (this.processingFiles.has(filePath)) {
  //       return;
  //     }

  //     try {
  //       // Check if the file is in a session directory
  //       const relativePath = path.relative(this.baseFilesPath, filePath);
  //       const parts = relativePath.split(path.sep);

  //       if (parts.length < 2) {
  //         return; // Not in a session directory
  //       }

  //       const sessionId = parts[0];
  //       const fileName = parts[parts.length - 1];

  //       // Skip if already in the file map
  //       if (this.isFileAlreadyTracked(sessionId, filePath)) {
  //         return;
  //       }

  //       this.logger.info(`Detected new file: ${filePath} in session ${sessionId}`);

  //       // Calculate checksum
  //       const checksum = await this.calculateChecksum(filePath);

  //       // Add to file map
  //       if (!this.fileMap.has(sessionId)) {
  //         this.fileMap.set(sessionId, new Map());
  //       }

  //       const stats = await fs.promises.stat(filePath);
  //       const currentDate = new Date();
  //       const id = uuidv4();

  //       const file: File = {
  //         name: fileName,
  //         size: stats.size,
  //         contentType: mime.lookup(fileName) || "application/octet-stream",
  //         createdAt: currentDate,
  //         updatedAt: currentDate,
  //         checksum,
  //         path: filePath,
  //       };

  //       this.fileMap.get(sessionId)!.set(id, file);
  //       this.logger.info(`Added file ${fileName} to session ${sessionId} with ID ${id}`);
  //     } catch (error) {
  //       this.logger.error(`Error processing file ${filePath}: ${error}`);
  //     }
  //   });

  //   this.logger.info(`File watcher initialized for ${this.baseFilesPath}`);
  // }

  // private isFileAlreadyTracked(sessionId: string, filePath: string): boolean {
  //   const sessionFiles = this.fileMap.get(sessionId);
  //   if (!sessionFiles) return false;

  //   for (const file of sessionFiles.values()) {
  //     if (file.path === filePath) {
  //       return true;
  //     }
  //   }

  //   return false;
  // }

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

    await fs.promises.writeFile(safeFilePath, stream);

    const file: File = {
      size: (await fs.promises.stat(safeFilePath)).size,
      lastModified: (await fs.promises.stat(safeFilePath)).mtime,
    };

    this.db.set(safeFilePath, file);

    return { ...file, path: safeFilePath };
  }

  // public async getFile({ sessionId, id }: { sessionId: string; id: string }): Promise<{ id: string } & File> {
  //   const sessionFiles = this.fileMap.get(sessionId);
  //   if (!sessionFiles) {
  //     throw new Error(`Session not found: ${sessionId}`);
  //   }

  //   const file = sessionFiles.get(id);
  //   if (!file) {
  //     throw new Error(`File metadata not found: ${id}`);
  //   }

  //   if (!(await this.exists(file.path))) {
  //     throw new Error(`File not found: ${file.path}`);
  //   }

  //   return {
  //     id,
  //     ...file,
  //   };
  // }

  public async downloadFile({ filePath }: { filePath: string }): Promise<{ stream: Readable } & File> {
    await fs.promises.mkdir(this.baseFilesPath, { recursive: true });
    const safeFilePath = this.getSafeFilePath(filePath);
    if (!(await this.exists(safeFilePath))) {
      throw new Error(`File not found: ${safeFilePath}`);
    }

    const file = this.db.get(safeFilePath);
    const stream = fs.createReadStream(safeFilePath);

    if (!file) {
      return {
        stream,
        size: (await fs.promises.stat(safeFilePath)).size,
        lastModified: (await fs.promises.stat(safeFilePath)).mtime,
      };
    }

    return {
      stream,
      ...file,
    };
  }

  public async getFile({ sessionId, filePath }: { sessionId: string; filePath: string }): Promise<File> {
    await fs.promises.mkdir(this.baseFilesPath, { recursive: true });
    const safeFilePath = this.getSafeFilePath(filePath);
    if (!(await this.exists(safeFilePath))) {
      throw new Error(`File not found: ${safeFilePath}`);
    }
    const file = this.db.get(safeFilePath)!;
    if (!file) {
      throw new Error(`File not found: ${safeFilePath}`);
    }
    return file;
  }

  public async listFiles({ sessionId }: { sessionId: string }): Promise<Array<{ path: string } & File>> {
    await fs.promises.mkdir(this.baseFilesPath, { recursive: true });
    return Array.from(this.db.entries())
      .map(([path, file]) => ({
        path,
        ...file,
      }))
      .sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
  }

  public async deleteFile({ sessionId, filePath }: { sessionId: string; filePath: string }): Promise<void> {
    await fs.promises.mkdir(this.baseFilesPath, { recursive: true });

    const safeFilePath = this.getSafeFilePath(filePath);

    if (!(await this.exists(safeFilePath))) {
      throw new Error(`File not found: ${safeFilePath}`);
    }

    await fs.promises.unlink(safeFilePath);
    this.db.delete(safeFilePath);

    return;
  }

  public async cleanupFiles(): Promise<void> {
    await fs.promises.rm(this.baseFilesPath, { recursive: true });
    await fs.promises.mkdir(this.baseFilesPath, { recursive: true });
    this.db = new Map();

    return;
  }
}
