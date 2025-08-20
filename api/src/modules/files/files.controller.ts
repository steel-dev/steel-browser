import { MultipartFile } from "@fastify/multipart";
import archiver from "archiver";
import { randomUUID } from "crypto";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import * as fs from "fs";
import http from "http";
import https from "https";
import mime from "mime-types";
import { tmpdir } from "os";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { v4 as uuidv4 } from "uuid";
import { FileService } from "../../services/file.service.js";
import { getErrors } from "../../utils/errors.js";

export class FilesController {
  constructor(private fileService: FileService) {}

  private validatePath(filePath: string): boolean {
    if (path.isAbsolute(filePath)) {
      return false;
    }

    if (filePath.includes("..")) {
      return false;
    }

    if (filePath.includes("\0")) {
      return false;
    }

    const normalized = path.normalize(filePath);
    if (normalized.startsWith("..")) {
      return false;
    }

    return true;
  }

  async handleFileUpload(
    server: FastifyInstance,
    request: FastifyRequest<{ Params: { sessionId: string } }>,
    reply: FastifyReply,
  ) {
    let tempFilePath: string | null = null;

    try {
      if (!request.isMultipart()) {
        return reply.code(400).send({
          success: false,
          message: "Request must be multipart/form-data",
        });
      }

      let filePath: string | null = null;
      let fileUrl: string | null = null;
      let fileProvided: boolean = false;
      let saveFileResult: Awaited<ReturnType<typeof this.fileService.saveFile>> | null = null;

      for await (const part of request.parts()) {
        if (part.fieldname === "file") {
          if (part.type === "file") {
            const file = part as MultipartFile;
            fileProvided = true;

            tempFilePath = path.join(tmpdir(), `upload_${uuidv4()}`);

            const writeStream = fs.createWriteStream(tempFilePath);
            await pipeline(file.file, writeStream);
          } else if (part.type === "field" && typeof part.value === "string") {
            fileUrl = part.value;
          }
        } else if (
          part.fieldname === "path" &&
          part.type === "field" &&
          typeof part.value === "string"
        ) {
          filePath = part.value;
        }
      }

      if (!fileProvided && !fileUrl) {
        return reply.code(400).send({
          success: false,
          message:
            "No file provided in the multipart request. The 'file' field must contain either a file or a URL string.",
        });
      }

      let finalPath: string;

      if (fileProvided && tempFilePath) {
        if (!filePath) {
          finalPath = randomUUID();
        } else {
          if (!this.validatePath(filePath)) {
            await fs.promises.unlink(tempFilePath).catch(() => {});
            return reply.code(400).send({
              success: false,
              message: "Invalid path provided",
            });
          }
          finalPath = filePath;
        }

        const readStream = fs.createReadStream(tempFilePath);
        saveFileResult = await this.fileService.saveFile({
          filePath: finalPath,
          stream: readStream,
        });

        await fs.promises.unlink(tempFilePath).catch(() => {});
        tempFilePath = null;
      } else if (fileUrl) {
        if (!filePath) {
          const urlPath = new URL(fileUrl).pathname;
          const filename = urlPath.split("/").pop() || randomUUID();
          const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
          finalPath = sanitizedFilename;
        } else {
          if (!this.validatePath(filePath)) {
            return reply.code(400).send({
              success: false,
              message: "Invalid path provided",
            });
          }
          finalPath = filePath;
        }

        const { stream } = await this.createStreamFromUrl(fileUrl);
        saveFileResult = await this.fileService.saveFile({
          filePath: finalPath,
          stream,
        });
      }

      if (!saveFileResult) {
        return reply.code(500).send({
          success: false,
          message: "Failed to save file",
        });
      }

      return reply.send({
        path: saveFileResult.path,
        size: saveFileResult.size,
        lastModified: saveFileResult.lastModified,
      });
    } catch (e: unknown) {
      if (tempFilePath) {
        await fs.promises.unlink(tempFilePath).catch(() => {});
      }
      const error = getErrors(e);
      return reply.code(500).send({ success: false, message: error });
    }
  }

  private async createStreamFromUrl(
    url: string,
  ): Promise<{ stream: Readable; contentType?: string; name: string }> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith("https") ? https : http;

      protocol
        .get(url, (response) => {
          if (response.statusCode !== 200) {
            return reject(new Error(`Failed to fetch file: ${response.statusCode}`));
          }

          const contentType = response.headers["content-type"];
          const disposition = response.headers["content-disposition"] || "";
          let name: string | null = null;

          const nameMatch = disposition.match(/filename="(.+)"/i);

          if (nameMatch && nameMatch[1]) {
            name = nameMatch[1];
          } else {
            name = url.split("/").pop() || "downloaded-file";
          }

          resolve({
            stream: response,
            contentType,
            name,
          });
        })
        .on("error", reject);
    });
  }

  async handleFileDownload(
    server: FastifyInstance,
    request: FastifyRequest<{ Params: { sessionId: string; "*": string } }>,
    reply: FastifyReply,
  ) {
    try {
      const { stream, size, lastModified } = await this.fileService.downloadFile({
        filePath: request.params["*"],
      });

      const name = request.params["*"].split("/").pop() || "downloaded-file";

      reply
        .header("Content-Type", mime.lookup(request.params["*"]) || "application/octet-stream")
        .header("Content-Length", size)
        .header("Content-Disposition", `attachment; filename="${encodeURIComponent(name)}"`)
        .header("Last-Modified", lastModified.toISOString());

      return reply.send(stream);
    } catch (e: unknown) {
      const error = getErrors(e);
      return reply.code(500).send({ success: false, message: error });
    }
  }

  async handleFileHead(
    server: FastifyInstance,
    request: FastifyRequest<{ Params: { sessionId: string; "*": string } }>,
    reply: FastifyReply,
  ) {
    const { size, lastModified } = await this.fileService.getFile({
      filePath: request.params["*"],
    });

    const name = request.params["*"].split("/").pop() || "downloaded-file";

    reply
      .header("Content-Length", size)
      .header("Last-Modified", lastModified.toISOString())
      .header("Content-Type", mime.lookup(request.params["*"]) || "application/octet-stream")
      .header("Content-Disposition", `attachment; filename="${encodeURIComponent(name)}"`);

    return reply.code(200).send();
  }

  async handleFileList(
    server: FastifyInstance,
    request: FastifyRequest<{
      Params: { sessionId: string };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const files = await this.fileService.listFiles();

      return reply.send({
        data: files.map((file) => ({
          path: file.path,
          size: file.size,
          lastModified: file.lastModified,
        })),
      });
    } catch (e: unknown) {
      const error = getErrors(e);
      return reply.code(500).send({ success: false, message: error });
    }
  }

  async handleFileDelete(
    server: FastifyInstance,
    request: FastifyRequest<{ Params: { sessionId: string; "*": string } }>,
    reply: FastifyReply,
  ) {
    try {
      await this.fileService.deleteFile({
        filePath: request.params["*"],
      });
      return reply.code(204).send();
    } catch (e: unknown) {
      const error = getErrors(e);
      return reply.code(500).send({ success: false, message: error });
    }
  }

  async handleFileDeleteAll(
    server: FastifyInstance,
    request: FastifyRequest<{ Params: { sessionId: string } }>,
    reply: FastifyReply,
  ) {
    try {
      await this.fileService.cleanupFiles();
      return reply.code(204).send();
    } catch (e: unknown) {
      const error = getErrors(e);
      return reply.code(500).send({ success: false, message: error });
    }
  }

  async handleDownloadArchive(
    server: FastifyInstance,
    request: FastifyRequest<{ Params: { sessionId: string } }>,
    reply: FastifyReply,
  ) {
    const prebuiltArchivePath = await this.fileService.getPrebuiltArchivePath();

    try {
      const stats = await fs.promises.stat(prebuiltArchivePath);
      if (stats.isFile()) {
        server.log.info(`Serving prebuilt archive: ${prebuiltArchivePath}`);
        const stream = fs.createReadStream(prebuiltArchivePath);

        reply.header("Content-Type", "application/zip");
        reply.header("Content-Disposition", `attachment; filename="files.zip"`);
        reply.header("Content-Length", stats.size);
        reply.header("Last-Modified", stats.mtime.toUTCString());
        return reply.send(stream);
      } else {
        server.log.warn(`Prebuilt archive path exists but is not a file: ${prebuiltArchivePath}`);
      }

      server.log.info("Sending empty archive.");
      reply.header("Content-Type", "application/zip");
      reply.header("Content-Disposition", `attachment; filename="files-archive-empty.zip"`);
      const emptyArchive = archiver("zip", { zlib: { level: 9 } });

      emptyArchive.pipe(reply.raw);

      await emptyArchive.finalize();
      return;
    } catch (err: any) {
      server.log.error({ err }, "Error during handleFileArchive");
      if (!reply.sent) {
        try {
          reply.code(500).send({ message: "Failed to process archive request" });
        } catch (sendError: unknown) {
          server.log.error(
            { err: sendError },
            "Error sending 500 response after archive handling error",
          );
        }
      }
    }
  }
}
