import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { setImmediate } from "node:timers/promises";
import { FileService } from "../file.service.ts";

const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), "steel-archive-debounce-"));
const baseFilesPath = path.join(directory, "files");
const prebuiltArchiveDir = path.join(directory, "archive");
const service = new FileService({ baseFilesPath, prebuiltArchiveDir, watchFiles: false });
const originalCreate = fs.createWriteStream;
const originalError = console.error;

try {
  await fs.promises.writeFile(path.join(baseFilesPath, "old.txt"), "previous");
  const archivePath = await service.getPrebuiltArchivePath();
  const previous = await fs.promises.readFile(archivePath);

  const failure = Object.assign(new Error("synthetic disk-full write"), { code: "ENOSPC" });
  const reported = Promise.withResolvers();
  console.error = (...args) => {
    originalError(...args);
    if (args.some((arg) => arg === failure || arg?.code === "ENOSPC")) {
      reported.resolve();
    }
  };

  let writes = 0;
  fs.createWriteStream = (outputPath, options) =>
    originalCreate(outputPath, {
      ...options,
      fs: {
        open: fs.open,
        close: fs.close,
        write(fd, buffer, offset, length, position, callback) {
          writes += 1;
          if (writes === 2) {
            queueMicrotask(() => callback(failure));
            return;
          }
          fs.write(fd, buffer, offset, length, position, callback);
        },
      },
    });

  // Schedule the real trailing debounce. Nothing awaits the build until after it fails.
  await service.saveFile({ filePath: "new.txt", stream: Readable.from("new data") });
  // Keep the child alive even if the expected error is never reported.
  const timeout = setTimeout(
    () => reported.reject(new Error("Background failure was not reported")),
    5000,
  );
  try {
    await reported.promise;
    await setImmediate();
  } finally {
    clearTimeout(timeout);
  }

  assert.equal(writes, 2);
  assert.deepEqual(await fs.promises.readFile(archivePath), previous);
  assert.deepEqual(await fs.promises.readdir(prebuiltArchiveDir), ["files.zip"]);
  assert.equal(await fs.promises.readFile(path.join(baseFilesPath, "new.txt"), "utf8"), "new data");
  assert.equal(await fs.promises.readFile(path.join(baseFilesPath, "old.txt"), "utf8"), "previous");

  fs.createWriteStream = originalCreate;
  assert.equal(await service.getPrebuiltArchivePath(), archivePath);
  assert.ok((await fs.promises.readFile(archivePath)).includes(Buffer.from("new.txt")));
} finally {
  fs.createWriteStream = originalCreate;
  console.error = originalError;
  await fs.promises.rm(directory, { recursive: true, force: true });
}
