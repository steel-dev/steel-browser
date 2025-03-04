import { createHash } from "crypto";
import fs from "fs";
import mime from "mime-types";
import path from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { v4 as uuidv4 } from "uuid";
import { env } from "../env";
import { FastifyBaseLogger } from "fastify";

interface File {
  name: string;
  size: number;
  contentType: string;
  createdAt: Date;
  updatedAt: Date;
  checksum: string;
  metadata?: Record<string, any>;
}

export class FileService {
  private logger: FastifyBaseLogger;
  private baseDownloadPath: string;
  private fileMap: Map<string, Map<string, File>> = new Map();

  constructor(_config: {}, logger: FastifyBaseLogger) {
    this.logger = logger;
    this.baseDownloadPath = env.DOWNLOADS_PATH || path.join(process.cwd(), "downloads");
    fs.mkdirSync(this.baseDownloadPath, { recursive: true });
    this.fileMap = new Map();
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

  private async getFilePath(sessionId: string, fileId: string): Promise<string> {
    const sessionPath = this.getSessionPath(sessionId);
    await this.ensureDirectoryExists(sessionPath);
    return path.join(sessionPath, this.sanitizeId(fileId));
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

  public async saveFile(
    sessionId: string,
    stream: Readable,
    options: { name?: string; contentType?: string; metadata?: Record<string, any> } = {},
  ): Promise<{ id: string } & File> {
    const id = uuidv4();
    const filePath = await this.getFilePath(sessionId, id);

    const hash = createHash("sha256");

    const hashAndPassThrough = new Transform({
      transform(chunk, _encoding, callback) {
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    await pipeline(stream, hashAndPassThrough, fs.createWriteStream(filePath));

    if (!this.fileMap.has(sessionId)) {
      this.fileMap.set(sessionId, new Map());
    }

    const currentDate = new Date();

    const file: File = {
      name: options.name || id,
      size: (await fs.promises.stat(filePath)).size,
      contentType: options.contentType || (options.name && mime.lookup(options.name)) || "application/octet-stream",
      createdAt: currentDate,
      updatedAt: currentDate,
      checksum: hash.digest("hex"),
      metadata: options.metadata,
    };

    this.fileMap.get(sessionId)!.set(id, file);

    return {
      id,
      ...file,
    };
  }

  public async getFile(sessionId: string, fileId: string): Promise<{ id: string } & File> {
    const filePath = await this.getFilePath(sessionId, fileId);

    if (!(await this.exists(filePath))) {
      throw new Error(`File not found: ${filePath}`);
    }

    const file = this.fileMap.get(sessionId)!.get(fileId)!;

    return {
      id: fileId,
      ...file,
    };
  }

  public async downloadFile(sessionId: string, fileId: string): Promise<{ id: string; stream: Readable } & File> {
    const file = this.fileMap.get(sessionId)!.get(fileId)!;

    if (!file) {
      throw new Error(`File not found in session: ${fileId}`);
    }

    const filePath = await this.getFilePath(sessionId, fileId);

    if (!(await this.exists(filePath))) {
      throw new Error(`File not found: ${filePath}`);
    }

    return {
      id: fileId,
      stream: fs.createReadStream(filePath),
      ...file,
    };
  }

  public async listFiles(sessionId: string): Promise<Array<{ id: string } & File>> {
    const sessionItems = this.fileMap.get(sessionId)!;

    if (!sessionItems) {
      return [];
    }

    return Array.from(sessionItems.entries()).map(([id, file]) => ({
      id,
      ...file,
    }));
  }

  public async deleteFile(sessionId: string, fileId: string): Promise<{ id: string } & File> {
    const filePath = await this.getFilePath(sessionId, fileId);

    if (!(await this.exists(filePath))) {
      throw new Error(`File not found: ${filePath}`);
    }

    await fs.promises.unlink(filePath);
    const file = this.fileMap.get(sessionId)!.get(fileId)!;
    this.fileMap.get(sessionId)!.delete(fileId);

    return { id: fileId, ...file };
  }

  public async cleanupFiles(sessionId: string): Promise<({ id: string } & File)[]> {
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
