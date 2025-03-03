import fs from "fs";
import mime from "mime-types";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { env } from "../env";

interface File {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  createdAt: Date;
  updatedAt: Date;
}

export class FileStorageService {
  private baseDownloadPath: string;
  private fileMap: Map<string, Map<string, File>> = new Map();

  constructor() {
    this.baseDownloadPath = env.DOWNLOADS_PATH || path.join(process.cwd(), "downloads");
    fs.mkdirSync(this.baseDownloadPath, { recursive: true });
    this.fileMap = new Map();
  }

  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    await fs.promises.mkdir(dirPath, { recursive: true });
  }

  private sanitizeFileId(fileId: string): string {
    return path.basename(fileId);
  }

  private sanitizePath(filePath: string): string {
    const normalizedPath = path.normalize(filePath);
    if (normalizedPath.includes("..")) {
      throw new Error("Invalid file path");
    }
    return normalizedPath;
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
    buffer: Buffer,
    options: { fileName?: string; mimeType?: string } = {},
  ): Promise<{ id: string; fileSize: number }> {
    const targetDir = this.getSessionPath(sessionId);
    await this.ensureDirectoryExists(targetDir);

    let fileId: string;
    let fullFilePath: string;
    let exists = true;

    do {
      fileId = uuidv4();
      fullFilePath = path.join(targetDir, fileId);
      exists = await this.exists(fullFilePath);
    } while (exists);

    await fs.promises.writeFile(fullFilePath, buffer);
    const fileStats = await fs.promises.stat(fullFilePath);

    const fileName = options.fileName || fileId;
    const mimeType = options.mimeType || mime.lookup(fileName) || "application/octet-stream";

    if (!this.fileMap.has(sessionId)) {
      this.fileMap.set(sessionId, new Map());
    }

    const metadata: File = {
      id: fileId,
      fileName,
      mimeType,
      fileSize: fileStats.size,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.fileMap.get(sessionId)!.set(fileId, metadata);

    return {
      id: fileId,
      fileSize: fileStats.size,
    };
  }

  public async getFile(
    sessionId: string,
    fileId: string,
  ): Promise<{ buffer: Buffer; fileName: string; fileSize: number; mimeType: string }> {
    fileId = this.sanitizeFileId(fileId);
    const targetDir = this.getSessionPath(sessionId);
    const filePath = path.join(targetDir, fileId);

    if (!(await this.exists(filePath))) {
      throw new Error(`File not found: ${filePath}`);
    }

    const fileStats = await fs.promises.stat(filePath);

    if (fileStats.isDirectory()) {
      throw new Error(`Path is a directory, not a file: ${filePath}`);
    }
    const { fileName, mimeType, fileSize } = this.fileMap.get(sessionId)!.get(fileId)!;

    return {
      buffer: await fs.promises.readFile(filePath),
      fileName,
      fileSize,
      mimeType,
    };
  }

  public async listFiles(sessionId: string): Promise<{
    items: Array<File>;
    count: number;
  }> {
    const sessionItems = this.fileMap.get(sessionId)!;

    if (!sessionItems) {
      return { items: [], count: 0 };
    }

    const items = Array.from(sessionItems.values());
    return { items, count: items.length };
  }

  public async deleteFile(sessionId: string, fileId: string): Promise<{ success: boolean }> {
    fileId = this.sanitizeFileId(fileId);
    const targetDir = this.getSessionPath(sessionId);
    const filePath = path.join(targetDir, fileId);

    if (!(await this.exists(filePath))) {
      throw new Error(`File not found: ${filePath}`);
    }

    await fs.promises.unlink(filePath);

    this.fileMap.get(sessionId)!.delete(fileId);

    return { success: true };
  }

  private getSessionPath(sessionId: string): string {
    return path.join(this.baseDownloadPath, this.sanitizePath(sessionId));
  }

  public async deleteSessionDirectory(sessionId: string): Promise<{ success: boolean }> {
    const sessionPath = this.getSessionPath(sessionId);
    if (await this.exists(sessionPath)) {
      await fs.promises.rm(sessionPath, { recursive: true, force: true });
      this.fileMap.delete(sessionId);
      return { success: true };
    }
    return { success: false };
  }
}

export const fileStorage = new FileStorageService();
