import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { FileService } from "../services/file.service.js";
import { resolveMaxTotalBytes } from "../utils/file-quota.js";

export interface FileStoragePluginOptions {
  /**
   * Single global cumulative bucket (bytes) shared across all sessions.
   * NOT isolated per session (see SteelBrowserConfig.fileStorage).
   */
  maxTotalBytes?: number;
  /**
   * @deprecated Use `maxTotalBytes` instead. Kept as a backward-compatible
   * alias: `maxTotalBytes ?? maxSizePerSession` wins when both are set.
   * Store-wide, NOT per-session: behaves exactly as `maxTotalBytes`.
   * Using it without `maxTotalBytes` emits a one-time deprecation warning.
   */
  maxSizePerSession?: number;
}

const fileStoragePlugin: FastifyPluginAsync<FileStoragePluginOptions> = async (
  fastify,
  options,
) => {
  fastify.log.info("Registering file service");
  const rawQuota = resolveMaxTotalBytes(options);
  fastify.decorate(
    "fileService",
    FileService.getInstance(rawQuota === undefined ? {} : { maxSizeBytes: rawQuota }),
  );
};

export default fp(fileStoragePlugin, "5.x");
