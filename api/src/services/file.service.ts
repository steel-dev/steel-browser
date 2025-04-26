import chokidar, { FSWatcher } from "chokidar";
import { createHash } from "crypto";
import { FastifyBaseLogger } from "fastify";
import fs from "fs";
import { rename, unlink } from "fs/promises";
import mime from "mime-types";
import path from "path";
import { Readable } from "stream";
import { v4 as uuidv4 } from "uuid";
import { env } from "../env.js";

interface File {
  name: string;
  size: number;
  contentType: string;
  createdAt: Date;
  updatedAt: Date;
  checksum: string;
  path: string;
  metadata?: Record<string, any>;
}

export class FileService {
  private logger: FastifyBaseLogger;
  private baseDownloadPath: string;
  private fileMap: Map<string, Map<string, File>> = new Map();
  private fileWatcher: FSWatcher | null = null;
  private processingFiles: Set<string> = new Set();

  constructor(_config: {}, logger: FastifyBaseLogger) {
    this.logger = logger;
    this.baseDownloadPath = env.NODE_ENV === "development" ? path.join(process.cwd(), "/files") : "/files";
    fs.mkdirSync(this.baseDownloadPath, { recursive: true });
    this.fileMap = new Map();
    this.initFileWatcher();
  }

  private initFileWatcher() {
    this.fileWatcher = chokidar.watch(this.baseDownloadPath, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    this.fileWatcher.on("add", async (filePath) => {
      if (this.processingFiles.has(filePath)) {
        return;
      }

      try {
        // Check if the file is in a session directory
        const relativePath = path.relative(this.baseDownloadPath, filePath);
        const parts = relativePath.split(path.sep);

        if (parts.length < 2) {
          return; // Not in a session directory
        }

        const sessionId = parts[0];
        const fileName = parts[parts.length - 1];

        // Skip if already in the file map
        if (this.isFileAlreadyTracked(sessionId, filePath)) {
          return;
        }

        this.logger.info(`Detected new file: ${filePath} in session ${sessionId}`);

        // Calculate checksum
        const checksum = await this.calculateChecksum(filePath);

        // Add to file map
        if (!this.fileMap.has(sessionId)) {
          this.fileMap.set(sessionId, new Map());
        }

        const stats = await fs.promises.stat(filePath);
        const currentDate = new Date();
        const id = uuidv4();

        const file: File = {
          name: fileName,
          size: stats.size,
          contentType: mime.lookup(fileName) || "application/octet-stream",
          createdAt: currentDate,
          updatedAt: currentDate,
          checksum,
          path: filePath,
        };

        this.fileMap.get(sessionId)!.set(id, file);
        this.logger.info(`Added file ${fileName} to session ${sessionId} with ID ${id}`);
      } catch (error) {
        this.logger.error(`Error processing file ${filePath}: ${error}`);
      }
    });

    this.logger.info(`File watcher initialized for ${this.baseDownloadPath}`);
  }

  private async calculateChecksum(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash("sha256");
      const stream = fs.createReadStream(filePath);

      stream.on("error", reject);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
    });
  }

  private isFileAlreadyTracked(sessionId: string, filePath: string): boolean {
    const sessionFiles = this.fileMap.get(sessionId);
    if (!sessionFiles) return false;

    for (const file of sessionFiles.values()) {
      if (file.path === filePath) {
        return true;
      }
    }

    return false;
  }

  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    await fs.promises.mkdir(dirPath, { recursive: true });
  }

  private sanitizeId(id: string): string {
    return path.basename(id);
  }

  private getSessionPath(sessionId: string): string {
    return path.join(this.baseDownloadPath, this.sanitizeId(sessionId));
  }

  private buildFileName(originalName: string, id: string): string {
    const parsed = path.parse(originalName);
    const safeBase = this.sanitizeId(parsed.name);
    const safeExt = parsed.ext;
    return `${safeBase}-${id}${safeExt}`;
  }

  public async getFilePath({ sessionId, name }: { sessionId: string; name: string }): Promise<string> {
    const sessionPath = this.getSessionPath(sessionId);
    await this.ensureDirectoryExists(sessionPath);
    return path.join(sessionPath, this.sanitizeId(name));
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

  public async saveFile(options: {
    sessionId: string;
    filePath: string;
    checksum: string;
    id?: string;
    name?: string;
    contentType?: string;
    metadata?: Record<string, any>;
  }): Promise<{ id: string } & File> {
    const id = options.id || uuidv4();
    let fileName: string;

    if (options.name) {
      fileName = this.buildFileName(options.name, id);
    } else {
      fileName = id;
    }

    const destinationPath = await this.getFilePath({ sessionId: options.sessionId, name: fileName });

    // Mark file as being processed to avoid duplicate processing by watcher
    this.processingFiles.add(destinationPath);

    try {
      await rename(options.filePath, destinationPath);
    } catch (error: any) {
      await unlink(options.filePath);
      console.error(`Error moving file: ${error.message}`);
    } finally {
      // Remove from processing list after a short delay
      setTimeout(() => {
        this.processingFiles.delete(destinationPath);
      }, 1000);
    }

    if (!this.fileMap.has(options.sessionId)) {
      this.fileMap.set(options.sessionId, new Map());
    }

    const currentDate = new Date();

    const file: File = {
      name: options.name || fileName,
      size: (await fs.promises.stat(destinationPath)).size,
      contentType: options.contentType || (options.name && mime.lookup(options.name)) || "application/octet-stream",
      createdAt: currentDate,
      updatedAt: currentDate,
      checksum: options.checksum,
      metadata: options.metadata,
      path: destinationPath,
    };

    this.fileMap.get(options.sessionId)!.set(id, file);

    return {
      id,
      ...file,
    };
  }

  public async getFile({ sessionId, id }: { sessionId: string; id: string }): Promise<{ id: string } & File> {
    const sessionFiles = this.fileMap.get(sessionId);
    if (!sessionFiles) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const file = sessionFiles.get(id);
    if (!file) {
      throw new Error(`File metadata not found: ${id}`);
    }

    if (!(await this.exists(file.path))) {
      throw new Error(`File not found: ${file.path}`);
    }

    return {
      id,
      ...file,
    };
  }

  public async downloadFile({
    sessionId,
    id,
  }: {
    sessionId: string;
    id: string;
  }): Promise<{ id: string; stream: Readable } & File> {
    const sessionFiles = this.fileMap.get(sessionId);
    if (!sessionFiles) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const file = sessionFiles.get(id);
    if (!file) {
      throw new Error(`File metadata not found: ${id}`);
    }

    if (!(await this.exists(file.path))) {
      throw new Error(`File not found: ${file.path}`);
    }

    return {
      id,
      stream: fs.createReadStream(file.path),
      ...file,
    };
  }

  public async listFiles({ sessionId }: { sessionId: string }): Promise<Array<{ id: string } & File>> {
    const sessionItems = this.fileMap.get(sessionId) || new Map();

    return Array.from(sessionItems.entries())
      .map(([id, file]) => ({
        id,
        ...file,
      }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  public async deleteFile({ sessionId, id }: { sessionId: string; id: string }): Promise<{ id: string } & File> {
    const sessionFiles = this.fileMap.get(sessionId);
    if (!sessionFiles) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const file = sessionFiles.get(id);
    if (!file) {
      throw new Error(`File metadata not found: ${id}`);
    }

    if (!(await this.exists(file.path))) {
      throw new Error(`File not found: ${file.path}`);
    }

    await fs.promises.unlink(file.path);

    this.fileMap.get(sessionId)!.delete(id);

    return { id, ...file };
  }

  public async cleanupFiles({ sessionId }: { sessionId: string }): Promise<({ id: string } & File)[]> {
    const sessionPath = this.getSessionPath(sessionId);

    if (!(await this.exists(sessionPath))) {
      return [];
    }

    const files = this.fileMap.get(sessionId);

    if (!files) {
      return [];
    }

    const filesArray = Array.from(files.entries()).map(([id, file]) => ({
      id,
      ...file,
    }));

    await fs.promises.rm(sessionPath, { recursive: true, force: true });
    this.fileMap.delete(sessionId);

    return filesArray;
  }
}
