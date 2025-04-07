import { MultipartFile } from "@fastify/multipart";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import http from "http";
import https from "https";
import { PassThrough, Readable } from "stream";
import { getErrors } from "../../utils/errors";

export const handleFileUpload = async (
  server: FastifyInstance,
  request: FastifyRequest<{ Params: { sessionId: string } }>,
  reply: FastifyReply,
) => {
  try {
    if (!request.isMultipart()) {
      return reply.code(400).send({
        success: false,
        message: "Request must be multipart/form-data",
      });
    }

    let id: string | null = null;
    let stream: Readable | null = null;
    let fileProvided: boolean = false;
    let name: string | null = null;
    let contentType: string | null = null;
    let metadata: Record<string, any> | null = null;

    let providedName: string | null = null;

    for await (const part of request.parts()) {
      if (part.type === "file") {
        const file = part as MultipartFile;
        const passThrough = new PassThrough();
        file.file.pipe(passThrough);
        name = file.filename;
        contentType = file.mimetype;
        stream = passThrough;
        fileProvided = true;
        continue;
      }

      if (part.fieldname === "fileId" && part.value) {
        id = part.value as string;
        continue;
      }

      if (part.fieldname === "fileUrl" && part.value && !fileProvided) {
        const res = await createStreamFromUrl(part.value as string);
        stream = res.stream;
        contentType = res.contentType || null;
        name = res.name;
        continue;
      }

      if (part.fieldname === "name" && part.value) {
        providedName = part.value as string;
        continue;
      }

      if (part.fieldname === "metadata" && part.value) {
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

    if (!!providedName) {
      name = providedName;
    }

    if (!stream) {
      return reply.code(400).send({
        success: false,
        message: "Either file or fileUrl must be provided",
      });
    }

    const file = await server.fileService.saveFile({
      sessionId: request.params.sessionId,
      stream,
      name: name!,
      contentType: contentType!,
      ...(id && { id }),
      ...(metadata && { metadata }),
    });

    return reply.send({
      id: file.id,
      name: file.name,
      size: file.size,
      contentType: file.contentType,
      createdAt: file.createdAt.toISOString(),
      updatedAt: file.updatedAt.toISOString(),
      checksum: file.checksum,
      metadata: file.metadata,
      path: file.path,
    });
  } catch (e: unknown) {
    const error = getErrors(e);
    return reply.code(500).send({ success: false, message: error });
  }
};

async function createStreamFromUrl(url: string): Promise<{ stream: Readable; contentType?: string; name: string }> {
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

export const handleGetFile = async (
  server: FastifyInstance,
  request: FastifyRequest<{ Params: { sessionId: string; fileId: string } }>,
  reply: FastifyReply,
) => {
  try {
    const file = await server.fileService.getFile({ sessionId: request.params.sessionId, id: request.params.fileId });
    return reply.send({
      id: file.id,
      name: file.name,
      size: file.size,
      contentType: file.contentType,
      createdAt: file.createdAt.toISOString(),
      updatedAt: file.updatedAt.toISOString(),
      checksum: file.checksum,
      metadata: file.metadata,
      path: file.path,
    });
  } catch (e: unknown) {
    const error = getErrors(e);
    return reply.code(500).send({ success: false, message: error });
  }
};

export const handleFileDownload = async (
  server: FastifyInstance,
  request: FastifyRequest<{ Params: { sessionId: string; fileId: string } }>,
  reply: FastifyReply,
) => {
  try {
    const { stream, size, name, contentType } = await server.fileService.downloadFile({
      sessionId: request.params.sessionId,
      id: request.params.fileId,
    });

    reply
      .header("Content-Type", contentType)
      .header("Content-Length", size)
      .header("Content-Disposition", `attachment; filename="${encodeURIComponent(name)}"`);

    return reply.send(stream);
  } catch (e: unknown) {
    const error = getErrors(e);
    return reply.code(500).send({ success: false, message: error });
  }
};

export const handleFileList = async (
  server: FastifyInstance,
  request: FastifyRequest<{
    Params: { sessionId: string };
  }>,
  reply: FastifyReply,
) => {
  try {
    const files = await server.fileService.listFiles({ sessionId: request.params.sessionId });

    return reply.send({
      data: files.map((file) => ({
        id: file.id,
        name: file.name,
        size: file.size,
        contentType: file.contentType,
        createdAt: file.createdAt.toISOString(),
        updatedAt: file.updatedAt.toISOString(),
        checksum: file.checksum,
        metadata: file.metadata,
        path: file.path,
      })),
    });
  } catch (e: unknown) {
    const error = getErrors(e);
    return reply.code(500).send({ success: false, message: error });
  }
};

export const handleFileDelete = async (
  server: FastifyInstance,
  request: FastifyRequest<{ Params: { sessionId: string; fileId: string } }>,
  reply: FastifyReply,
) => {
  try {
    const file = await server.fileService.deleteFile({
      sessionId: request.params.sessionId,
      id: request.params.fileId,
    });

    return reply.send({
      id: file.id,
      name: file.name,
      size: file.size,
      contentType: file.contentType,
      createdAt: file.createdAt.toISOString(),
      updatedAt: file.updatedAt.toISOString(),
      checksum: file.checksum,
      metadata: file.metadata,
      path: file.path,
      success: true,
    });
  } catch (e: unknown) {
    const error = getErrors(e);
    return reply.code(500).send({ success: false, message: error });
  }
};

export const handleSessionFilesDelete = async (
  server: FastifyInstance,
  request: FastifyRequest<{ Params: { sessionId: string } }>,
  reply: FastifyReply,
) => {
  try {
    return reply.send({
      data: (await server.fileService.cleanupFiles({ sessionId: request.params.sessionId })).map((file) => ({
        id: file.id,
        name: file.name,
        size: file.size,
        contentType: file.contentType,
        createdAt: file.createdAt.toISOString(),
        updatedAt: file.updatedAt.toISOString(),
        checksum: file.checksum,
        metadata: file.metadata,
        path: file.path,
        success: true,
      })),
    });
  } catch (e: unknown) {
    const error = getErrors(e);
    return reply.code(500).send({ success: false, message: error });
  }
};
