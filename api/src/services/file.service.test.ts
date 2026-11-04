import { randomUUID } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { inflateRawSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    expect([...archive.entries()].sort((a, b) => a[0].localeCompare(b[0]))).toEqual([
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
    expect(
      [...unzipFiles(await fs.promises.readFile(archivePath)).entries()].sort((a, b) =>
        a[0].localeCompare(b[0]),
      ),
    ).toEqual([
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

  it.each([".steel-upload-1", "nested/.steel-upload-2"])(
    "rejects %s as a delete target without touching disk or quota",
    async (filePath) => {
      const fileService = await createQuotaService(100);
      await fileService.saveFile({
        filePath: "a.bin",
        stream: Readable.from(Buffer.alloc(60, 0x61)),
      });

      // Seed a staging orphan directly on disk (mirrors a crash leftover;
      // saveFile itself can never create it at this path via the API guard).
      const baseFilesPath = fileService.getBaseFilesPath();
      const stagingAbsPath = path.join(baseFilesPath, filePath);
      await fs.promises.mkdir(path.dirname(stagingAbsPath), { recursive: true });
      await fs.promises.writeFile(stagingAbsPath, Buffer.alloc(10, 0x62));
      const unlinkSpy = vi.spyOn(fs.promises, "unlink");

      await expect(fileService.deleteFile({ filePath })).rejects.toThrow("Invalid path");

      // Staging file survives untouched and no unlink was attempted.
      expect(unlinkSpy).not.toHaveBeenCalled();
      vi.restoreAllMocks();
      expect(await fs.promises.readFile(stagingAbsPath)).toEqual(Buffer.alloc(10, 0x62));

      // Quota accounting is unchanged: 60 bytes still committed, so a further
      // 50 bytes must still exceed the 100-byte limit. A buggy delete that
      // unlinked the 10-byte staging file would have decremented the counter
      // to 50 and wrongly allowed this save.
      await expect(
        fileService.saveFile({
          filePath: "b.bin",
          stream: Readable.from(Buffer.alloc(50, 0x63)),
        }),
      ).rejects.toThrow(FileQuotaExceededError);
      expect((await fileService.listFiles()).reduce((total, file) => total + file.size, 0)).toBe(
        60,
      );
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

describe("FileService delete/commit serialization", () => {
  let testDirectory: string | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (testDirectory) {
      await fs.promises.rm(testDirectory, { recursive: true, force: true });
      testDirectory = undefined;
    }
  });

  async function createDeleteService() {
    testDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "steel-files-delete-"));
    return new FileService({
      baseFilesPath: path.join(testDirectory, "files"),
      prebuiltArchiveDir: path.join(testDirectory, "archive"),
      watchFiles: false,
    });
  }

  async function gateRenameOnce() {
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

    return { renameStarted, releaseRename };
  }

  it("a delete queued during a save commit removes the committed file", async () => {
    const fileService = await createDeleteService();
    const baseFilesPath = fileService.getBaseFilesPath();
    await fs.promises.writeFile(path.join(baseFilesPath, "victim.txt"), "old content");

    const { renameStarted, releaseRename } = await gateRenameOnce();
    const savePromise = fileService.saveFile({
      filePath: "victim.txt",
      stream: Readable.from("new content"),
    });
    // The commit (quota recheck + rename) is now parked inside the queue;
    // the delete below must run after it, never between check and rename.
    await renameStarted;
    const deletePromise = fileService.deleteFile({ filePath: "victim.txt" });
    releaseRename();

    await expect(Promise.all([savePromise, deletePromise])).resolves.toBeDefined();
    await expect(fs.promises.stat(path.join(baseFilesPath, "victim.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("delete-all queued during a save commit leaves no resurrected file", async () => {
    const fileService = await createDeleteService();
    const baseFilesPath = fileService.getBaseFilesPath();
    await fs.promises.writeFile(path.join(baseFilesPath, "stale.txt"), "stale");

    const { renameStarted, releaseRename } = await gateRenameOnce();
    const savePromise = fileService.saveFile({
      filePath: "fresh.txt",
      stream: Readable.from("fresh content"),
    });
    // The commit is parked inside the queue; cleanup must run after it, so
    // the rename cannot land after the rm-loop and resurrect the file.
    await renameStarted;
    const cleanupPromise = fileService.cleanupFiles();
    releaseRename();

    await expect(Promise.all([savePromise, cleanupPromise])).resolves.toBeDefined();
    expect(await fs.promises.readdir(baseFilesPath)).toEqual([]);
  });

  it("resets cached quota when cleanup finds the base dir missing (ENOENT)", async () => {
    testDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "steel-files-delete-"));
    const fileService = new FileService({
      baseFilesPath: path.join(testDirectory, "files"),
      prebuiltArchiveDir: path.join(testDirectory, "archive"),
      watchFiles: false,
      maxSizeBytes: 100,
    });

    await fileService.saveFile({
      filePath: "a.bin",
      stream: Readable.from(Buffer.alloc(60, 0x61)),
    });
    // External removal: base dir is gone, so the cleanup rm-loop hits ENOENT.
    await fs.promises.rm(fileService.getBaseFilesPath(), { recursive: true, force: true });

    await expect(fileService.cleanupFiles()).resolves.toBeUndefined();

    // Quota cache was reset to 0: 60 bytes now fits (60 + 60 would exceed 100 without reset).
    const result = await fileService.saveFile({
      filePath: "b.bin",
      stream: Readable.from(Buffer.alloc(60, 0x62)),
    });
    expect(result.size).toBe(60);
  });

  it.each([null, undefined])(
    "handles %s readdir rejection during cleanup without a secondary throw",
    async (rejection) => {
      testDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "steel-files-delete-"));
      const fileService = new FileService({
        baseFilesPath: path.join(testDirectory, "files"),
        prebuiltArchiveDir: path.join(testDirectory, "archive"),
        watchFiles: false,
        maxSizeBytes: 100,
      });

      await fileService.saveFile({
        filePath: "a.bin",
        stream: Readable.from(Buffer.alloc(60, 0x61)),
      });

      vi.spyOn(fs.promises, "readdir").mockImplementation(() => Promise.reject(rejection));
      await expect(fileService.cleanupFiles()).resolves.toBeUndefined();
      vi.restoreAllMocks();

      // Non-ENOENT failure leaves the cached quota intact: 60 + 50 still exceeds 100.
      await expect(
        fileService.saveFile({
          filePath: "b.bin",
          stream: Readable.from(Buffer.alloc(50, 0x63)),
        }),
      ).rejects.toThrow(FileQuotaExceededError);
    },
  );

  it("concurrent deletes of the same file are idempotent", async () => {
    const fileService = await createDeleteService();
    const baseFilesPath = fileService.getBaseFilesPath();
    await fs.promises.writeFile(path.join(baseFilesPath, "gone.txt"), "bye");

    const unlink = fs.promises.unlink.bind(fs.promises);
    let releaseUnlink!: () => void;
    const unlinkReleased = new Promise<void>((resolve) => {
      releaseUnlink = resolve;
    });
    let signalUnlinkStarted!: () => void;
    const unlinkStarted = new Promise<void>((resolve) => {
      signalUnlinkStarted = resolve;
    });

    vi.spyOn(fs.promises, "unlink").mockImplementationOnce(async (unlinkPath) => {
      signalUnlinkStarted();
      await unlinkReleased;
      await unlink(unlinkPath);
    });

    const first = fileService.deleteFile({ filePath: "gone.txt" });
    await unlinkStarted;
    // Whichever unlink runs second must see ENOENT and treat it as success.
    // Order-independent: exactly one unlink can win the real filesystem.
    const second = fileService.deleteFile({ filePath: "gone.txt" });
    releaseUnlink();

    await expect(Promise.all([first, second])).resolves.toBeDefined();
    await expect(fs.promises.stat(path.join(baseFilesPath, "gone.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("a commit whose first rename hits ENOENT recreates the parent and retries", async () => {
    const fileService = await createDeleteService();
    const baseFilesPath = fileService.getBaseFilesPath();

    vi.spyOn(fs.promises, "rename").mockImplementationOnce(async () => {
      throw Object.assign(new Error("no such file or directory, rename"), { code: "ENOENT" });
    });

    const result = await fileService.saveFile({
      filePath: "nested/retry.txt",
      stream: Readable.from("retry me"),
    });

    expect(result.size).toBe(8);
    expect(await fs.promises.readFile(path.join(baseFilesPath, "nested/retry.txt"), "utf8")).toBe(
      "retry me",
    );
  });

  it("a commit that keeps hitting ENOENT fails with a clean error", async () => {
    const fileService = await createDeleteService();

    vi.spyOn(fs.promises, "rename").mockRejectedValue(
      Object.assign(new Error("no such file or directory, rename"), { code: "ENOENT" }),
    );

    await expect(
      fileService.saveFile({ filePath: "lost.txt", stream: Readable.from("lost content") }),
    ).rejects.toThrow("Upload target was removed during save");
  });
});

describe("FileService symlink hardening", () => {
  let testDirectory: string | undefined;
  let outsideDirectory: string | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (testDirectory) {
      await fs.promises.rm(testDirectory, { recursive: true, force: true });
      testDirectory = undefined;
    }
    if (outsideDirectory) {
      await fs.promises.rm(outsideDirectory, { recursive: true, force: true });
      outsideDirectory = undefined;
    }
  });

  async function createSymlinkService() {
    testDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "steel-files-symlink-"));
    outsideDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "steel-files-outside-"));
    return new FileService({
      baseFilesPath: path.join(testDirectory, "files"),
      prebuiltArchiveDir: path.join(testDirectory, "archive"),
      watchFiles: false,
    });
  }

  async function trySymlink(target: string, linkPath: string, type?: string): Promise<boolean> {
    try {
      await fs.promises.symlink(target, linkPath, type as "file");
      return true;
    } catch (error: any) {
      if (["EPERM", "EACCES", "ENOSYS", "EINVAL", "EUNKNOWN"].includes(error?.code)) {
        return false;
      }
      throw error;
    }
  }

  const dirLinkType = process.platform === "win32" ? "junction" : undefined;
  const fileLinkType = process.platform === "win32" ? "file" : undefined;

  it("rejects save/download/get/delete through a direct file symlink", async () => {
    const fileService = await createSymlinkService();
    const baseFilesPath = fileService.getBaseFilesPath();
    const secretPath = path.join(outsideDirectory!, "secret.txt");
    await fs.promises.writeFile(secretPath, "outside secret");

    if (!(await trySymlink(secretPath, path.join(baseFilesPath, "link.txt"), fileLinkType))) {
      return;
    }

    await expect(
      fileService.saveFile({ filePath: "link.txt", stream: Readable.from("evil") }),
    ).rejects.toThrow("Invalid path");
    await expect(fileService.downloadFile({ filePath: "link.txt" })).rejects.toThrow(
      "Invalid path",
    );
    await expect(fileService.getFile({ filePath: "link.txt" })).rejects.toThrow("Invalid path");
    await expect(fileService.deleteFile({ filePath: "link.txt" })).rejects.toThrow("Invalid path");

    expect(await fs.promises.readFile(secretPath, "utf8")).toBe("outside secret");
    const linkStat = await fs.promises.lstat(path.join(baseFilesPath, "link.txt"));
    expect(linkStat.isSymbolicLink()).toBe(true);
  });

  it("rejects save/download through a parent-directory symlink", async () => {
    const fileService = await createSymlinkService();
    const baseFilesPath = fileService.getBaseFilesPath();
    const realDir = path.join(outsideDirectory!, "realdir");
    await fs.promises.mkdir(realDir, { recursive: true });
    await fs.promises.writeFile(path.join(realDir, "inner.txt"), "outside inner");

    if (!(await trySymlink(realDir, path.join(baseFilesPath, "sub"), dirLinkType))) {
      return;
    }

    await expect(
      fileService.saveFile({ filePath: "sub/evil.txt", stream: Readable.from("evil") }),
    ).rejects.toThrow("Invalid path");
    await expect(fileService.downloadFile({ filePath: "sub/inner.txt" })).rejects.toThrow(
      "Invalid path",
    );
    await expect(fileService.getFile({ filePath: "sub/inner.txt" })).rejects.toThrow(
      "Invalid path",
    );
    await expect(fileService.deleteFile({ filePath: "sub/inner.txt" })).rejects.toThrow(
      "Invalid path",
    );

    await expect(fs.promises.readFile(path.join(realDir, "inner.txt"), "utf8")).resolves.toBe(
      "outside inner",
    );
    const subStat = await fs.promises.lstat(path.join(baseFilesPath, "sub"));
    expect(subStat.isSymbolicLink()).toBe(true);
  });

  it("rejects dangling symlinks", async () => {
    const fileService = await createSymlinkService();
    const baseFilesPath = fileService.getBaseFilesPath();

    if (
      !(await trySymlink(
        path.join(baseFilesPath, "no-such-target.txt"),
        path.join(baseFilesPath, "dangling.txt"),
        fileLinkType,
      ))
    ) {
      return;
    }

    await expect(
      fileService.saveFile({ filePath: "dangling.txt", stream: Readable.from("evil") }),
    ).rejects.toThrow("Invalid path");
    await expect(fileService.downloadFile({ filePath: "dangling.txt" })).rejects.toThrow(
      "Invalid path",
    );
    await expect(fileService.getFile({ filePath: "dangling.txt" })).rejects.toThrow("Invalid path");
    await expect(fileService.deleteFile({ filePath: "dangling.txt" })).rejects.toThrow(
      "Invalid path",
    );
  });

  it("keeps normal files working while excluding symlinks from list and archive", async () => {
    const fileService = await createSymlinkService();
    const baseFilesPath = fileService.getBaseFilesPath();
    const secretPath = path.join(outsideDirectory!, "secret.txt");
    await fs.promises.writeFile(secretPath, "outside secret");

    const saved = await fileService.saveFile({
      filePath: "good.txt",
      stream: Readable.from("inside content"),
    });
    expect(saved.size).toBe("inside content".length);
    expect((await fileService.getFile({ filePath: "good.txt" })).size).toBe(
      "inside content".length,
    );

    const downloaded = await fileService.downloadFile({ filePath: "good.txt" });
    const chunks: Buffer[] = [];
    for await (const chunk of downloaded.stream) {
      chunks.push(Buffer.from(chunk as unknown as Uint8Array));
    }
    expect(Buffer.concat(chunks).toString("utf8")).toBe("inside content");

    const hasFileLink = await trySymlink(
      secretPath,
      path.join(baseFilesPath, "link.txt"),
      fileLinkType,
    );

    const outsideSubDir = path.join(outsideDirectory!, "realdir");
    await fs.promises.mkdir(outsideSubDir, { recursive: true });
    await fs.promises.writeFile(path.join(outsideSubDir, "evil.txt"), "outside dir secret");
    const hasDirLink = await trySymlink(
      outsideSubDir,
      path.join(baseFilesPath, "sub"),
      dirLinkType,
    );

    if (!hasFileLink && !hasDirLink) {
      return;
    }

    const listed = await fileService.listFiles();
    expect(listed.map((entry) => path.basename(entry.path))).toEqual(["good.txt"]);

    const archivePath = await fileService.getPrebuiltArchivePath();
    const archive = unzipFiles(await fs.promises.readFile(archivePath));
    expect([...archive.keys()]).toEqual(["good.txt"]);
    expect(archive.get("good.txt")).toBe("inside content");
  });

  it("rejects when lstat reports a symlink (OS-independent)", async () => {
    const fileService = await createSymlinkService();
    await fileService.saveFile({ filePath: "real.txt", stream: Readable.from("data") });
    const target = path.join(fileService.getBaseFilesPath(), "real.txt");

    const realLstat = fs.promises.lstat.bind(fs.promises);
    const fakeLink = {
      isSymbolicLink: () => true,
      isFile: () => false,
      isDirectory: () => false,
    } as unknown as fs.Stats;
    let symlinkTrapHit = false;
    vi.spyOn(fs.promises, "lstat").mockImplementation(async (linkPath: any, ...rest: any[]) => {
      if (path.resolve(linkPath) === path.resolve(target)) {
        symlinkTrapHit = true;
        return fakeLink;
      }
      return (realLstat as any)(linkPath, ...rest);
    });

    await expect(
      fileService.saveFile({ filePath: "real.txt", stream: Readable.from("evil") }),
    ).rejects.toThrow("Invalid path");
    await expect(fileService.downloadFile({ filePath: "real.txt" })).rejects.toThrow(
      "Invalid path",
    );
    await expect(fileService.getFile({ filePath: "real.txt" })).rejects.toThrow("Invalid path");
    await expect(fileService.deleteFile({ filePath: "real.txt" })).rejects.toThrow("Invalid path");
    // Guard against silent fall-through: proves the rejections above came from
    // the mocked symlink branch, not another "Invalid path" path.
    expect(symlinkTrapHit).toBe(true);
  });

  it("windows fallback re-lstats before stat so a swapped symlink is denied", async () => {
    const fileService = await createSymlinkService();
    await fileService.saveFile({ filePath: "real.txt", stream: Readable.from("data") });
    const target = path.join(fileService.getBaseFilesPath(), "real.txt");

    // Force the Windows branch regardless of host OS.
    vi.spyOn(fileService as any, "supportsNoFollow").mockReturnValue(false);

    const realLstat = fs.promises.lstat.bind(fs.promises);
    const fakeLink = {
      isSymbolicLink: () => true,
      isFile: () => false,
      isDirectory: () => false,
    } as unknown as fs.Stats;
    let fallbackTrapHit = false;
    vi.spyOn(fs.promises, "lstat").mockImplementation(async (linkPath: any, ...rest: any[]) => {
      if (path.resolve(linkPath) === path.resolve(target)) {
        fallbackTrapHit = true;
        return fakeLink;
      }
      return (realLstat as any)(linkPath, ...rest);
    });

    await expect(fileService.downloadFile({ filePath: "real.txt" })).rejects.toThrow(
      "Invalid path",
    );
    await expect(fileService.getFile({ filePath: "real.txt" })).rejects.toThrow("Invalid path");
    expect(fallbackTrapHit).toBe(true);
  });

  it("windows fallback maps a non-file reported by re-lstat to a 404-class error", async () => {
    const fileService = await createSymlinkService();
    await fileService.saveFile({ filePath: "real.txt", stream: Readable.from("data") });
    const target = path.join(fileService.getBaseFilesPath(), "real.txt");

    vi.spyOn(fileService as any, "supportsNoFollow").mockReturnValue(false);

    const realLstat = fs.promises.lstat.bind(fs.promises);
    const fakeDir = {
      isSymbolicLink: () => false,
      isFile: () => false,
      isDirectory: () => true,
    } as unknown as fs.Stats;
    vi.spyOn(fs.promises, "lstat").mockImplementation(async (linkPath: any, ...rest: any[]) => {
      if (path.resolve(linkPath) === path.resolve(target)) {
        return fakeDir;
      }
      return (realLstat as any)(linkPath, ...rest);
    });

    // A directory is not a symlink: it must not map to "Invalid path" (400).
    // The service wraps the not-a-file error as "File not found or inaccessible",
    // which the controller maps to 404 — same as the POSIX branch.
    await expect(fileService.downloadFile({ filePath: "real.txt" })).rejects.toThrow(
      "File not found or inaccessible",
    );
    await expect(fileService.getFile({ filePath: "real.txt" })).rejects.toThrow(
      "File not found or inaccessible",
    );
    await expect(fileService.downloadFile({ filePath: "real.txt" })).rejects.not.toThrow(
      "Invalid path",
    );
    await expect(fileService.getFile({ filePath: "real.txt" })).rejects.not.toThrow("Invalid path");
  });

  it("maps a real dir-as-file to a 404-class error on POSIX and Windows branches", async () => {
    const fileService = await createSymlinkService();
    await fs.promises.mkdir(path.join(fileService.getBaseFilesPath(), "subdir"), {
      recursive: true,
    });

    await expect(fileService.downloadFile({ filePath: "subdir" })).rejects.toThrow(
      "File not found or inaccessible",
    );
    await expect(fileService.getFile({ filePath: "subdir" })).rejects.toThrow(
      "File not found or inaccessible",
    );

    // Force the Windows fallback branch regardless of host OS.
    vi.spyOn(fileService as any, "supportsNoFollow").mockReturnValue(false);

    await expect(fileService.downloadFile({ filePath: "subdir" })).rejects.toThrow(
      "File not found or inaccessible",
    );
    await expect(fileService.getFile({ filePath: "subdir" })).rejects.toThrow(
      "File not found or inaccessible",
    );
  });

  it("archive re-lstat skips a file swapped for a symlink mid-archive", async () => {
    const fileService = await createSymlinkService();
    const baseFilesPath = fileService.getBaseFilesPath();
    await fileService.saveFile({ filePath: "good.txt", stream: Readable.from("inside content") });

    const racePath = path.join(baseFilesPath, "race.txt");
    await fs.promises.writeFile(racePath, "race content");

    // Stale scan listing: race.txt looked like a regular file at scan time
    // but was swapped for a symlink before ingestion. The archive loop's
    // re-lstat must skip it.
    const now = new Date();
    vi.spyOn(fileService as any, "scanFilesStrict").mockResolvedValue([
      {
        path: path.join(baseFilesPath, "good.txt"),
        size: "inside content".length,
        lastModified: now,
      },
      { path: racePath, size: 12, lastModified: now },
    ]);
    const realLstat = fs.promises.lstat.bind(fs.promises);
    const fakeLink = {
      isSymbolicLink: () => true,
      isFile: () => false,
      isDirectory: () => false,
    } as unknown as fs.Stats;
    vi.spyOn(fs.promises, "lstat").mockImplementation(async (linkPath: any, ...rest: any[]) => {
      if (path.resolve(linkPath) === path.resolve(racePath)) {
        return fakeLink;
      }
      return (realLstat as any)(linkPath, ...rest);
    });

    const archivePath = await fileService.getPrebuiltArchivePath();
    const archive = unzipFiles(await fs.promises.readFile(archivePath));
    expect([...archive.keys()].sort()).toEqual(["good.txt"]);
    expect(archive.get("good.txt")).toBe("inside content");
  });

  it("archive skips entries with unsafe relative names", async () => {
    const fileService = await createSymlinkService();
    const baseFilesPath = fileService.getBaseFilesPath();
    await fileService.saveFile({ filePath: "good.txt", stream: Readable.from("inside content") });

    const now = new Date();
    const outsideAbs = process.platform === "win32" ? "C:\\Windows\\evil.txt" : "/etc/evil.txt";
    vi.spyOn(fileService as any, "scanFilesStrict").mockResolvedValue([
      {
        path: path.join(baseFilesPath, "good.txt"),
        size: "inside content".length,
        lastModified: now,
      },
      // Absolute outside path: path.relative yields an absolute/.. rel that
      // the archive sanitizer must reject.
      { path: outsideAbs, size: 4, lastModified: now },
      // Traversal-styled absolute path on any platform.
      { path: "/../evil.txt", size: 4, lastModified: now },
    ]);

    // The outside lstat targets must not throw fail-closed errors: report
    // them as missing so only the sanitizer's skip logic is under test.
    const realLstat = fs.promises.lstat.bind(fs.promises);
    vi.spyOn(fs.promises, "lstat").mockImplementation(async (linkPath: any, ...rest: any[]) => {
      const resolved = path.resolve(linkPath);
      if (resolved === path.resolve(outsideAbs) || resolved === path.resolve("/../evil.txt")) {
        throw Object.assign(new Error("no such file or directory, lstat"), { code: "ENOENT" });
      }
      return (realLstat as any)(linkPath, ...rest);
    });

    const archivePath = await fileService.getPrebuiltArchivePath();
    const archive = unzipFiles(await fs.promises.readFile(archivePath));
    expect([...archive.keys()]).toEqual(["good.txt"]);
    expect(archive.get("good.txt")).toBe("inside content");
  });
});

describe("FileService singleton quota reconcile", () => {
  let testDirectory: string | undefined;

  // Test-only reset: clears the static singleton between tests. No prod API
  // is added for this — production configures the singleton once at boot.
  function resetSingleton() {
    (FileService as unknown as { instance: FileService | null }).instance = null;
  }

  async function singletonDirs() {
    testDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "steel-files-singleton-"));
    return {
      baseFilesPath: path.join(testDirectory, "files"),
      prebuiltArchiveDir: path.join(testDirectory, "archive"),
      watchFiles: false as const,
    };
  }

  beforeEach(resetSingleton);

  afterEach(async () => {
    resetSingleton();
    vi.restoreAllMocks();
    if (testDirectory) {
      await fs.promises.rm(testDirectory, { recursive: true, force: true });
      testDirectory = undefined;
    }
  });

  it("applies quota when a configured getInstance follows a bare one", async () => {
    const dirs = await singletonDirs();
    FileService.getInstance({ ...dirs });
    FileService.getInstance({ ...dirs, maxSizeBytes: 10 });

    await expect(
      FileService.getInstance().saveFile({
        filePath: "big.bin",
        stream: Readable.from(Buffer.alloc(40, 0x61)),
      }),
    ).rejects.toThrow(FileQuotaExceededError);
  });

  it("keeps quota when a bare getInstance follows a configured one", async () => {
    const dirs = await singletonDirs();
    FileService.getInstance({ ...dirs, maxSizeBytes: 10 });
    FileService.getInstance({ ...dirs });

    await expect(
      FileService.getInstance().saveFile({
        filePath: "big.bin",
        stream: Readable.from(Buffer.alloc(40, 0x61)),
      }),
    ).rejects.toThrow(FileQuotaExceededError);
  });

  it("ignores undefined maxSizeBytes so plugin wiring never resets quota", async () => {
    const dirs = await singletonDirs();
    FileService.getInstance({ ...dirs, maxSizeBytes: 10 });
    // Mirrors fileStoragePlugin called with {}: { maxSizeBytes: undefined }.
    FileService.getInstance({ ...dirs, maxSizeBytes: undefined });

    await expect(
      FileService.getInstance().saveFile({
        filePath: "big.bin",
        stream: Readable.from(Buffer.alloc(40, 0x61)),
      }),
    ).rejects.toThrow(FileQuotaExceededError);
  });

  it("throws RangeError for non-finite or negative maxSizeBytes and keeps existing quota", async () => {
    const dirs = await singletonDirs();
    FileService.getInstance({ ...dirs, maxSizeBytes: 10 });

    for (const invalid of [NaN, Infinity, -Infinity, -1]) {
      expect(() => FileService.getInstance({ ...dirs, maxSizeBytes: invalid })).toThrow(RangeError);
    }

    // Quota must remain intact after every rejected reconcile attempt.
    await expect(
      FileService.getInstance().saveFile({
        filePath: "big.bin",
        stream: Readable.from(Buffer.alloc(40, 0x61)),
      }),
    ).rejects.toThrow(FileQuotaExceededError);
  });
});

describe("FileService tmpdir stale-upload sweep", () => {
  let testDirectory: string | undefined;
  let fileCounter = 0;
  // Every path seeded into the real os.tmpdir(); removed in afterEach if the
  // sweep under test leaves it behind (fresh files, dirs, symlinks).
  let seededPaths: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const candidate of seededPaths) {
      await fs.promises.rm(candidate, { recursive: true, force: true }).catch(() => {});
    }
    seededPaths = [];
    if (testDirectory) {
      await fs.promises.rm(testDirectory, { recursive: true, force: true });
      testDirectory = undefined;
    }
  });

  async function setupSweepService(): Promise<FileService> {
    testDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "steel-files-tmp-sweep-"));
    return new FileService({
      baseFilesPath: path.join(testDirectory, "files"),
      prebuiltArchiveDir: path.join(testDirectory, "archive"),
      watchFiles: false,
    });
  }

  function tmpName(kind: string): string {
    fileCounter += 1;
    return `upload_steel-test-${process.pid}-${kind}-${fileCounter}`;
  }

  function stagedTmpName(kind: string): string {
    fileCounter += 1;
    return `upload_${randomUUID()}-steel-test-${process.pid}-${kind}-${fileCounter}`;
  }

  async function seedTmpFile(name: string, mtime: Date): Promise<string> {
    const fullPath = path.join(os.tmpdir(), name);
    await fs.promises.writeFile(fullPath, "orphan");
    await fs.promises.utimes(fullPath, mtime, mtime);
    seededPaths.push(fullPath);
    return fullPath;
  }

  async function exists(candidate: string): Promise<boolean> {
    try {
      await fs.promises.lstat(candidate);
      return true;
    } catch {
      return false;
    }
  }

  const staleDate = () => new Date(Date.now() - 2 * 60 * 60 * 1000);

  it("removes stale upload_<uuid> regular files from tmpdir at startup", async () => {
    testDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "steel-files-tmp-sweep-"));
    const stalePath = await seedTmpFile(stagedTmpName("stale"), staleDate());

    new FileService({
      baseFilesPath: path.join(testDirectory, "files"),
      prebuiltArchiveDir: path.join(testDirectory, "archive"),
      watchFiles: false,
    });

    await vi.waitFor(async () => {
      expect(await exists(stalePath)).toBe(false);
    });
  });

  it("preserves fresh upload_<uuid> files in tmpdir at startup", async () => {
    testDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "steel-files-tmp-sweep-"));
    const freshPath = await seedTmpFile(stagedTmpName("fresh"), new Date());

    new FileService({
      baseFilesPath: path.join(testDirectory, "files"),
      prebuiltArchiveDir: path.join(testDirectory, "archive"),
      watchFiles: false,
    });

    // Let the startup sweep run, then confirm the live upload survived.
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(await exists(freshPath)).toBe(true);
    expect(await fs.promises.readFile(freshPath, "utf8")).toBe("orphan");
  });

  it("preserves foreign upload_ files without the uuid shape at startup", async () => {
    testDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "steel-files-tmp-sweep-"));
    const foreignPath = await seedTmpFile("upload_foo", staleDate());
    const genericPath = await seedTmpFile(tmpName("foreign"), staleDate());

    new FileService({
      baseFilesPath: path.join(testDirectory, "files"),
      prebuiltArchiveDir: path.join(testDirectory, "archive"),
      watchFiles: false,
    });

    // Let the startup sweep run, then confirm foreign files survived.
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(await exists(foreignPath)).toBe(true);
    expect(await fs.promises.readFile(foreignPath, "utf8")).toBe("orphan");
    expect(await exists(genericPath)).toBe(true);
    expect(await fs.promises.readFile(genericPath, "utf8")).toBe("orphan");
  });

  it("does not sweep tmpdir at commit", async () => {
    const fileService = await setupSweepService();
    // Let the constructor's startup sweep settle before seeding, so only the
    // commit path is under test.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const sweepSpy = vi.spyOn(FileService.prototype as any, "sweepTmpStaleUploads");
    const stalePath = await seedTmpFile(stagedTmpName("commit-stale"), staleDate());

    await fileService.saveFile({ filePath: "probe.txt", stream: Readable.from("probe") });

    expect(sweepSpy).not.toHaveBeenCalled();
    expect(await exists(stalePath)).toBe(true);
  });

  it("skips tmpdir directories and symlinks at startup", async () => {
    testDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "steel-files-tmp-sweep-"));
    const dirPath = path.join(os.tmpdir(), stagedTmpName("dir"));
    await fs.promises.mkdir(dirPath, { recursive: true });
    await fs.promises.writeFile(path.join(dirPath, "inner.txt"), "inner");
    await fs.promises.utimes(dirPath, staleDate(), staleDate());
    seededPaths.push(dirPath);

    const targetPath = path.join(os.tmpdir(), `steel-target-${process.pid}-${Date.now()}.txt`);
    await fs.promises.writeFile(targetPath, "target");
    seededPaths.push(targetPath);
    const linkPath = path.join(os.tmpdir(), stagedTmpName("link"));
    seededPaths.push(linkPath);
    try {
      await fs.promises.symlink(
        targetPath,
        linkPath,
        process.platform === "win32" ? "file" : undefined,
      );
    } catch (error: any) {
      if (["EPERM", "EACCES", "ENOSYS", "EINVAL", "EUNKNOWN"].includes(error?.code)) {
        return;
      }
      throw error;
    }

    new FileService({
      baseFilesPath: path.join(testDirectory, "files"),
      prebuiltArchiveDir: path.join(testDirectory, "archive"),
      watchFiles: false,
    });

    // Let the startup sweep run, then confirm non-files survived.
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(await exists(dirPath)).toBe(true);
    expect(await fs.promises.readFile(path.join(dirPath, "inner.txt"), "utf8")).toBe("inner");
    const linkStat = await fs.promises.lstat(linkPath);
    expect(linkStat.isSymbolicLink()).toBe(true);
    expect(await fs.promises.readFile(targetPath, "utf8")).toBe("target");
  });

  it("runs the tmpdir sweep at startup", async () => {
    testDirectory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "steel-files-tmp-sweep-"));
    const stalePath = await seedTmpFile(stagedTmpName("startup-stale"), staleDate());

    new FileService({
      baseFilesPath: path.join(testDirectory, "files"),
      prebuiltArchiveDir: path.join(testDirectory, "archive"),
      watchFiles: false,
    });

    await vi.waitFor(async () => {
      expect(await exists(stalePath)).toBe(false);
    });
  });
});
