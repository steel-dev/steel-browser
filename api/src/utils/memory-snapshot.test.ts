import { describe, expect, it, vi, afterEach } from "vitest";
import fs from "fs";
import { captureMemorySnapshot } from "./memory-snapshot.js";

afterEach(() => vi.restoreAllMocks());

describe("captureMemorySnapshot", () => {
  it("always reports total and free memory", () => {
    const snap = captureMemorySnapshot();

    expect(snap.totalBytes).toBeGreaterThan(0);
    expect(snap.freeBytes).toBeGreaterThanOrEqual(0);
  });

  it("parses MemAvailable and the oom_kill counter when present", () => {
    vi.spyOn(fs, "readFileSync").mockImplementation((path: any) => {
      if (String(path) === "/proc/meminfo")
        return "MemTotal:  8000000 kB\nMemAvailable:  1024 kB\n";
      if (String(path) === "/sys/fs/cgroup/memory.events")
        return "low 0\nhigh 0\noom 3\noom_kill 2\n";
      throw new Error("ENOENT");
    });

    const snap = captureMemorySnapshot();

    expect(snap.availableBytes).toBe(1024 * 1024);
    expect(snap.oomKills).toBe(2);
  });

  it("degrades to undefined rather than throwing when the files are absent", () => {
    vi.spyOn(fs, "readFileSync").mockImplementation(() => {
      throw new Error("ENOENT");
    });

    const snap = captureMemorySnapshot();

    expect(snap.availableBytes).toBeUndefined();
    expect(snap.oomKills).toBeUndefined();
    expect(snap.totalBytes).toBeGreaterThan(0);
  });

  it("does not mistake an oom_kill of zero for a missing reading", () => {
    vi.spyOn(fs, "readFileSync").mockImplementation((path: any) => {
      if (String(path) === "/sys/fs/cgroup/memory.events") return "low 0\noom 0\noom_kill 0\n";
      throw new Error("ENOENT");
    });

    expect(captureMemorySnapshot().oomKills).toBe(0);
  });
});
