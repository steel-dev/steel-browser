import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { inflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FileQuotaExceededError, FileService } from "./file.service.js";

function unzipFiles(buffer: Buffer): Map<string, string> {
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

    if (!fileName.endsWith("/")) {
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
});

describe("FileService cumulative quota (maxSizeBytes)", () => {
  let testDirectory: string | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (testDirectory) {
      await fs.promises.rm(testDirectory, { recursive: true, force: true });
      testDirectory = undefined;
    }
  });

  async function createQuotaService(maxSizeBytes?: number) {
    testDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "steel-files-quota-"));
    return new FileService({
      baseFilesPath: path.join(testDirectory, "files"),
      prebuiltArchiveDir: path.join(testDirectory, "archive"),
      watchFiles: false,
      ...(maxSizeBytes === undefined ? {} : { maxSizeBytes }),
    });
  }

  it("rejects a save that would exceed maxSizeBytes and keeps only prior files", async () => {
    const fileService = await createQuotaService(100);

    await fileService.saveFile({
      filePath: "a.bin",
      stream: Readable.from(Buffer.alloc(40, 0x61)),
    });
    await fileService.saveFile({
      filePath: "b.bin",
      stream: Readable.from(Buffer.alloc(40, 0x61)),
    });
    await expect(
      fileService.saveFile({
        filePath: "c.bin",
        stream: Readable.from(Buffer.alloc(40, 0x61)),
      }),
    ).rejects.toThrow(FileQuotaExceededError);

    const entries = await fs.promises.readdir(fileService.getBaseFilesPath());
    expect(entries.sort()).toEqual(["a.bin", "b.bin"]);
  });

  it("allows overwriting an existing file when the replacement fits in quota", async () => {
    const fileService = await createQuotaService(100);

    await fileService.saveFile({
      filePath: "a.bin",
      stream: Readable.from(Buffer.alloc(60, 0x61)),
    });
    await fileService.saveFile({
      filePath: "b.bin",
      stream: Readable.from(Buffer.alloc(40, 0x61)),
    });

    // Stored total is exactly 100; replacing a.bin (60 bytes) with 40 bytes
    // fits only when the overwritten size is subtracted from usage.
    const result = await fileService.saveFile({
      filePath: "a.bin",
      stream: Readable.from(Buffer.alloc(40, 0x62)),
    });
    expect(result.size).toBe(40);
  });

  function* byteChunks(count: number) {
    for (let index = 0; index < count; index += 1) {
      yield Buffer.alloc(1, 0x61);
    }
  }

  async function* delayedChunks(count: number, chunkSize: number) {
    for (let index = 0; index < count; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      yield Buffer.alloc(chunkSize, 0x61);
    }
  }

  it("aborts unknown-length streams over quota and removes the partial file", async () => {
    const fileService = await createQuotaService(100);

    await expect(
      fileService.saveFile({ filePath: "big.bin", stream: Readable.from(byteChunks(200)) }),
    ).rejects.toThrow(FileQuotaExceededError);
    expect(await fs.promises.readdir(fileService.getBaseFilesPath())).toEqual([]);
  });

  it("keeps the original file when an overwrite is rejected", async () => {
    const fileService = await createQuotaService(100);

    await fileService.saveFile({
      filePath: "a.bin",
      stream: Readable.from(Buffer.alloc(30, 0x61)),
    });
    await fileService.saveFile({
      filePath: "b.bin",
      stream: Readable.from(Buffer.alloc(60, 0x62)),
    });

    await expect(
      fileService.saveFile({ filePath: "a.bin", stream: Readable.from(byteChunks(50)) }),
    ).rejects.toThrow(FileQuotaExceededError);

    const original = await fs.promises.readFile(path.join(fileService.getBaseFilesPath(), "a.bin"));
    expect(original.equals(Buffer.alloc(30, 0x61))).toBe(true);
    expect((await fs.promises.readdir(fileService.getBaseFilesPath())).sort()).toEqual([
      "a.bin",
      "b.bin",
    ]);
  });

  it("rejects a declared size over quota without reading the stream", async () => {
    const fileService = await createQuotaService(100);
    const read = vi.fn();
    const stream = new Readable({ read });

    await expect(fileService.saveFile({ filePath: "big.bin", stream, size: 101 })).rejects.toThrow(
      FileQuotaExceededError,
    );
    expect(read).not.toHaveBeenCalled();
    expect(stream.destroyed).toBe(true);
  });

  it.each([".", ".steel-upload-1", "nested/.steel-upload-2"])(
    "rejects %s as a save target without reading the stream",
    async (filePath) => {
      const fileService = await createQuotaService(100);
      let reads = 0;
      const stream = new Readable({
        read() {
          reads += 1;
          this.push(Buffer.alloc(10, 0x61));
          this.push(null);
        },
      });

      await expect(fileService.saveFile({ filePath, stream })).rejects.toThrow("Invalid path");
      expect(reads).toBe(0);
      expect(stream.destroyed).toBe(true);
      expect(await fs.promises.readdir(fileService.getBaseFilesPath())).toEqual([]);
    },
  );

  it("holds the quota across concurrent saves", async () => {
    const fileService = await createQuotaService(100);

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, index) =>
        fileService.saveFile({
          filePath: `file-${index}.bin`,
          stream: Readable.from(delayedChunks(9, 10)),
        }),
      ),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await fs.promises.readdir(fileService.getBaseFilesPath())).toHaveLength(1);
    const files = await fileService.listFiles();
    expect(files.reduce((total, file) => total + file.size, 0)).toBe(90);
  });

  it("rechecks the quota when another save commits during an upload", async () => {
    const fileService = await createQuotaService(100);
    const baseFilesPath = fileService.getBaseFilesPath();
    const slowStream = new PassThrough();

    const slowSave = fileService.saveFile({ filePath: "slow.bin", stream: slowStream });
    await once(slowStream, "resume");
    slowStream.write(Buffer.alloc(10, 0x62));
    await vi.waitFor(async () => {
      expect(await fs.promises.readdir(baseFilesPath)).toHaveLength(1);
    });
    expect(await fileService.listFiles()).toEqual([]);

    await fileService.saveFile({
      filePath: "fast.bin",
      stream: Readable.from(Buffer.alloc(60, 0x61)),
    });
    slowStream.end(Buffer.alloc(50, 0x62));

    await expect(slowSave).rejects.toThrow(FileQuotaExceededError);
    expect(await fs.promises.readdir(baseFilesPath)).toEqual(["fast.bin"]);
  });

  it("stays unbounded when maxSizeBytes is unset", async () => {
    const fileService = await createQuotaService();

    for (const name of ["a.bin", "b.bin", "c.bin"]) {
      const result = await fileService.saveFile({
        filePath: name,
        stream: Readable.from(Buffer.alloc(40, 0x61)),
      });
      expect(result.size).toBe(40);
    }

    const entries = await fs.promises.readdir(fileService.getBaseFilesPath());
    expect(entries).toHaveLength(3);
  });
});
