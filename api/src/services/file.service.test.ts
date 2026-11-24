import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { inflateRawSync } from "node:zlib";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import archiver from "archiver";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FilesController } from "../modules/files/files.controller.js";
import { FileService } from "./file.service.js";

function unzipFiles(buffer: Buffer, includeDirectories = false): Map<string, string> {
  let endOfCentralDirectory = -1;

  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      endOfCentralDirectory = offset;
      break;
    }
  }

  if (endOfCentralDirectory === -1) {
    throw new Error("ZIP end of central directory record not found");
  }

  const entryCount = buffer.readUInt16LE(endOfCentralDirectory + 10);
  let centralDirectoryOffset = buffer.readUInt32LE(endOfCentralDirectory + 16);
  const files = new Map<string, string>();

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(centralDirectoryOffset) !== 0x02014b50) {
      throw new Error(`Invalid ZIP central directory entry at ${centralDirectoryOffset}`);
    }

    const compressionMethod = buffer.readUInt16LE(centralDirectoryOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralDirectoryOffset + 20);
    const fileNameLength = buffer.readUInt16LE(centralDirectoryOffset + 28);
    const extraLength = buffer.readUInt16LE(centralDirectoryOffset + 30);
    const commentLength = buffer.readUInt16LE(centralDirectoryOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(centralDirectoryOffset + 42);
    const fileName = buffer
      .subarray(centralDirectoryOffset + 46, centralDirectoryOffset + 46 + fileNameLength)
      .toString("utf8");

    if (includeDirectories || !fileName.endsWith("/")) {
      const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

      if (compressionMethod !== 0 && compressionMethod !== 8) {
        throw new Error(`Unsupported ZIP compression method ${compressionMethod}`);
      }

      const content = compressionMethod === 0 ? compressed : inflateRawSync(compressed);
      files.set(fileName, content.toString("utf8"));
    }

    centralDirectoryOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  return files;
}

describe("FileService session archives", () => {
  let testDirectory: string | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (testDirectory) {
      await fs.promises.rm(testDirectory, { recursive: true, force: true });
      testDirectory = undefined;
    }
  });

  async function createFileService() {
    testDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "steel-files-archive-"));
    const baseFilesPath = path.join(testDirectory, "files");
    const prebuiltArchiveDir = path.join(testDirectory, "archive");

    return new FileService({
      baseFilesPath,
      prebuiltArchiveDir,
      watchFiles: false,
    });
  }

  it("rebuilds a stale archive with current root and nested entries for concurrent requests", async () => {
    const fileService = await createFileService();
    const baseFilesPath = fileService.getBaseFilesPath();

    await fs.promises.writeFile(path.join(baseFilesPath, "stale.txt"), "stale content");
    await fileService.getPrebuiltArchivePath();
    await fs.promises.rm(path.join(baseFilesPath, "stale.txt"));

    await fileService.saveFile({
      filePath: "zip1.txt",
      stream: Readable.from("zip content 1"),
    });
    await fileService.saveFile({
      filePath: "subdir/zip2.txt",
      stream: Readable.from("zip content 2"),
    });

    const [archivePath, concurrentArchivePath] = await Promise.all([
      fileService.getPrebuiltArchivePath(),
      fileService.getPrebuiltArchivePath(),
    ]);
    const archive = unzipFiles(await fs.promises.readFile(archivePath));

    expect(concurrentArchivePath).toBe(archivePath);
    expect([...archive.entries()]).toEqual([
      ["subdir/zip2.txt", "zip content 2"],
      ["zip1.txt", "zip content 1"],
    ]);
  });

  it("rebuilds again when files change during an in-flight archive", async () => {
    const fileService = await createFileService();
    await fileService.saveFile({
      filePath: "zip1.txt",
      stream: Readable.from("zip content 1"),
    });

    const rename = fs.promises.rename.bind(fs.promises);
    let releaseRename!: () => void;
    const renameReleased = new Promise<void>((resolve) => {
      releaseRename = resolve;
    });
    let signalRenameStarted!: () => void;
    const renameStarted = new Promise<void>((resolve) => {
      signalRenameStarted = resolve;
    });

    vi.spyOn(fs.promises, "rename").mockImplementationOnce(async (oldPath, newPath) => {
      signalRenameStarted();
      await renameReleased;
      await rename(oldPath, newPath);
    });

    const archiveRequests = Promise.all([
      fileService.getPrebuiltArchivePath(),
      fileService.getPrebuiltArchivePath(),
    ]);
    await renameStarted;
    await fileService.saveFile({
      filePath: "nested/zip2.txt",
      stream: Readable.from("zip content 2"),
    });
    releaseRename();

    const [archivePath] = await archiveRequests;
    expect([...unzipFiles(await fs.promises.readFile(archivePath)).entries()]).toEqual([
      ["nested/zip2.txt", "zip content 2"],
      ["zip1.txt", "zip content 1"],
    ]);
  });

  it("retries archive creation after an early failure", async () => {
    testDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "steel-files-archive-"));
    const baseFilesPath = path.join(testDirectory, "files");
    const prebuiltArchiveDir = path.join(testDirectory, "blocked-archive");
    const fileService = new FileService({ baseFilesPath, prebuiltArchiveDir, watchFiles: false });

    await fileService.saveFile({
      filePath: "zip1.txt",
      stream: Readable.from("zip content 1"),
    });
    await fs.promises.writeFile(prebuiltArchiveDir, "not a directory");

    await expect(fileService.getPrebuiltArchivePath()).rejects.toThrow();

    await fs.promises.rm(prebuiltArchiveDir);
    const archivePath = await fileService.getPrebuiltArchivePath();
    expect([...unzipFiles(await fs.promises.readFile(archivePath)).entries()]).toEqual([
      ["zip1.txt", "zip content 1"],
    ]);
  });

  it("keeps empty archives, hidden files, empty directories and symlink entries compatible", async () => {
    const service = await createFileService();
    const archivePath = await service.getPrebuiltArchivePath();
    expect(unzipFiles(await fs.promises.readFile(archivePath))).toEqual(new Map());

    const sourceDir = service.getBaseFilesPath();
    await fs.promises.mkdir(path.join(sourceDir, "empty"));
    await service.saveFile({ filePath: ".hidden", stream: Readable.from("content") });
    await fs.promises.symlink(path.join(sourceDir, ".hidden"), path.join(sourceDir, "link"));

    await service.getPrebuiltArchivePath();
    expect(unzipFiles(await fs.promises.readFile(archivePath), true)).toEqual(
      new Map([
        [".hidden", "content"],
        ["empty/", ""],
        ["link", ".hidden"],
      ]),
    );
  });

  async function seedArchive() {
    const service = await createFileService();
    const sourceDir = service.getBaseFilesPath();
    await fs.promises.writeFile(path.join(sourceDir, "original.txt"), "original");
    const archivePath = await service.getPrebuiltArchivePath();
    const previous = await fs.promises.readFile(archivePath);
    const archiveDir = path.dirname(archivePath);
    const unrelated = path.join(archiveDir, "files-unrelated.zip.tmp");
    await fs.promises.writeFile(unrelated, "unrelated");
    await service.saveFile({ filePath: "new.txt", stream: Readable.from("new") });

    async function expectPreviousArchive() {
      expect(await fs.promises.readFile(archivePath)).toEqual(previous);
      expect(await fs.promises.readFile(unrelated, "utf8")).toBe("unrelated");
      expect(await fs.promises.readFile(path.join(sourceDir, "original.txt"), "utf8")).toBe(
        "original",
      );
      expect(await fs.promises.readFile(path.join(sourceDir, "new.txt"), "utf8")).toBe("new");
    }

    async function expectRetry() {
      expect(await service.getPrebuiltArchivePath()).toBe(archivePath);
      expect(unzipFiles(await fs.promises.readFile(archivePath))).toEqual(
        new Map([
          ["new.txt", "new"],
          ["original.txt", "original"],
        ]),
      );
    }

    return { service, archiveDir, archivePath, expectPreviousArchive, expectRetry };
  }

  it("contains a trailing debounce ENOSPC under strict Node rejection handling", async () => {
    testDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "steel-archive-child-"));
    await promisify(execFile)(
      process.execPath,
      [
        "--unhandled-rejections=strict",
        "--import",
        "tsx",
        fileURLToPath(new URL("./fixtures/archive-background-failure.mjs", import.meta.url)),
      ],
      { env: { ...process.env, TMPDIR: testDirectory }, timeout: 10000 },
    );
  });

  it("shares a background publish failure with foreground callers and retries through Fastify", async () => {
    const { service, archiveDir, archivePath, expectPreviousArchive } = await seedArchive();
    const failure = Object.assign(new Error(`synthetic rename failure at ${archivePath}`), {
      code: "EACCES",
    });
    const publishing = Promise.withResolvers<void>();
    const releasePublish = Promise.withResolvers<void>();
    const rename = vi.spyOn(fs.promises, "rename").mockImplementationOnce(async () => {
      publishing.resolve();
      await releasePublish.promise;
      throw failure;
    });

    const enteredRoute = Promise.withResolvers<void>();
    const server = Fastify();
    const controller = new FilesController(service);
    const route = "/sessions/:sessionId/files.zip";
    server.get<{ Params: { sessionId: string } }>(route, (request, reply) => {
      enteredRoute.resolve();
      return controller.handleDownloadArchive(server, request, reply);
    });

    try {
      await publishing.promise;
      const foreground = expect(service.getPrebuiltArchivePath()).rejects.toBe(failure);
      const response = server.inject("/sessions/test/files.zip");
      await enteredRoute.promise;
      await expectPreviousArchive();
      releasePublish.resolve();
      await foreground;

      const failed = await response;
      expect(failed.statusCode).toBe(500);
      expect(failed.json()).toMatchObject({
        code: "EACCES",
        message: "Failed to build file archive",
      });
      expect(failed.body).not.toContain(archiveDir);
      expect(rename).toHaveBeenCalledTimes(1);
      expect(await fs.promises.readdir(archiveDir)).toEqual([
        "files-unrelated.zip.tmp",
        "files.zip",
      ]);
      await expectPreviousArchive();

      const retried = await server.inject("/sessions/test/files.zip");
      expect(retried.statusCode).toBe(200);
      expect(retried.headers["content-type"]).toBe("application/zip");
      expect(unzipFiles(retried.rawPayload).get("new.txt")).toBe("new");
      expect(rename).toHaveBeenCalledTimes(2);
    } finally {
      releasePublish.resolve();
      await server.close();
    }
  });

  it.each(["open", "close"] as const)("preserves the archive if output %s fails", async (stage) => {
    const { service, archiveDir, expectPreviousArchive, expectRetry } = await seedArchive();
    const failure = Object.assign(new Error(`synthetic output ${stage} failure`), { code: "EIO" });
    const createWriteStream = fs.createWriteStream.bind(fs);
    vi.spyOn(fs, "createWriteStream").mockImplementationOnce((outputPath, options) =>
      createWriteStream(outputPath, {
        ...(typeof options === "object" ? options : {}),
        fs: {
          open: (filename, flags, mode, callback) => {
            if (stage === "open") {
              queueMicrotask(() => callback(failure, 0));
              return;
            }
            fs.open(filename, flags, mode, callback);
          },
          write: fs.write,
          close: (fd, callback) => fs.close(fd, (error) => callback(error ?? failure)),
        },
      }),
    );

    await expect(service.getPrebuiltArchivePath()).rejects.toBe(failure);
    await expectPreviousArchive();
    expect(await fs.promises.readdir(archiveDir)).toEqual(["files-unrelated.zip.tmp", "files.zip"]);
    await expectRetry();
  });

  it("leaves a colliding staging file in place when exclusive open fails", async () => {
    const { service, archiveDir, expectPreviousArchive, expectRetry } = await seedArchive();
    const createWriteStream = fs.createWriteStream.bind(fs);
    const output = vi
      .spyOn(fs, "createWriteStream")
      .mockImplementationOnce((outputPath, options) => {
        fs.writeFileSync(outputPath, "pre-existing file");
        return createWriteStream(outputPath, options);
      });

    await expect(service.getPrebuiltArchivePath()).rejects.toMatchObject({ code: "EEXIST" });
    expect(output).toHaveBeenCalledOnce();
    const collision = output.mock.calls[0][0];
    expect(await fs.promises.readFile(collision, "utf8")).toBe("pre-existing file");
    await expectPreviousArchive();
    await expectRetry();
    expect(await fs.promises.readdir(archiveDir)).toHaveLength(3);
  });

  it("preserves the input read failure and closes its stream", async () => {
    const { service, expectPreviousArchive, expectRetry } = await seedArchive();
    const failure = Object.assign(new Error("synthetic read failure"), { code: "EIO" });
    const createReadStream = fs.createReadStream.bind(fs);
    const source = vi.spyOn(fs, "createReadStream").mockImplementationOnce((file, options) =>
      createReadStream(file, {
        ...(typeof options === "object" ? options : {}),
        fs: {
          open: fs.open,
          close: fs.close,
          read: (_fd, buffer, _offset, _length, _position, callback) =>
            queueMicrotask(() => callback(failure, 0, buffer)),
        },
      }),
    );

    await expect(service.getPrebuiltArchivePath()).rejects.toBe(failure);
    expect(source.mock.results[0].value.closed).toBe(true);
    await expectPreviousArchive();
    await expectRetry();
  });

  it("preserves a finalize rejection when abort and staging cleanup also fail", async () => {
    const { service, archiveDir, expectPreviousArchive, expectRetry } = await seedArchive();
    const failure = new Error("synthetic finalize rejection");
    const brokenArchive = archiver("zip");
    vi.spyOn(brokenArchive, "finalize").mockRejectedValueOnce(failure);
    const abort = vi.spyOn(brokenArchive, "abort").mockImplementationOnce(() => {
      throw new Error("synthetic abort failure");
    });
    vi.spyOn(archiver, "create").mockReturnValueOnce(brokenArchive);
    vi.spyOn(fs.promises, "unlink").mockRejectedValueOnce(new Error("synthetic cleanup failure"));

    await expect(service.getPrebuiltArchivePath()).rejects.toBe(failure);
    expect(abort).toHaveBeenCalledOnce();
    await expectPreviousArchive();
    const leftover = (await fs.promises.readdir(archiveDir)).filter(
      (name) => name !== "files.zip" && name !== "files-unrelated.zip.tmp",
    );
    expect(leftover).toHaveLength(1);
    await expectRetry();
    expect(await fs.promises.readdir(archiveDir)).toContain(leftover[0]);
  });

  it("cancels active input on output failure", async () => {
    const { service, expectPreviousArchive, expectRetry } = await seedArchive();
    const failure = Object.assign(new Error("synthetic downstream write failure"), {
      code: "ENOSPC",
    });
    const createReadStream = fs.createReadStream.bind(fs);
    const source = vi.spyOn(fs, "createReadStream").mockImplementationOnce((file, options) =>
      createReadStream(file, {
        ...(typeof options === "object" ? options : {}),
        fs: {
          open: fs.open,
          close: fs.close,
          read: (_fd, buffer, _offset, _length, _position, callback) =>
            // Keep this read active when the ZIP entry header hits the failing output.
            queueMicrotask(() => callback(null, 1, buffer.fill(0))),
        },
      }),
    );
    const createWriteStream = fs.createWriteStream.bind(fs);
    vi.spyOn(fs, "createWriteStream").mockImplementationOnce((outputPath, options) =>
      createWriteStream(outputPath, {
        ...(typeof options === "object" ? options : {}),
        fs: {
          open: fs.open,
          close: fs.close,
          write: (_fd, _buffer, _offset, _length, _position, callback) =>
            queueMicrotask(() => callback(failure, 0)),
        },
      }),
    );

    await expect(service.getPrebuiltArchivePath()).rejects.toBe(failure);
    expect(source.mock.results[0].value.closed).toBe(true);
    await expectPreviousArchive();
    await expectRetry();
  }, 5000);

  it("settles an archive-side cancellation even if finalize stays pending and rejects late", async () => {
    const { service, expectPreviousArchive, expectRetry } = await seedArchive();
    const failure = new Error("synthetic archive stream error");
    const brokenArchive = archiver("zip");
    const finalizing = Promise.withResolvers<void>();
    vi.spyOn(brokenArchive, "finalize").mockImplementationOnce(() => {
      queueMicrotask(() => brokenArchive.emit("error", failure));
      return finalizing.promise;
    });
    vi.spyOn(archiver, "create").mockReturnValueOnce(brokenArchive);

    await expect(service.getPrebuiltArchivePath()).rejects.toBe(failure);
    finalizing.reject(new Error("late finalize failure"));
    await setImmediate();
    await expectPreviousArchive();
    await expectRetry();
  }, 5000);
});
