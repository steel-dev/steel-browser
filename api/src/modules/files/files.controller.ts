import { MultipartFile } from "@fastify/multipart";
import archiver from "archiver";
import { randomUUID } from "crypto";
import { lookup as dnsLookup } from "dns/promises";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import * as fs from "fs";
import http from "http";
import https from "https";
import mime from "mime-types";
import net from "net";
import { tmpdir } from "os";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { v4 as uuidv4 } from "uuid";
import { FileQuotaExceededError, FileService } from "../../services/file.service.js";
import { attachmentContentDisposition } from "../../utils/content-disposition.js";
import { getErrors } from "../../utils/errors.js";
import { resolveMaxTotalBytes } from "../../utils/file-quota.js";

// Thrown for every URL-fetch failure (blocked host/scheme, DNS failure,
// non-200, redirect, timeout, network error). handleFileUpload maps these to
// 400: the caller supplied a bad URL, so it is never a 500.
class InvalidFileUrlError extends Error {}

const URL_FETCH_TIMEOUT_MS = 30_000;

function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return true;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return true;
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return true;
    octets.push(n);
  }
  const [a, b] = octets;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT (RFC 6598)
  return false;
}

// Numeric compare so every textual form of loopback/unspecified is caught
// (::1, 0::1, 0:0:0:0:0:0:0:1, ::, ::0, 0::0, ...), not just the two
// compressed spellings. addr must already be lowercased with any %zone cut.
function isLoopbackOrUnspecifiedIPv6(addr: string): boolean {
  let groups: string[];
  const compression = addr.indexOf("::");
  if (compression !== -1) {
    if (addr.indexOf("::", compression + 2) !== -1) return false;
    const left = compression === 0 ? [] : addr.slice(0, compression).split(":");
    const right = compression + 2 >= addr.length ? [] : addr.slice(compression + 2).split(":");
    if (left.includes("") || right.includes("")) return false;
    const missing = 8 - (left.length + right.length);
    if (missing < 0) return false;
    groups = [...left, ...Array<string>(missing).fill("0"), ...right];
  } else {
    groups = addr.split(":");
    if (groups.length !== 8) return false;
  }
  if (groups.length !== 8) return false;
  const nums: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return false;
    nums.push(Number.parseInt(g, 16));
  }
  if (nums.every((n) => n === 0)) return true; // :: and equivalents
  if (nums.slice(0, 7).every((n) => n === 0) && nums[7] === 1) return true; // ::1 equivalents
  return false;
}

function isBlockedIp(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isBlockedIPv4(ip);
  if (family !== 6) return true; // fail closed on malformed input
  const addr = ip.toLowerCase().split("%")[0];
  // Dotted-embedded IPv6 (IPv4-mapped/compatible in any notation): the tail
  // is an IPv4 address inside IPv6 space, never a legitimate fetch target.
  const tail = addr.slice(addr.lastIndexOf(":") + 1);
  if (tail.includes(".")) return true;
  if (isLoopbackOrUnspecifiedIPv6(addr)) return true; // loopback / unspecified
  // Block IPv4-compatible IPv6 (::/96, deprecated RFC 4291) in any notation:
  // ::7f00:1, ::a9fe:a9fe, 0:0:0:0:0:0:7f00:1, etc. First 96 bits zero.
  // Dotted tails already returned true above; ::, ::1 already blocked.
  let compatGroups: string[];
  const compIdx = addr.indexOf("::");
  if (compIdx !== -1) {
    const left = compIdx === 0 ? [] : addr.slice(0, compIdx).split(":");
    const right = compIdx + 2 >= addr.length ? [] : addr.slice(compIdx + 2).split(":");
    const missing = 8 - (left.length + right.length);
    if (missing < 0) return true;
    compatGroups = [...left, ...Array<string>(missing).fill("0"), ...right];
  } else {
    compatGroups = addr.split(":");
  }
  if (compatGroups.length === 8 && compatGroups.slice(0, 6).every((g) => /^0+$/.test(g)))
    return true;
  const groups = addr.split(":");
  // ::ffff:0:0/96 in fully expanded form (compressed forms start with
  // "::ffff:" and are caught below).
  if (
    groups.length === 8 &&
    groups.slice(0, 5).every((g) => /^0+$/.test(g)) &&
    /^ffff$/i.test(groups[5])
  ) {
    return true;
  }
  if (addr.startsWith("::ffff:")) return true; // ::ffff:0:0/96 compressed
  const first = groups[0];
  if (first !== "") {
    const v = Number.parseInt(first, 16);
    if (Number.isInteger(v)) {
      if (v >= 0xfc00 && v <= 0xfdff) return true; // fc00::/7 unique-local
      if (v >= 0xfe80 && v <= 0xfebf) return true; // fe80::/10 link-local
    }
  }
  return false;
}

export class FilesController {
  constructor(private fileService: FileService) {}

  // Max number of `file` file-parts accepted in a single upload request.
  // busboy (via @fastify/multipart) has no file-count limit by default
  // (parts defaults to 1000, files is unbounded), so the routes-level
  // `limits.files` mirrors this value and the in-controller check below is
  // the authoritative guard. Documented policy: at most 5 file parts per
  // request; the last staged file part wins (pre-existing behavior).
  public static readonly MAX_FILE_PARTS_PER_REQUEST = 5;

  private validatePath(filePath: string): boolean {
    if (path.isAbsolute(filePath)) {
      return false;
    }

    if (filePath.includes("\\")) {
      return false;
    }

    if (filePath.includes("\0")) {
      return false;
    }

    const normalized = path.normalize(filePath);
    if (
      normalized === "." ||
      normalized.startsWith("." + path.sep) ||
      normalized.split(path.sep).includes("..")
    ) {
      return false;
    }

    return true;
  }

  async handleFileUpload(
    server: FastifyInstance,
    request: FastifyRequest<{ Params: { sessionId: string } }>,
    reply: FastifyReply,
  ) {
    // Every staged file part is tracked here so ALL temps are unlinked on
    // every exit (success, invalid-path 400, per-request cap 413, quota
    // 413, pipeline/iteration throw, client abort). Never glob tmpdir():
    // the `upload_` prefix is generic and a glob could delete other
    // processes' files.
    const tempFilePaths: string[] = [];
    const unlinkAllTemps = async (): Promise<void> => {
      await Promise.all(tempFilePaths.map((p) => fs.promises.unlink(p).catch(() => {})));
      tempFilePaths.length = 0;
    };

    // Per-request total-bytes cap, mirroring the global quota config
    // (FileService enforces committed bytes; this guards transient staged
    // bytes before they reach the service). Single global cumulative bucket
    // shared across all sessions, NOT isolated per session.
    const maxTotalBytes: number | undefined = resolveMaxTotalBytes(
      server.steelBrowserConfig?.fileStorage,
    );

    try {
      if (!request.isMultipart()) {
        return reply.code(400).send({
          success: false,
          message: "Request must be multipart/form-data",
        });
      }

      let filePath: string | null = null;
      let fileUrl: string | null = null;
      let fileProvided: boolean = false;
      let filePartCount = 0;
      let totalStagedBytes = 0;
      let saveFileResult: Awaited<ReturnType<typeof this.fileService.saveFile>> | null = null;

      for await (const part of request.parts()) {
        if (part.fieldname === "file") {
          if (part.type === "file") {
            filePartCount += 1;
            if (filePartCount > FilesController.MAX_FILE_PARTS_PER_REQUEST) {
              const stream = part.file;
              if (stream && typeof stream.destroy === "function") {
                stream.destroy();
              }
              await unlinkAllTemps();
              return reply.code(413).send({
                success: false,
                message: `Too many files in the multipart request: at most ${FilesController.MAX_FILE_PARTS_PER_REQUEST} file parts are accepted.`,
              });
            }
            fileProvided = true;

            const stagedPath = path.join(tmpdir(), `upload_${uuidv4()}`);
            tempFilePaths.push(stagedPath);

            const writeStream = fs.createWriteStream(stagedPath);
            await pipeline(part.file, writeStream);
            const { size } = await fs.promises.stat(stagedPath);
            totalStagedBytes += size;
            if (maxTotalBytes !== undefined && totalStagedBytes > maxTotalBytes) {
              await unlinkAllTemps();
              return reply.code(413).send({
                success: false,
                message: `Total upload size exceeds the per-request limit of ${maxTotalBytes} bytes.`,
              });
            }
          } else if (part.type === "field" && typeof part.value === "string") {
            fileUrl = part.value;
          }
        } else if (
          part.fieldname === "path" &&
          part.type === "field" &&
          typeof part.value === "string"
        ) {
          filePath = part.value;
        }
      }

      if (!fileProvided && !fileUrl) {
        return reply.code(400).send({
          success: false,
          message:
            "No file provided in the multipart request. The 'file' field must contain either a file or a URL string.",
        });
      }

      let finalPath: string;

      if (fileProvided && tempFilePaths.length > 0) {
        if (!filePath) {
          finalPath = randomUUID();
        } else {
          if (!this.validatePath(filePath)) {
            await unlinkAllTemps();
            return reply.code(400).send({
              success: false,
              message: "Invalid path provided",
            });
          }
          finalPath = filePath;
        }

        const tempFilePath = tempFilePaths[tempFilePaths.length - 1];
        const { size } = await fs.promises.stat(tempFilePath);
        const readStream = fs.createReadStream(tempFilePath);
        saveFileResult = await this.fileService.saveFile({
          filePath: finalPath,
          stream: readStream,
          size,
        });

        await unlinkAllTemps();
      } else if (fileUrl) {
        let parsedFileUrl: URL;
        try {
          parsedFileUrl = new URL(fileUrl);
        } catch {
          return reply.code(400).send({
            success: false,
            message: "Invalid URL provided",
          });
        }
        if (!filePath) {
          const urlPath = parsedFileUrl.pathname;
          const filename = urlPath.split("/").pop() || randomUUID();
          const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
          finalPath = sanitizedFilename;
        } else {
          if (!this.validatePath(filePath)) {
            return reply.code(400).send({
              success: false,
              message: "Invalid path provided",
            });
          }
          finalPath = filePath;
        }

        // Any failure to fetch the remote URL (blocked host, DNS failure,
        // redirect, non-200, timeout, network error) is a client error: the
        // caller supplied the URL, so it maps to 400, never 500.
        let fetched: Awaited<ReturnType<typeof this.createStreamFromUrl>>;
        try {
          fetched = await this.createStreamFromUrl(fileUrl);
        } catch (e: unknown) {
          const message = e instanceof Error ? e.message : "Failed to fetch file from URL";
          return reply.code(400).send({ success: false, message });
        }
        const { stream, contentLength } = fetched;
        try {
          saveFileResult = await this.fileService.saveFile({
            filePath: finalPath,
            stream,
            size: contentLength,
          });
        } catch (e: unknown) {
          try {
            stream.destroy();
          } catch {}
          if (e instanceof FileQuotaExceededError) throw e;
          if (
            (e as { code?: string })?.code === "ENOSPC" ||
            (e as { code?: string })?.code === "EACCES"
          ) {
            throw e;
          }
          if (
            typeof (e as { statusCode?: unknown })?.statusCode === "number" &&
            (e as { statusCode: number }).statusCode === 413
          ) {
            throw e;
          }
          const message = e instanceof Error ? e.message : "Failed to fetch file from URL";
          return reply.code(400).send({ success: false, message });
        }
      }

      if (!saveFileResult) {
        return reply.code(500).send({
          success: false,
          message: "Failed to save file",
        });
      }

      return reply.send({
        path: saveFileResult.path,
        size: saveFileResult.size,
        lastModified: saveFileResult.lastModified,
      });
    } catch (e: unknown) {
      await unlinkAllTemps();
      if (e instanceof FileQuotaExceededError) {
        return reply.code(413).send({ success: false, message: e.message });
      }
      // Busboy/multipart limit errors (per-file fileSize, files/parts
      // count) carry statusCode 413: map them to 413, never 500.
      if (
        typeof (e as { statusCode?: unknown })?.statusCode === "number" &&
        (e as { statusCode: number }).statusCode === 413
      ) {
        const message = e instanceof Error ? e.message : "Upload exceeds request limits";
        return reply.code(413).send({ success: false, message });
      }
      const error = getErrors(e);
      return reply.code(500).send({ success: false, message: error });
    }
  }

  private async createStreamFromUrl(
    url: string,
  ): Promise<{ stream: Readable; contentType?: string; name: string; contentLength?: number }> {
    // ASSUMPTION: BLOCKLIST, not allowlist. Fetching a file from a URL is a
    // supported feature, so public internet hosts stay fetchable; only
    // non-http(s) schemes and hosts resolving (in ANY DNS record) to
    // loopback, private, link-local, or reserved ranges — plus "localhost"
    // itself — are denied. An allowlist would break the URL-upload feature.
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new InvalidFileUrlError("Invalid URL provided");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new InvalidFileUrlError("Only http and https URLs are allowed");
    }
    const hostname = parsed.hostname
      .toLowerCase()
      .replace(/\.$/, "")
      .replace(/^\[|\]$/g, "");
    if (hostname === "localhost") {
      throw new InvalidFileUrlError("URL host is not allowed");
    }

    // Resolve every A/AAAA record and deny the URL if ANY record is
    // non-public, then pin the outgoing connection to the first validated
    // address with a custom lookup so DNS cannot rebind between validation
    // and connect (no validate-then-connect TOCTOU hole).
    let pinned: string;
    let pinnedRecords: Array<{ address: string; family: number }> = [];
    if (net.isIP(hostname) !== 0) {
      if (isBlockedIp(hostname)) {
        throw new InvalidFileUrlError("URL host is not allowed");
      }
      pinned = hostname;
      pinnedRecords = [{ address: pinned, family: net.isIP(pinned) }];
    } else {
      let records: Array<{ address: string }>;
      try {
        const result = await dnsLookup(hostname, { all: true });
        records = (Array.isArray(result) ? result : [result]) as Array<{ address: string }>;
      } catch {
        throw new InvalidFileUrlError("URL host could not be resolved");
      }
      if (records.length === 0) {
        throw new InvalidFileUrlError("URL host could not be resolved");
      }
      for (const record of records) {
        if (isBlockedIp(record.address)) {
          throw new InvalidFileUrlError("URL host is not allowed");
        }
      }
      pinned = records[0].address;
      pinnedRecords = records.map((r) => ({ address: r.address, family: net.isIP(r.address) }));
    }
    const pinnedFamily = net.isIP(pinned);
    const pinnedLookup = (_host: string, options: unknown, callback?: unknown): void => {
      const done = (typeof options === "function" ? options : callback) as (
        ...args: unknown[]
      ) => void;
      const wantAll =
        typeof options === "object" &&
        options !== null &&
        (options as { all?: unknown }).all === true;
      if (wantAll) {
        done(
          null,
          pinnedRecords.length > 0 ? pinnedRecords : [{ address: pinned, family: pinnedFamily }],
        );
      } else {
        done(null, pinned, pinnedFamily);
      }
    };

    const signal = AbortSignal.timeout(URL_FETCH_TIMEOUT_MS);
    const get = (parsed.protocol === "https:" ? https.get : http.get) as typeof http.get;

    return new Promise((resolve, reject) => {
      const fail = (message: string): void => {
        reject(new InvalidFileUrlError(message));
      };
      let request: ReturnType<typeof http.get>;
      try {
        request = get(parsed, { lookup: pinnedLookup, signal }, (response) => {
          if (signal.aborted) {
            response.destroy();
            fail("Fetching file timed out");
            return;
          }
          // The stdlib never follows redirects on its own; reject every
          // non-200 (including 3xx that carry a Location header) instead
          // of chasing them.
          if (response.statusCode !== 200) {
            response.destroy();
            fail(`Failed to fetch file: ${response.statusCode}`);
            return;
          }

          const contentType = response.headers["content-type"];
          const disposition = response.headers["content-disposition"] || "";
          let name: string | null = null;

          const nameMatch = disposition.match(/filename="(.+)"/i);

          if (nameMatch && nameMatch[1]) {
            name = nameMatch[1];
          } else {
            name = url.split("/").pop() || "downloaded-file";
          }

          let contentLength: number | undefined;
          const rawLength = response.headers["content-length"];
          if (typeof rawLength === "string") {
            const parsedLength = Number.parseInt(rawLength, 10);
            if (Number.isFinite(parsedLength) && parsedLength >= 0) {
              contentLength = parsedLength;
            }
          }

          signal.addEventListener("abort", () => response.destroy(), { once: true });
          resolve({
            stream: response,
            contentType,
            name,
            contentLength,
          });
        });
      } catch (e: unknown) {
        fail(e instanceof Error ? e.message : "Failed to fetch file from URL");
        return;
      }
      request.on("error", (e: Error) => {
        fail(signal.aborted ? "Fetching file timed out" : e.message);
      });
      signal.addEventListener("abort", () => request.destroy(), { once: true });
    });
  }

  async handleFileDownload(
    server: FastifyInstance,
    request: FastifyRequest<{ Params: { sessionId: string; "*": string } }>,
    reply: FastifyReply,
  ) {
    try {
      const { stream, size, lastModified } = await this.fileService.downloadFile({
        filePath: request.params["*"],
      });

      const name = request.params["*"].split("/").pop() || "downloaded-file";

      reply
        .header("Content-Type", mime.lookup(request.params["*"]) || "application/octet-stream")
        .header("Content-Length", size)
        .header("Content-Disposition", attachmentContentDisposition(name))
        .header("Last-Modified", lastModified.toISOString());

      return reply.send(stream);
    } catch (e: unknown) {
      const error = getErrors(e);
      return reply.code(500).send({ success: false, message: error });
    }
  }

  async handleFileHead(
    server: FastifyInstance,
    request: FastifyRequest<{ Params: { sessionId: string; "*": string } }>,
    reply: FastifyReply,
  ) {
    try {
      const { size, lastModified } = await this.fileService.getFile({
        filePath: request.params["*"],
      });

      const name = request.params["*"].split("/").pop() || "downloaded-file";

      reply
        .header("Content-Length", size)
        .header("Last-Modified", lastModified.toISOString())
        .header("Content-Type", mime.lookup(request.params["*"]) || "application/octet-stream")
        .header("Content-Disposition", attachmentContentDisposition(name));

      return reply.code(200).send();
    } catch (e: unknown) {
      const error = getErrors(e);
      return reply.code(500).send({ success: false, message: error });
    }
  }

  async handleFileList(
    server: FastifyInstance,
    request: FastifyRequest<{
      Params: { sessionId: string };
    }>,
    reply: FastifyReply,
  ) {
    try {
      const files = await this.fileService.listFiles();

      return reply.send({
        data: files.map((file) => ({
          path: file.path,
          size: file.size,
          lastModified: file.lastModified,
        })),
      });
    } catch (e: unknown) {
      const error = getErrors(e);
      return reply.code(500).send({ success: false, message: error });
    }
  }

  async handleFileDelete(
    server: FastifyInstance,
    request: FastifyRequest<{ Params: { sessionId: string; "*": string } }>,
    reply: FastifyReply,
  ) {
    try {
      await this.fileService.deleteFile({
        filePath: request.params["*"],
      });
      return reply.code(204).send();
    } catch (e: unknown) {
      const error = getErrors(e);
      return reply.code(500).send({ success: false, message: error });
    }
  }

  async handleFileDeleteAll(
    server: FastifyInstance,
    request: FastifyRequest<{ Params: { sessionId: string } }>,
    reply: FastifyReply,
  ) {
    try {
      await this.fileService.cleanupFiles();
      return reply.code(204).send();
    } catch (e: unknown) {
      const error = getErrors(e);
      return reply.code(500).send({ success: false, message: error });
    }
  }

  async handleDownloadArchive(
    server: FastifyInstance,
    request: FastifyRequest<{ Params: { sessionId: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const prebuiltArchivePath = await this.fileService.getPrebuiltArchivePath();

      const stats = await fs.promises.stat(prebuiltArchivePath);
      if (stats.isFile()) {
        server.log.info(`Serving prebuilt archive: ${prebuiltArchivePath}`);
        const stream = fs.createReadStream(prebuiltArchivePath);

        reply.header("Content-Type", "application/zip");
        reply.header("Content-Disposition", `attachment; filename="files.zip"`);
        reply.header("Content-Length", stats.size);
        reply.header("Last-Modified", stats.mtime.toUTCString());
        return reply.send(stream);
      } else {
        server.log.warn(`Prebuilt archive path exists but is not a file: ${prebuiltArchivePath}`);
      }

      server.log.info("Sending empty archive.");
      reply.header("Content-Type", "application/zip");
      reply.header("Content-Disposition", `attachment; filename="files-archive-empty.zip"`);
      const emptyArchive = archiver("zip", { zlib: { level: 9 } });

      emptyArchive.pipe(reply.raw);

      await emptyArchive.finalize();
      return;
    } catch (err: any) {
      server.log.error({ err }, "Error during handleFileArchive");
      if (!reply.sent) {
        try {
          reply.code(500).send({ message: "Failed to process archive request" });
        } catch (sendError: unknown) {
          server.log.error(
            { err: sendError },
            "Error sending 500 response after archive handling error",
          );
        }
      }
    }
  }
}
