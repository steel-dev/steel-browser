import fs from "fs";
import os from "os";

export interface MemorySnapshot {
  totalBytes: number;
  freeBytes: number;
  /** Linux MemAvailable, a better OOM signal than freeBytes. Undefined off Linux. */
  availableBytes?: number;
  /** cgroup v2 oom_kill counter, non-zero once the kernel OOM killer has fired. */
  oomKills?: number;
}

function readMemAvailableBytes(): number | undefined {
  try {
    const match = fs.readFileSync("/proc/meminfo", "utf8").match(/^MemAvailable:\s+(\d+)\s+kB$/m);
    return match ? Number(match[1]) * 1024 : undefined;
  } catch {
    return undefined;
  }
}

function readOomKills(): number | undefined {
  for (const path of ["/sys/fs/cgroup/memory.events", "/sys/fs/cgroup/memory/memory.oom_control"]) {
    try {
      const match = fs.readFileSync(path, "utf8").match(/^oom_kill[ ]+(\d+)$/m);
      if (match) return Number(match[1]);
    } catch {
      // Path is absent on other cgroup layouts; try the next one.
    }
  }
  return undefined;
}

/**
 * Best-effort memory reading, for telling an OOM kill apart from other crashes.
 * Every field is optional and nothing here throws.
 */
export function captureMemorySnapshot(): MemorySnapshot {
  return {
    totalBytes: os.totalmem(),
    freeBytes: os.freemem(),
    availableBytes: readMemAvailableBytes(),
    oomKills: readOomKills(),
  };
}
