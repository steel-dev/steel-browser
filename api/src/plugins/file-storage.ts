import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { FileService } from "../services/file.service.js";

export interface FileStoragePluginOptions {
  /**
   * Single global cumulative bucket (bytes) shared across all sessions.
   * NOT isolated per session (see SteelBrowserConfig.fileStorage).
   */
  maxTotalBytes?: number;
  /**
   * @deprecated Use `maxTotalBytes` instead. Kept as a backward-compatible
   * alias: `maxTotalBytes ?? maxSizePerSession` wins when both are set.
   */
  maxSizePerSession?: number;
}

const fileStoragePlugin: FastifyPluginAsync<FileStoragePluginOptions> = async (
  fastify,
  options,
) => {
  fastify.log.info("Registering file service");
  fastify.decorate(
    "fileService",
    FileService.getInstance({
      maxSizeBytes: options?.maxTotalBytes ?? options?.maxSizePerSession,
    }),
  );
};

export default fp(fileStoragePlugin, "5.x");
