import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { ArtifactService } from "../services/artifact.service";

const artifactStoragePlugin: FastifyPluginAsync = async (fastify, _options) => {
  fastify.log.info("Registering artifact service");
  const artifactService = new ArtifactService({}, fastify.log);
  fastify.decorate("artifactService", artifactService);
};

export default fp(artifactStoragePlugin, "5.x");
