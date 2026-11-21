import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FileQuotaExceededError, FileService } from "./file.service.js";

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

  it("rejects oversized save and keeps prior files", async () => {
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

  it("allows fitting overwrite of an existing file", async () => {
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

  it("aborts unknown-length over-quota stream and removes partial", async () => {
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

  it("rejects over-quota declared size without reading stream", async () => {
    // #422: declared size over remaining budget rejects without reading the
    // stream. 60 bytes stored (40 remaining); a 50-byte declaration fits an
    // empty 100-byte quota but exceeds the remaining budget.
    const fileService = await createQuotaService(100);
    await fileService.saveFile({
      filePath: "a.bin",
      stream: Readable.from(Buffer.alloc(60, 0x61)),
    });

    const read = vi.fn();
    const stream = new Readable({ read });

    await expect(fileService.saveFile({ filePath: "big.bin", stream, size: 50 })).rejects.toThrow(
      FileQuotaExceededError,
    );
    // Producer untouched: nothing read, stream destroyed on rejection.
    expect(read).not.toHaveBeenCalled();
    expect(stream.destroyed).toBe(true);
    expect((await fileService.listFiles()).reduce((total, file) => total + file.size, 0)).toBe(60);
  });

  it.each([".", ".steel-upload-1", "nested/.steel-upload-2"])(
    "rejects %s save target without reading stream",
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
    "rejects %s delete target without touching quota",
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
    // #422: 2x60MB concurrent vs 100MB quota -> exactly one 413, committed
    // total <=100MB. Scaled to 2x60B vs 100B (same 0.6 ratio per upload) so
    // the test stays fast without 60MB buffers. Each upload alone fits; both
    // together (120B) cannot, so exactly one must fail regardless of
    // interleaving (in-flight guard mid-stream or serialized commit recheck).
    const fileService = await createQuotaService(100);

    const results = await Promise.allSettled(
      ["concurrent-a.bin", "concurrent-b.bin"].map((filePath) =>
        fileService.saveFile({
          filePath,
          stream: Readable.from(delayedChunks(6, 10)),
        }),
      ),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const reasons = results.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toBeInstanceOf(FileQuotaExceededError);

    expect(await fs.promises.readdir(fileService.getBaseFilesPath())).toHaveLength(1);
    const files = await fileService.listFiles();
    const total = files.reduce((sum, file) => sum + file.size, 0);
    expect(total).toBeLessThanOrEqual(100);
    expect(total).toBe(60);
  });

  it("rechecks quota when another save commits mid-upload", async () => {
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

  it("denies any positive bytes when maxSizeBytes is 0", async () => {
    const fileService = await createQuotaService(0);

    await expect(
      fileService.saveFile({
        filePath: "a.bin",
        stream: Readable.from(Buffer.alloc(1, 0x61)),
      }),
    ).rejects.toThrow(FileQuotaExceededError);
    expect(await fs.promises.readdir(fileService.getBaseFilesPath())).toEqual([]);
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

  async function gateRenameOnce(baseFilesPath: string, fileName: string) {
    const rename = fs.promises.rename.bind(fs.promises);
    let releaseRename!: () => void;
    const renameReleased = new Promise<void>((resolve) => {
      releaseRename = resolve;
    });
    let signalRenameStarted!: () => void;
    const renameStarted = new Promise<void>((resolve) => {
      signalRenameStarted = resolve;
    });
    let gated = false;

    // Scope the gate to this test's commit rename only: foreign renames pass
    // straight through. A global mockImplementationOnce can be consumed by a
    // debounced archive rename from an earlier test's FileService instance,
    // which both defuses the gate and parks the archive rename mid-test.
    vi.spyOn(fs.promises, "rename").mockImplementation(async (oldPath, newPath) => {
      if (!gated && String(newPath) === path.join(baseFilesPath, fileName)) {
        gated = true;
        signalRenameStarted();
        await renameReleased;
      }
      return rename(oldPath as string, newPath as string);
    });

    return { renameStarted, releaseRename };
  }

  it("removes committed file for delete queued during commit", async () => {
    const fileService = await createDeleteService();
    const baseFilesPath = fileService.getBaseFilesPath();
    await fs.promises.writeFile(path.join(baseFilesPath, "victim.txt"), "old content");

    const { renameStarted, releaseRename } = await gateRenameOnce(baseFilesPath, "victim.txt");
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

  it("leaves no resurrected file for delete-all queued during commit", async () => {
    const fileService = await createDeleteService();
    const baseFilesPath = fileService.getBaseFilesPath();
    await fs.promises.writeFile(path.join(baseFilesPath, "stale.txt"), "stale");

    const { renameStarted, releaseRename } = await gateRenameOnce(baseFilesPath, "fresh.txt");
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

  it("resets cached quota on ENOENT during cleanup", async () => {
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
    "handles %s readdir rejection during cleanup cleanly",
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

  it("treats concurrent deletes of the same file as idempotent", async () => {
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

  it("recreates parent and retries when first rename hits ENOENT", async () => {
    const fileService = await createDeleteService();
    const baseFilesPath = fileService.getBaseFilesPath();

    // Scope the fault to this test's commit rename only: foreign renames
    // (e.g. a debounced archive rename from an earlier test's instance) pass
    // through to the real rename instead of consuming a global once-mock and
    // rejecting through the fire-and-forget debounce (unhandled rejection,
    // exit 1). No cross-test defuse is needed.
    const realRename = fs.promises.rename.bind(fs.promises);
    const commitDest = path.join(baseFilesPath, "nested", "retry.txt");
    let faulted = false;
    vi.spyOn(fs.promises, "rename").mockImplementation(async (oldPath, newPath) => {
      if (!faulted && String(newPath) === commitDest) {
        faulted = true;
        throw Object.assign(new Error("no such file or directory, rename"), { code: "ENOENT" });
      }
      return realRename(oldPath as string, newPath as string);
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

  it("applies quota when configured instance follows bare one", async () => {
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

  it("keeps quota when bare instance follows configured one", async () => {
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

  it("throws RangeError for non-finite or negative quota", async () => {
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
