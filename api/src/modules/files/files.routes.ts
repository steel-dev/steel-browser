import { FastifyInstance, FastifyRequest } from "fastify";
import { $ref } from "../../plugins/schemas";
import {
  handleFileDelete,
  handleFileDownload,
  handleFileList,
  handleFileUpload,
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
          200: $ref("FileUploadResponse"),
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
        operationId: "download_file",
        description: "Download a file from the session",
        tags: ["Files"],
      },
    },
    async (request: FastifyRequest<{ Params: { fileId: string } }>, reply) =>
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
          200: $ref("FileListResponse"),
        },
      },
    },
    async (request: FastifyRequest, reply) => handleFileList(server, request, reply),
  );

  server.delete(
    "/sessions/:sessionId/files/:fileId",
    {
      schema: {
        operationId: "delete_file",
        description: "Delete a file from the session",
        tags: ["Files"],
        response: {
          200: $ref("FileDeleteResponse"),
        },
      },
    },
    async (request: FastifyRequest<{ Params: { fileId: string } }>, reply) => handleFileDelete(server, request, reply),
  );

  server.delete(
    "/sessions/:sessionId/files",
    {
      schema: {
        operationId: "delete_all_files",
        description: "Delete all files from the session",
        tags: ["Files"],
        response: {
          200: $ref("FileDeleteResponse"),
        },
      },
    },

    async (request: FastifyRequest, reply) => handleSessionFilesDelete(server, request, reply),
  );
}

export default routes;
