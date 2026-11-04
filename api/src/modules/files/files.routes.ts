import fastifyMultipart from "@fastify/multipart";
import { FastifyInstance, FastifyRequest } from "fastify";
import { $ref } from "../../plugins/schemas.js";
import { FileService } from "../../services/file.service.js";
import { resolveMaxTotalBytes } from "../../utils/file-quota.js";
import { MB } from "../../utils/size.js";
import { FilesController } from "./files.controller.js";

async function routes(server: FastifyInstance) {
  const filesController = new FilesController(FileService.getInstance());

  await server.register(fastifyMultipart, {
    limits: {
      fileSize: resolveMaxTotalBytes(server.steelBrowserConfig?.fileStorage) ?? 100 * MB,
      // Max number of file fields per request (busboy `files` limit;
      // exceeding it raises FilesLimitError/413 from request.parts()).
      // Mirrors FilesController.MAX_FILE_PARTS_PER_REQUEST; the
      // in-controller check is authoritative.
      files: FilesController.MAX_FILE_PARTS_PER_REQUEST,
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
          "Uploads a file to a session via `multipart/form-data` with a `file` field that accepts either binary data or a URL string to download from, and an optional `path` field for the file storage path. At most 5 `file` parts per request; the last staged binary part wins (earlier staged parts are discarded and never count toward quota). 413 when the part count is exceeded, when a binary part exceeds the per-file `fileSize` limit, or when the cumulative store quota is exceeded. Transient cost is up to 5 x per-file `fileSize` in os.tmpdir() (each binary part staged, only last committed); URL uploads bypass the per-file `fileSize` limit and are bound only by the cumulative quota and the 30s fetch timeout (shared store-wide bucket).",
        tags: ["Files"],
        consumes: ["multipart/form-data"],
        body: $ref("FileUploadRequest"),
        response: {
          200: $ref("FileDetails"),
        },
      },
      validatorCompiler: () => (value) => ({ value }),
    },
    async (
      request: FastifyRequest<{
        Params: { sessionId: string };
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
        description: "Head a file from a session.",
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
        description: "Download a file from a session.",
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
        description:
          "List all files from the session in descending order. Files live in a shared store-wide bucket; :sessionId is decorative and does not isolate files per session.",
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
        description: "Delete a file from a session.",
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
        description:
          "Delete all files from a session. Files live in a shared store-wide bucket; :sessionId is decorative and does not isolate files per session — this wipes the whole store.",
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
        description:
          "Download all files from the session as a zip archive. Files live in a shared store-wide bucket; :sessionId is decorative and does not isolate files per session.",
        tags: ["Files"],
      },
    },
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply) =>
      filesController.handleDownloadArchive(server, request, reply),
  );
}

export default routes;
