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

    let fileBuffer: Buffer | null = null;
    let fileName = "";
    let mimeType = "";
    let fileProvided = false;

    for await (const part of request.parts()) {
      if (part.type === "file") {
        const file = part as MultipartFile;
        fileName = file.filename;
        mimeType = file.mimetype;
        fileBuffer = await streamToBuffer(file.file);
        fileProvided = true;
      } else if (part.fieldname === "fileUrl" && part.value && !fileProvided) {
        const fileUrl = part.value as string;
        const { buffer, mimeType: fetchedMimeType, fileName: fetchedFileName } = await fetchFileFromUrl(fileUrl);
        fileBuffer = buffer;
        mimeType = fetchedMimeType;
        fileName = fetchedFileName || "downloaded-file";
      } else if (part.fieldname === "name" && part.value) {
        fileName = part.value as string;
      }
    }

    if (!fileBuffer) {
      return reply.code(400).send({
        success: false,
        message: "Either file or fileUrl must be provided",
      });
    }

    const result = await server.sessionService.uploadFileToSession(fileBuffer, {
      fileName,
      mimeType,
    });

    return reply.send({
      success: true,
      ...result,
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

async function fetchFileFromUrl(url: string): Promise<{ buffer: Buffer; mimeType: string; fileName?: string }> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    protocol
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          return reject(new Error(`Failed to fetch file: ${response.statusCode}`));
        }

        const mimeType = response.headers["content-type"] || "application/octet-stream";
        let fileName: string | undefined;

        if (response.headers["content-disposition"]) {
          const match = /filename="?([^"]+)"?/.exec(response.headers["content-disposition"]!);
          fileName = match?.[1];
        }

        if (!fileName) {
          const urlPath = new URL(url).pathname;
          fileName = urlPath.substring(urlPath.lastIndexOf("/") + 1) || "downloaded-file";
        }

        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        response.on("end", () => resolve({ buffer: Buffer.concat(chunks), mimeType, fileName }));
        response.on("error", reject);
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
