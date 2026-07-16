import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { clearUserDataDir } from "./clear-userdata-dir.js";

describe("clearUserDataDir", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "steel-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("removes all contents of the directory", async () => {
    await fs.writeFile(path.join(tmpDir, "file1.txt"), "data");
    await fs.mkdir(path.join(tmpDir, "subdir"));
    await fs.writeFile(path.join(tmpDir, "subdir", "file2.txt"), "data");
    await fs.mkdir(path.join(tmpDir, "Default"));
    await fs.writeFile(path.join(tmpDir, "Default", "Cookies"), "data");
    await fs.mkdir(path.join(tmpDir, "Default", "Local Storage"));
    await fs.mkdir(path.join(tmpDir, "Default", "Local Storage", "leveldb"));
    await fs.writeFile(
      path.join(tmpDir, "Default", "Local Storage", "leveldb", "000003.ldb"),
      "data",
    );

    await clearUserDataDir(tmpDir);

    const entries = await fs.readdir(tmpDir);
    expect(entries).toHaveLength(0);
  });

  it("preserves the directory itself", async () => {
    await fs.writeFile(path.join(tmpDir, "file.txt"), "data");
    await clearUserDataDir(tmpDir);
    const stat = await fs.stat(tmpDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it("handles non-existent directory gracefully", async () => {
    const nonExistent = path.join(os.tmpdir(), "does-not-exist-" + Date.now());
    await expect(clearUserDataDir(nonExistent)).resolves.not.toThrow();
  });

  it("handles empty directory gracefully", async () => {
    await clearUserDataDir(tmpDir);
    const entries = await fs.readdir(tmpDir);
    expect(entries).toHaveLength(0);
  });

  it("handles nested directory structures", async () => {
    await fs.mkdir(path.join(tmpDir, "a", "b", "c", "d"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "a", "b", "c", "d", "deep.txt"), "data");
    await fs.writeFile(path.join(tmpDir, "a", "b", "shallow.txt"), "data");

    await clearUserDataDir(tmpDir);

    const entries = await fs.readdir(tmpDir);
    expect(entries).toHaveLength(0);
  });
});
