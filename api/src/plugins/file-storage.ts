import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { FileService } from "../services/file.service.js";
import { resolveMaxTotalBytes } from "../utils/file-quota.js";

export interface FileStoragePluginOptions {
  /** Store-wide cumulative bucket (bytes), shared across all sessions. */
  maxTotalBytes?: number;
  /** @deprecated Use `maxTotalBytes`; alias `maxTotalBytes ?? maxSizePerSession`, warns once when legacy-only. */
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
