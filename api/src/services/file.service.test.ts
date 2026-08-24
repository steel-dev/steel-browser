import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { inflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FileService } from "./file.service.js";

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
