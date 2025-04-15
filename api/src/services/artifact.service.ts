import { FastifyBaseLogger } from "fastify";
import fs from "fs";
import { promises as fsPromises } from "fs";
import path from "path";
import { Readable } from "stream";
import mime from "mime-types";
import { env } from "../env";

interface Artifact {
  key: string;
  size: number;
  contentType: string;
  createdAt: Date;
  modifiedAt: Date;
}

const BASE_DIR = env.NODE_ENV === "development" ? path.join(process.cwd(), "artifacts") : "/artifacts";
fs.mkdirSync(BASE_DIR, { recursive: true });

export class ArtifactService {
  private logger: FastifyBaseLogger;

  constructor(_config: {}, logger: FastifyBaseLogger) {
    this.logger = logger;
  }

  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    await fsPromises.mkdir(dirPath, { recursive: true });
  }

  private sanitizePath(filePath: string): string {
    return path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/g, "");
  }

  private getSessionPath(sessionId: string): string {
    return path.join(BASE_DIR, this.sanitizePath(sessionId));
  }

  private getArtifactPath(sessionId: string, artifactPath: string): string {
    return path.join(this.getSessionPath(sessionId), this.sanitizePath(artifactPath));
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await fsPromises.stat(filePath);
      return true;
    } catch (err: any) {
      if (err.code === "ENOENT") return false;
      throw err;
    }
  }

  public async checkArtifact(params: { sessionId: string; artifactPath: string }): Promise<Artifact | null> {
    const { sessionId, artifactPath } = params;
    const fullPath = this.getArtifactPath(sessionId, artifactPath);

    if (!(await this.exists(fullPath))) {
      return null;
    }

    const stats = await fsPromises.stat(fullPath);
    if (!stats.isFile()) {
      throw new Error("Requested path is not a file");
    }

    return {
      key: artifactPath,
      size: stats.size,
      contentType: mime.lookup(fullPath) || "application/octet-stream",
      createdAt: stats.birthtime,
      modifiedAt: stats.mtime,
    };
  }

  public async downloadArtifact(params: { sessionId: string; artifactPath: string }): Promise<{
    artifact: Artifact;
    stream: Readable;
  }> {
    const { sessionId, artifactPath } = params;
    const artifact = await this.checkArtifact({ sessionId, artifactPath });

    if (!artifact) {
      throw new Error("Artifact not found");
    }

    const fullPath = this.getArtifactPath(sessionId, artifactPath);

    return {
      artifact,
      stream: fs.createReadStream(fullPath),
    };
  }

  public async uploadArtifact(params: {
    sessionId: string;
    artifactPath: string;
    inputStream: NodeJS.ReadableStream;
  }): Promise<Artifact> {
    const { sessionId, artifactPath, inputStream } = params;
    const fullPath = this.getArtifactPath(sessionId, artifactPath);

    await this.ensureDirectoryExists(path.dirname(fullPath));

    const fileStream = fs.createWriteStream(fullPath);

    await new Promise<void>((resolve, reject) => {
      inputStream.pipe(fileStream).on("finish", resolve).on("error", reject);
    });

    const stats = await fsPromises.stat(fullPath);

    return {
      key: artifactPath,
      size: stats.size,
      contentType: mime.lookup(fullPath) || "application/octet-stream",
      createdAt: stats.birthtime,
      modifiedAt: stats.mtime,
    };
  }

  public async deleteArtifact(params: { sessionId: string; artifactPath: string }): Promise<Artifact> {
    const { sessionId, artifactPath } = params;
    const artifact = await this.checkArtifact({ sessionId, artifactPath });

    if (!artifact) {
      throw new Error("Artifact not found");
    }

    const fullPath = this.getArtifactPath(sessionId, artifactPath);
    await fsPromises.unlink(fullPath);
    return artifact;
  }

  public async listArtifacts(params: { sessionId: string }): Promise<Artifact[]> {
    const { sessionId } = params;
    const sessionPath = this.getSessionPath(sessionId);

    await this.ensureDirectoryExists(sessionPath);

    const allFiles = await this.listFilesRecursively(sessionPath);

    return await Promise.all(
      allFiles.map(async (filePath) => {
        const stats = await fsPromises.stat(filePath);
        const relativePath = path.relative(sessionPath, filePath);

        return {
          key: relativePath,
          size: stats.size,
          contentType: mime.lookup(filePath) || "application/octet-stream",
          createdAt: stats.birthtime,
          modifiedAt: stats.mtime,
        };
      }),
    );
  }

  private async listFilesRecursively(dir: string): Promise<string[]> {
    const entries = await fsPromises.readdir(dir, { withFileTypes: true });

    const files = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dir, entry.name);
        return entry.isDirectory() ? await this.listFilesRecursively(fullPath) : [fullPath];
      }),
    );

    return files.flat();
  }
}
