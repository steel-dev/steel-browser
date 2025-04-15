import { FastifyReply, FastifyRequest, FastifyInstance } from "fastify";
import { MultipartFile } from "@fastify/multipart";

interface ArtifactPathParams {
  sessionId: string;
  "*": string;
}

interface SessionIdParams {
  sessionId: string;
}

export async function checkArtifactExistence(
  request: FastifyRequest<{ Params: ArtifactPathParams }>,
  reply: FastifyReply,
) {
  const sessionId = request.params.sessionId;
  const artifactPath = request.params["*"];

  try {
    const artifact = await request.server.artifactService.checkArtifact({
      sessionId,
      artifactPath,
    });

    if (!artifact) {
      return reply.code(404).send({ message: "Artifact not found" });
    }

    return reply.code(200).send({
      key: artifact.key,
      size: artifact.size,
      createdAt: artifact.createdAt.toISOString(),
      modifiedAt: artifact.modifiedAt.toISOString(),
    });
  } catch (error) {
    request.log.error(error);
    return reply.code(400).send({ message: "Invalid path" });
  }
}

export async function downloadArtifact(request: FastifyRequest<{ Params: ArtifactPathParams }>, reply: FastifyReply) {
  const sessionId = request.params.sessionId;
  const artifactPath = request.params["*"];

  try {
    const { artifact, stream } = await request.server.artifactService.downloadArtifact({
      sessionId,
      artifactPath,
    });

    reply.header("Content-Type", artifact.contentType);
    reply.header("Content-Length", artifact.size);

    return reply.send(stream);
  } catch (error) {
    request.log.error(error);
    if (error instanceof Error && error.message === "Artifact not found") {
      return reply.code(404).send({ message: "Artifact not found" });
    }
    return reply.code(500).send({ message: "Error retrieving artifact" });
  }
}

// export async function uploadArtifact(request: FastifyRequest<{ Params: ArtifactPathParams }>, reply: FastifyReply) {
//   const sessionId = request.params.sessionId;
//   const artifactPath = request.params["*"];

//   try {
//     if (!request.isMultipart()) {
//       return reply.code(400).send({
//         message: "Request must be multipart/form-data",
//       });
//     }

//     let inputStream: NodeJS.ReadableStream | null = null;

//     for await (const part of request.parts()) {
//       if (part.type === "file") {
//         const file = part as MultipartFile;
//         inputStream = file.file;
//         break;
//       }
//     }

//     if (!inputStream) {
//       return reply.code(400).send({
//         message: "No file found in request",
//       });
//     }

//     const artifact = await request.server.artifactService.uploadArtifact({
//       sessionId,
//       artifactPath,
//       inputStream,
//     });

//     return reply.code(201).send({
//       key: artifact.key,
//       size: artifact.size,
//       createdAt: artifact.createdAt.toISOString(),
//       modifiedAt: artifact.modifiedAt.toISOString(),
//     });
//   } catch (error) {
//     request.log.error(error);
//     return reply.code(500).send({ message: "Error uploading artifact" });
//   }
// }

export async function deleteArtifact(request: FastifyRequest<{ Params: ArtifactPathParams }>, reply: FastifyReply) {
  const sessionId = request.params.sessionId;
  const artifactPath = request.params["*"];

  try {
    await request.server.artifactService.deleteArtifact({
      sessionId,
      artifactPath,
    });

    return reply.code(204).send();
  } catch (error) {
    request.log.error(error);
    if (error instanceof Error && error.message === "Artifact not found") {
      return reply.code(404).send({ message: "Artifact not found" });
    }
    return reply.code(500).send({ message: "Error deleting artifact" });
  }
}

export async function listArtifacts(request: FastifyRequest<{ Params: SessionIdParams }>, reply: FastifyReply) {
  const sessionId = request.params.sessionId;

  try {
    const artifacts = await request.server.artifactService.listArtifacts({
      sessionId,
    });

    const result = artifacts.map((artifact) => ({
      key: artifact.key,
      size: artifact.size,
      createdAt: artifact.createdAt.toISOString(),
      modifiedAt: artifact.modifiedAt.toISOString(),
    }));

    return reply.send(result);
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ message: "Error listing artifacts" });
  }
}
