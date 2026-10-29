import { execFile } from "node:child_process";
import { readFile, readlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const LOCK_FILES = ["SingletonLock", "SingletonSocket", "SingletonCookie"];
const POLL_INTERVAL_MS = 100;
const TERM_TIMEOUT_MS = 3000;
const KILL_TIMEOUT_MS = 2000;

export type ProcessInfo = {
  ppid: number;
  args: string[] | null;
  command: string;
};

export type ProfileLockResult =
  | { status: "free" }
  | { status: "cleared"; pid: number }
  | { status: "stopped"; pid: number }
  | { status: "skipped"; reason: string };

export type ProfileLockDeps = {
  platform: NodeJS.Platform;
  hostname: () => string;
  readLink: (file: string) => Promise<string>;
  removeFile: (file: string) => Promise<void>;
  isAlive: (pid: number) => boolean;
  inspect: (pid: number) => Promise<ProcessInfo | null>;
  signal: (pid: number, signal: NodeJS.Signals) => void;
  sleep: (ms: number) => Promise<void>;
};

export class ProfileInUseError extends Error {
  constructor(
    public readonly userDataDir: string,
    public readonly pid: number,
    public readonly ppid: number,
  ) {
    super(
      `Chrome profile ${userDataDir} is in use by PID ${pid} (parent ${ppid}). ` +
        "Stop that process or set CHROME_USER_DATA_DIR to another directory.",
    );
    this.name = "ProfileInUseError";
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function inspect(pid: number): Promise<ProcessInfo | null> {
  if (process.platform === "linux") {
    try {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      const args = (await readFile(`/proc/${pid}/cmdline`, "utf8")).split("\0").filter(Boolean);
      return { ppid, args, command: args.join(" ") };
    } catch {
      return null;
    }
  }
  try {
    const { stdout } = await execFileAsync("ps", ["-o", "ppid=,command=", "-p", String(pid)]);
    const match = stdout.trim().match(/^(\d+)\s+([\s\S]*)$/);
    return match ? { ppid: Number(match[1]), args: null, command: match[2] } : null;
  } catch {
    return null;
  }
}

const defaultDeps: ProfileLockDeps = {
  platform: process.platform,
  hostname: () => os.hostname(),
  readLink: (file) => readlink(file),
  removeFile: (file) => rm(file, { force: true }),
  isAlive,
  inspect,
  signal: (pid, signal) => process.kill(pid, signal),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

function usesProfile(info: ProcessInfo, userDataDir: string): boolean {
  const flags = [userDataDir, path.resolve(userDataDir)].map((dir) => `--user-data-dir=${dir}`);
  return flags.some((flag) =>
    info.args
      ? info.args.includes(flag)
      : info.command.endsWith(flag) || info.command.includes(`${flag} `),
  );
}

async function clearLock(userDataDir: string, deps: ProfileLockDeps) {
  await Promise.all(LOCK_FILES.map((name) => deps.removeFile(path.join(userDataDir, name))));
}

async function waitForExit(pid: number, timeoutMs: number, deps: ProfileLockDeps) {
  for (let waited = 0; waited < timeoutMs; waited += POLL_INTERVAL_MS) {
    if (!deps.isAlive(pid)) return true;
    await deps.sleep(POLL_INTERVAL_MS);
  }
  return !deps.isAlive(pid);
}

async function stop(pid: number, deps: ProfileLockDeps) {
  const send = (signal: NodeJS.Signals) => {
    try {
      deps.signal(pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  };

  send("SIGTERM");
  if (await waitForExit(pid, TERM_TIMEOUT_MS, deps)) return;
  send("SIGKILL");
  if (await waitForExit(pid, KILL_TIMEOUT_MS, deps)) return;
  throw new Error(`Chrome PID ${pid} did not exit after SIGKILL`);
}

export async function releaseStaleProfileLock(
  userDataDir: string,
  ownedPid?: number,
  deps: ProfileLockDeps = defaultDeps,
): Promise<ProfileLockResult> {
  if (deps.platform === "win32") {
    return { status: "skipped", reason: "Windows uses a different profile lock" };
  }

  let target: string;
  try {
    target = await deps.readLink(path.join(userDataDir, "SingletonLock"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { status: "free" };
    return { status: "skipped", reason: `cannot read SingletonLock: ${(error as Error).message}` };
  }

  const separator = target.lastIndexOf("-");
  const host = target.slice(0, separator);
  const pid = Number(target.slice(separator + 1));
  if (separator <= 0 || !Number.isInteger(pid) || pid <= 0) {
    return { status: "skipped", reason: `unexpected SingletonLock target ${target}` };
  }
  if (host !== deps.hostname()) {
    return { status: "skipped", reason: `lock belongs to host ${host}` };
  }

  if (!deps.isAlive(pid)) {
    await clearLock(userDataDir, deps);
    return { status: "cleared", pid };
  }

  const info = await deps.inspect(pid);
  if (!info) {
    return { status: "skipped", reason: `cannot inspect PID ${pid}` };
  }
  if (!usesProfile(info, userDataDir)) {
    await clearLock(userDataDir, deps);
    return { status: "cleared", pid };
  }
  if (pid !== ownedPid && info.ppid !== 1) {
    throw new ProfileInUseError(userDataDir, pid, info.ppid);
  }

  await stop(pid, deps);
  await clearLock(userDataDir, deps);
  return { status: "stopped", pid };
}
