import fastifyMultipart from "@fastify/multipart";
import { FastifyInstance, FastifyRequest } from "fastify";
import { $ref } from "../../plugins/schemas.js";
import { MB } from "../../utils/size.js";
import { FilesController } from "./files.controller.js";
import { FileService } from "../../services/file.service.js";

async function routes(server: FastifyInstance) {
  const filesController = new FilesController(FileService.getInstance());

  await server.register(fastifyMultipart, {
    limits: {
      fileSize: server.steelBrowserConfig.fileStorage?.maxSizePerSession ?? 100 * MB,
    },
    attachFieldsToBody: false,
  });

  server.post(
    "/sessions/:sessionId/files/*",
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
        Params: { sessionId: string; "*": string };
      }>,
      reply,
    ) => filesController.handleFileUpload(server, request, reply),
  );

  server.head(
    "/sessions/:sessionId/files/*",
    {
      schema: {
        operationId: "head_file",
        summary: "Head a file",
        description: "Head a file from a session",
        tags: ["Files"],
      },
    },
    async (request: FastifyRequest<{ Params: { sessionId: string; "*": string } }>, reply) =>
      filesController.handleFileHead(server, request, reply),
  );

  server.get(
    "/sessions/:sessionId/files/*",
    {
      schema: {
        operationId: "download_file",
        summary: "Download a file",
        description: "Download a file from a session",
        tags: ["Files"],
      },
    },
    async (request: FastifyRequest<{ Params: { sessionId: string; "*": string } }>, reply) =>
      filesController.handleFileDownload(server, request, reply),
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
    ) => filesController.handleFileList(server, request, reply),
  );

  server.delete(
    "/sessions/:sessionId/files/*",
    {
      schema: {
        operationId: "delete_file",
        summary: "Delete a file",
        description: "Delete a file from a session",
        tags: ["Files"],
        response: {
          204: {
            type: "null",
            description: "No content",
          },
        },
      },
    },
    async (request: FastifyRequest<{ Params: { sessionId: string; "*": string } }>, reply) =>
      filesController.handleFileDelete(server, request, reply),
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
          204: {
            type: "null",
            description: "No content",
          },
        },
      },
    },

    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply) =>
      filesController.handleFileDeleteAll(server, request, reply),
  );

  server.get(
    "/sessions/:sessionId/files.zip",
    {
      schema: {
        operationId: "download_archive",
        summary: "Download archive",
        description: "Download all files from the session as a zip archive.",
        tags: ["Files"],
      },
    },
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply) =>
      filesController.handleDownloadArchive(server, request, reply),
  );
}

export default routes;
