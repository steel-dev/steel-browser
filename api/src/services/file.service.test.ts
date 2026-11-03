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
    await expect(
      fs.promises.stat(path.join(baseFilesPath, "victim.txt")),
    ).rejects.toMatchObject({ code: "ENOENT" });
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

    if (!(await trySymlink(secretPath, path.join(baseFilesPath, "link.txt"), fileLinkType))) {
      return;
    }

    const outsideSubDir = path.join(outsideDirectory!, "realdir");
    await fs.promises.mkdir(outsideSubDir, { recursive: true });
    await fs.promises.writeFile(path.join(outsideSubDir, "evil.txt"), "outside dir secret");
    if (!(await trySymlink(outsideSubDir, path.join(baseFilesPath, "sub"), dirLinkType))) {
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
    vi.spyOn(fs.promises, "lstat").mockImplementation(async (linkPath: any, ...rest: any[]) => {
      if (linkPath === target) {
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
});
