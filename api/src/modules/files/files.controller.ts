import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getErrors } from "../../utils/errors";
import { FileUploadRequest } from "./files.schema";

export const handleFileUpload = async (server: FastifyInstance, request: FileUploadRequest, reply: FastifyReply) => {
  try {
    const { content, fileName, mimeType } = request.body;

    const result = await server.sessionService.uploadFileToSession(content, {
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

    const result = await server.sessionService.downloadFileFromSession(fileId);

    return reply.send({
      success: true,
      ...result,
    });
  } catch (e: unknown) {
    const error = getErrors(e);
    return reply.code(500).send({ success: false, message: error });
  }
};

export const handleFileList = async (server: FastifyInstance, _request: FastifyRequest, reply: FastifyReply) => {
  try {
    const { items, count } = await server.sessionService.listSessionFiles();

    return reply.send({
      items: items.map((item) => ({
        id: item.id,
        fileName: item.fileName,
        fileSize: item.fileSize,
        mimeType: item.mimeType,
        createdAt: item.createdAt.toString(),
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
