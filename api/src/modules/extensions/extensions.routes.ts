import { FastifyInstance } from "fastify";
import { handleUploadExtension, handleImportExtension, handleListExtensions, handleDeleteExtension, handlePurgeExtensions } from "./extensions.controller";
import { extensionSchemas, UploadExtensionRequest, ImportExtensionRequest, DeleteExtensionRequest } from "./extensions.schema";
import { $ref } from "../../plugins/schemas";

export default async function (server: FastifyInstance) {
  server.post(
    "/extensions",
    {
      schema: {
        operationId: "upload_extension",
        description: "Upload a custom browser extension",
        tags: ["Extensions"],
        body: $ref("UploadExtension"),
        response: {
          201: $ref("ExtensionDetails"),
        },
      },
    },
    async (request, reply) => handleUploadExtension(server, request as UploadExtensionRequest, reply),
  );

  server.post(
    "/extensions/import",
    {
      schema: {
        operationId: "import_extension",
        description: "Import a browser extension from Chrome Web Store",
        tags: ["Extensions"],
        body: $ref("ImportExtension"),
        response: {
          201: $ref("ExtensionDetails"),
        },
      },
    },
    async (request, reply) => handleImportExtension(server, request as ImportExtensionRequest, reply),
  );

  server.get(
    "/extensions",
    {
      schema: {
        operationId: "list_extensions",
        description: "List all installed browser extensions",
        tags: ["Extensions"],
        response: {
          200: $ref("MultipleExtensions"),
        },
      },
    },
    async (request, reply) => handleListExtensions(server, reply),
  );

  server.delete(
    "/extensions/:name",
    {
      schema: {
        operationId: "delete_extension",
        description: "Delete a specific browser extension",
        tags: ["Extensions"],
        params: $ref("DeleteExtensionParams"),
        response: {
          204: {
            type: 'null',
            description: 'Extension successfully deleted'
          },
          403: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' }
            }
          }
        }
      }
    },
    async (request, reply) => handleDeleteExtension(server, request as DeleteExtensionRequest, reply),
  );

  server.delete(
    "/extensions",
    {
      schema: {
        operationId: "purge_extensions",
        description: "Delete all non-default browser extensions",
        tags: ["Extensions"],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' }
            }
          }
        }
      }
    },
    async (request, reply) => handlePurgeExtensions(server, request, reply),
  );
}
