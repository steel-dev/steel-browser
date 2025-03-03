import { MultipartFile } from "@fastify/multipart";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import http from "http";
import https from "https";
import { Readable } from "stream";
import { getErrors } from "../../utils/errors";

export const handleFileUpload = async (
  server: FastifyInstance,
  request: FastifyRequest<{ Params: { sessionId: string } }>,
  reply: FastifyReply,
) => {
  try {
    const { sessionId } = request.params;

    if (!sessionId) {
      return reply.code(400).send({ success: false, message: "sessionId is required" });
    }

    if (!request.isMultipart()) {
      return reply.code(400).send({
        success: false,
        message: "Request must be multipart/form-data",
      });
    }

    let fileName = "";
    let mimeType = "";
    let fileProvided = false;
    let metadata: Record<string, any> = {};
    let fileStream: Readable | null = null;

    for await (const part of request.parts()) {
      if (part.type === "file") {
        const file = part as MultipartFile;
        fileName = file.filename;
        mimeType = file.mimetype;
        fileStream = file.file;
        fileProvided = true;
      } else if (part.fieldname === "fileUrl" && part.value && !fileProvided) {
        const fileUrl = part.value as string;
        const { stream, mimeType: fetchedMimeType, fileName: fetchedFileName } = await createStreamFromUrl(fileUrl);
        fileStream = stream;
        mimeType = fetchedMimeType;
        fileName = fetchedFileName || "downloaded-file";
      } else if (part.fieldname === "name" && part.value) {
        fileName = part.value as string;
      } else if (part.fieldname === "metadata" && part.value) {
        try {
          metadata = JSON.parse(part.value as string);
        } catch (e) {
          return reply.code(400).send({
            success: false,
            message: "Invalid JSON format for metadata",
          });
        }
      }
    }

    if (!fileStream) {
      return reply.code(400).send({
        success: false,
        message: "Either file or fileUrl must be provided",
      });
    }

    const result = await server.sessionService.uploadFileStreamToSession(fileStream, {
      fileName,
      mimeType,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });

    return reply.send({
      success: true,
      ...result,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });
  } catch (e: unknown) {
    const error = getErrors(e);
    return reply.code(500).send({ success: false, message: error });
  }
};

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function createStreamFromUrl(url: string): Promise<{ stream: Readable; mimeType: string; fileName: string }> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;

    protocol
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          return reject(new Error(`Failed to fetch file: ${response.statusCode}`));
        }

        const contentType = response.headers["content-type"] || "";
        const disposition = response.headers["content-disposition"] || "";
        let fileName = "";

        const fileNameMatch = disposition.match(/filename="(.+)"/i);
        if (fileNameMatch && fileNameMatch[1]) {
          fileName = fileNameMatch[1];
        } else {
          fileName = url.split("/").pop() || "";
        }

        resolve({
          stream: response,
          mimeType: contentType,
          fileName: fileName,
        });
      })
      .on("error", reject);
  });
}

export const handleFileDownload = async (
  server: FastifyInstance,
  request: FastifyRequest<{ Params: { fileId: string } }>,
  reply: FastifyReply,
) => {
  try {
    const { fileId } = request.params;

    if (!fileId) {
      return reply.code(400).send({ success: false, message: "fileId is required" });
    }

    const { buffer, fileName, fileSize, mimeType } = await server.sessionService.downloadFileFromSession(fileId);

    reply
      .header("Content-Type", mimeType)
      .header("Content-Length", fileSize)
      .header("Content-Disposition", `attachment; filename="${fileName}"`);

    return reply.send(buffer);
  } catch (e: unknown) {
    const error = getErrors(e);
    return reply.code(500).send({ success: false, message: error });
  }
};

export const handleFileList = async (server: FastifyInstance, _request: FastifyRequest, reply: FastifyReply) => {
  try {
    const { items, count } = await server.sessionService.listSessionFiles();

    return reply.send({
      files: items.map((item) => ({
        id: item.id,
        fileName: item.fileName,
        fileSize: item.fileSize,
        mimeType: item.mimeType,
        createdAt: item.createdAt.toISOString(),
        metadata: item.metadata,
      })),
      count,
    });
  } catch (e: unknown) {
    const error = getErrors(e);
    return reply.code(500).send({ success: false, message: error });
  }
};

export const handleFileDelete = async (
  server: FastifyInstance,
  request: FastifyRequest<{ Params: { fileId: string } }>,
  reply: FastifyReply,
) => {
  try {
    if (!request.params.fileId) {
      return reply.code(400).send({ success: false, message: "fileId is required" });
    }

    const result = await server.sessionService.deleteSessionFile(request.params.fileId);

    return reply.send(result);
  } catch (e: unknown) {
    const error = getErrors(e);
    return reply.code(500).send({ success: false, message: error });
  }
};

export const handleSessionFilesDelete = async (
  server: FastifyInstance,
  _request: FastifyRequest,
  reply: FastifyReply,
) => {
  try {
    const result = await server.sessionService.deleteAllSessionFiles();

    return reply.send(result);
  } catch (e: unknown) {
    const error = getErrors(e);
    return reply.code(500).send({ success: false, message: error });
  }
};
