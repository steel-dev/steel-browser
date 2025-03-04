import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { $ref } from "../../plugins/schemas";
import {
  handleFileDelete,
  handleFileDownload,
  handleFileList,
  handleFileUpload,
  handleGetFile,
  handleSessionFilesDelete,
} from "./files.controller";

async function routes(server: FastifyInstance) {
  server.post(
    "/sessions/:sessionId/files",
    {
      schema: {
        operationId: "upload_file",
        description: "Upload a file to the session",
        tags: ["Files"],
        consumes: ["multipart/form-data"],
        response: {
          200: $ref("FileDetails"),
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: { sessionId: string };
      }>,
      reply,
    ) => handleFileUpload(server, request, reply),
  );

  server.get(
    "/sessions/:sessionId/files/:fileId",
    {
      schema: {
        operationId: "get_file_details",
        description: "Get file details",
        tags: ["Files"],
        response: {
          200: $ref("FileDetails"),
        },
      },
    },
    async (request: FastifyRequest<{ Params: { sessionId: string; fileId: string } }>, reply: FastifyReply) =>
      handleGetFile(server, request, reply),
  );

  server.get(
    "/sessions/:sessionId/files/:fileId/download",
    {
      schema: {
        operationId: "download_file",
        description: "Download a file from the session",
        tags: ["Files"],
      },
    },
    async (request: FastifyRequest<{ Params: { sessionId: string; fileId: string } }>, reply) =>
      handleFileDownload(server, request, reply),
  );

  server.get(
    "/sessions/:sessionId/files",
    {
      schema: {
        operationId: "list_files",
        description: "List files in the session",
        tags: ["Files"],
        response: {
          200: $ref("MultipleFiles"),
        },
      },
    },
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply) => handleFileList(server, request, reply),
  );

  server.delete(
    "/sessions/:sessionId/files/:fileId",
    {
      schema: {
        operationId: "delete_file",
        description: "Delete a file from the session",
        tags: ["Files"],
        response: {
          200: $ref("DeleteFile"),
        },
      },
    },
    async (request: FastifyRequest<{ Params: { sessionId: string; fileId: string } }>, reply) =>
      handleFileDelete(server, request, reply),
  );

  server.delete(
    "/sessions/:sessionId/files",
    {
      schema: {
        operationId: "delete_all_files",
        description: "Delete all files from the session",
        tags: ["Files"],
        response: {
          200: $ref("DeleteFiles"),
        },
      },
    },

    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply) =>
      handleSessionFilesDelete(server, request, reply),
  );
}

export default routes;
