import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { FileService } from "../services/files.service";

const fileStoragePlugin: FastifyPluginAsync = async (fastify, _options) => {
  fastify.log.info("Registering file service");
  const fileService = new FileService({}, fastify.log);
  fastify.decorate("fileService", fileService);
};

export default fp(fileStoragePlugin, "5.x");
