import { FastifyInstance } from "fastify";
import { $ref } from "../../plugins/schemas";
import { checkArtifactExistence, downloadArtifact, deleteArtifact, listArtifacts } from "./artifacts.controllers";

async function routes(server: FastifyInstance) {
  server.head(
    "/sessions/:sessionId/artifacts/*",
    {
      schema: {
        operationId: "head_artifact",
        summary: "Check artifact existence",
        description: "Check if an artifact exists for a session",
        tags: ["Artifacts"],
        response: {
          200: $ref("ArtifactDetails"),
          404: {
            type: "object",
            properties: {
              message: { type: "string" },
            },
          },
        },
      },
    },
    checkArtifactExistence,
  );

  server.get(
    "/sessions/:sessionId/artifacts/*",
    {
      schema: {
        operationId: "download_artifact",
        summary: "Download artifact",
        description: "Download an artifact for a session",
        tags: ["Artifacts"],
      },
    },
    downloadArtifact,
  );

  // server.put(
  //   "/sessions/:sessionId/artifacts/*",
  //   {
  //     schema: {
  //       operationId: "upload_artifact",
  //       summary: "Upload artifact",
  //       description: "Upload a new artifact or replace an existing one",
  //       tags: ["Artifacts"],
  //       consumes: ["multipart/form-data"],
  //       response: {
  //         201: $ref("ArtifactDetails"),
  //         400: {
  //           type: "object",
  //           properties: {
  //             message: { type: "string" },
  //           },
  //         },
  //       },
  //     },
  //   },
  //   uploadArtifact,
  // );

  server.delete(
    "/sessions/:sessionId/artifacts/*",
    {
      schema: {
        operationId: "delete_artifact",
        summary: "Delete artifact",
        description: "Delete an artifact from storage",
        tags: ["Artifacts"],
        response: {
          204: {
            type: "null",
            description: "Artifact successfully deleted",
          },
          404: {
            type: "object",
            properties: {
              message: { type: "string" },
            },
          },
        },
      },
    },
    deleteArtifact,
  );

  server.get(
    "/sessions/:sessionId/artifacts",
    {
      schema: {
        operationId: "list_artifacts",
        summary: "List artifacts",
        description: "List all artifacts for a session",
        tags: ["Artifacts"],
        response: {
          200: {
            type: "array",
            items: $ref("ArtifactDetails"),
          },
        },
      },
    },
    listArtifacts,
  );
}

export default routes;
