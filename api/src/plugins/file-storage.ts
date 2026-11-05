import { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { FileService } from "../services/file.service.js";
import { resolveMaxTotalBytes } from "../utils/file-quota.js";

export interface FileStoragePluginOptions {
  /** Store-wide cumulative bucket (bytes), shared across all sessions. */
  maxTotalBytes?: number;
  /** @deprecated Use `maxTotalBytes`; alias `maxTotalBytes ?? maxSizePerSession`, warns once when legacy-only. */
  maxSizePerSession?: number;
  /**
   * Opt-in allowlist for URL-upload fetch targets the default-deny SSRF
   * guard would otherwise reject (e.g. `localhost`, loopback, or intranet
   * hosts for self-hosted setups). Entries are hostnames (`"localhost"`),
   * IPv4 literals (`"127.0.0.1"`), or IPv4 CIDRs (`"10.0.0.0/8"`),
   * matched case-insensitively; IPv6 literals match exactly, IPv6 CIDRs
   * are not supported, and malformed entries permit nothing. Empty or
   * unset keeps default-deny; public hosts are unaffected either way.
   */
  urlAllowlist?: string[];
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
