import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { $ref } from "../../plugins/schemas.js";
import {
  handleFileDelete,
  handleFileDownload,
  handleFileList,
  handleFileUpload,
  handleGetFile,
  handleSessionFilesDelete,
} from "./files.controller.js";
import fastifyMultipart from "@fastify/multipart";
import { MB } from "../../utils/size.js";

async function routes(server: FastifyInstance) {
  await server.register(fastifyMultipart, {
    limits: {
      fileSize: server.steelBrowserConfig.fileStorage?.maxSizePerSession ?? 100 * MB,
    },
    attachFieldsToBody: false,
  });

  server.post(
    "/sessions/:sessionId/files",
    {
      schema: {
        operationId: "upload_file",
        summary: "Upload a file",
        description:
          "Uploads a file to a session via `multipart/form-data` with form fields: `file` (binary data, prioritized), `fileUrl` (remote URL), `name` (custom filename), `fileId` (custom uuid) and `metadata` (custom key-value pairs).",
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
        summary: "Get file details",
        description: "Get details of a file in a session",
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
        summary: "Download a file",
        description: "Download a file from a session",
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
        summary: "List files",
        description: "List all files from the session in descending order.",
        tags: ["Files"],
        response: {
          200: $ref("MultipleFiles"),
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: { sessionId: string };
      }>,
      reply,
    ) => handleFileList(server, request, reply),
  );

  server.delete(
    "/sessions/:sessionId/files/:fileId",
    {
      schema: {
        operationId: "delete_file",
        summary: "Delete a file",
        description: "Delete a file from a session",
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
        summary: "Delete all files",
        description: "Delete all files from a session",
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
