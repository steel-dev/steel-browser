import { createHash } from "crypto";
import { FastifyBaseLogger } from "fastify";
import fs from "fs";
import mime from "mime-types";
import path from "path";
import { Readable, Transform } from "stream";
import { pipeline } from "stream/promises";
import { v4 as uuidv4 } from "uuid";
import { env } from "../env";

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

  constructor(_config: {}, logger: FastifyBaseLogger) {
    this.logger = logger;
    this.baseDownloadPath = env.NODE_ENV === "development" ? path.join(process.cwd(), "/files") : "/files";
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
    stream: Readable;
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

    const filePath = await this.getFilePath({ sessionId: options.sessionId, name: fileName });

    const hash = createHash("sha256");

    const hashAndPassThrough = new Transform({
      transform(chunk, _encoding, callback) {
        hash.update(chunk);
        callback(null, chunk);
      },
    });

    await pipeline(options.stream, hashAndPassThrough, fs.createWriteStream(filePath));

    if (!this.fileMap.has(options.sessionId)) {
      this.fileMap.set(options.sessionId, new Map());
    }

    const currentDate = new Date();

    const file: File = {
      name: options.name || fileName,
      size: (await fs.promises.stat(filePath)).size,
      contentType: options.contentType || (options.name && mime.lookup(options.name)) || "application/octet-stream",
      createdAt: currentDate,
      updatedAt: currentDate,
      checksum: hash.digest("hex"),
      metadata: options.metadata,
      path: filePath,
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
