import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { FileService } from "../services/file.service.js";

export interface FileStoragePluginOptions {
  maxSizePerSession?: number;
}

const fileStoragePlugin: FastifyPluginAsync<FileStoragePluginOptions> = async (
  fastify,
  options,
) => {
  fastify.log.info("Registering file service");
  fastify.decorate(
    "fileService",
    FileService.getInstance({ maxSizeBytes: options?.maxSizePerSession }),
  );
};

export default fp(fileStoragePlugin, "5.x");
