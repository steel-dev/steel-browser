import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { FileService } from "../services/file.service.js";

const fileStoragePlugin: FastifyPluginAsync = async (fastify, _options) => {
  fastify.log.info("Registering file service");
  fastify.decorate("fileService", FileService.getInstance());
};

export default fp(fileStoragePlugin, "5.x");
