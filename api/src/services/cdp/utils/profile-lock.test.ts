import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { lstat, mkdtemp, readlink, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  ProfileInUseError,
  releaseStaleProfileLock,
  type ProcessInfo,
  type ProfileLockDeps,
} from "./profile-lock.js";

const HOST = "fixture-host";

type FakeProcess = ProcessInfo & { ignoresTerm?: boolean };

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "profile-lock-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function lockProfile(host: string, pid: number) {
  await symlink(`${host}-${pid}`, path.join(dir, "SingletonLock"));
  await symlink(path.join(dir, "missing-socket"), path.join(dir, "SingletonSocket"));
  await symlink("12345", path.join(dir, "SingletonCookie"));
}

const exists = (name: string) =>
  lstat(path.join(dir, name)).then(
    () => true,
    () => false,
  );

function chrome(ppid: number, extra: Partial<FakeProcess> = {}): FakeProcess {
  return { ppid, command: `/usr/bin/chromium --headless=new --user-data-dir=${dir}`, ...extra };
}

function fakeSystem(processes: Record<number, FakeProcess>) {
  const alive = new Set(Object.keys(processes).map(Number));
  const signals: [number, NodeJS.Signals][] = [];
  const deps: ProfileLockDeps = {
    platform: "linux",
    hostname: () => HOST,
    readLink: (file) => readlink(file),
    removeFile: (file) => rm(file, { force: true }),
    isAlive: (pid) => alive.has(pid),
    inspect: async (pid) => (alive.has(pid) ? processes[pid] ?? null : null),
    signal: (pid, signal) => {
      signals.push([pid, signal]);
      if (signal === "SIGKILL" || !processes[pid]?.ignoresTerm) alive.delete(pid);
    },
    sleep: async () => undefined,
  };
  return { deps, signals, alive };
}

describe("releaseStaleProfileLock", () => {
  test("reports a free profile when there is no lock", async () => {
    const { deps } = fakeSystem({});
    await expect(releaseStaleProfileLock(dir, undefined, deps)).resolves.toEqual({
      status: "free",
    });
  });

  test("clears a lock left by a process that has exited", async () => {
    await lockProfile(HOST, 4100);
    const { deps, signals } = fakeSystem({});

    await expect(releaseStaleProfileLock(dir, undefined, deps)).resolves.toEqual({
      status: "cleared",
      pid: 4100,
    });
    expect(signals).toEqual([]);
    expect(await exists("SingletonLock")).toBe(false);
    expect(await exists("SingletonSocket")).toBe(false);
    expect(await exists("SingletonCookie")).toBe(false);
  });

  test("leaves the lock to Chrome when its PID now belongs to another program", async () => {
    await lockProfile(HOST, 4101);
    const { deps, signals } = fakeSystem({ 4101: { ppid: 1, command: "/usr/sbin/sshd" } });

    await expect(releaseStaleProfileLock(dir, undefined, deps)).resolves.toEqual({
      status: "skipped",
      reason: "PID 4101 does not use this profile",
    });
    expect(signals).toEqual([]);
    expect(await exists("SingletonLock")).toBe(true);
  });

  test("stops an orphaned Chrome that still holds the profile", async () => {
    await lockProfile(HOST, 4102);
    const { deps, signals, alive } = fakeSystem({ 4102: chrome(1) });

    await expect(releaseStaleProfileLock(dir, undefined, deps)).resolves.toEqual({
      status: "stopped",
      pid: 4102,
    });
    expect(signals).toEqual([[4102, "SIGTERM"]]);
    expect(alive.has(4102)).toBe(false);
    expect(await exists("SingletonLock")).toBe(false);
  });

  test("stops a Chrome this service launched earlier", async () => {
    await lockProfile(HOST, 4103);
    const { deps, signals } = fakeSystem({ 4103: chrome(process.pid) });

    await expect(releaseStaleProfileLock(dir, 4103, deps)).resolves.toEqual({
      status: "stopped",
      pid: 4103,
    });
    expect(signals).toEqual([[4103, "SIGTERM"]]);
  });

  test("escalates to SIGKILL when Chrome ignores SIGTERM", async () => {
    await lockProfile(HOST, 4104);
    const { deps, signals } = fakeSystem({ 4104: chrome(1, { ignoresTerm: true }) });

    await expect(releaseStaleProfileLock(dir, undefined, deps)).resolves.toEqual({
      status: "stopped",
      pid: 4104,
    });
    expect(signals).toEqual([
      [4104, "SIGTERM"],
      [4104, "SIGKILL"],
    ]);
  });

  test("refuses to touch a Chrome that another live process owns", async () => {
    await lockProfile(HOST, 4105);
    const { deps, signals } = fakeSystem({ 4105: chrome(3210) });

    const attempt = releaseStaleProfileLock(dir, undefined, deps);
    await expect(attempt).rejects.toBeInstanceOf(ProfileInUseError);
    await expect(attempt).rejects.toThrow(/in use by PID 4105 \(parent 3210\)/);
    expect(signals).toEqual([]);
    expect(await exists("SingletonLock")).toBe(true);
  });

  test("leaves a lock from another host alone", async () => {
    await lockProfile("other-host", 4106);
    const { deps, signals } = fakeSystem({});

    await expect(releaseStaleProfileLock(dir, undefined, deps)).resolves.toEqual({
      status: "skipped",
      reason: "lock belongs to host other-host",
    });
    expect(signals).toEqual([]);
    expect(await exists("SingletonLock")).toBe(true);
  });

  test("matches the profile in a command line with spaces in the path", async () => {
    await lockProfile(HOST, 4107);
    const command = `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=${dir} --headless=new`;
    const { deps } = fakeSystem({ 4107: { ppid: 1, command } });

    await expect(releaseStaleProfileLock(dir, undefined, deps)).resolves.toEqual({
      status: "stopped",
      pid: 4107,
    });
  });

  test("does not mistake a sibling profile for its own", async () => {
    await lockProfile(HOST, 4108);
    const command = `/usr/bin/chromium --user-data-dir=${dir}-other --headless=new`;
    const { deps, signals } = fakeSystem({ 4108: { ppid: 1, command } });

    await expect(releaseStaleProfileLock(dir, undefined, deps)).resolves.toEqual({
      status: "skipped",
      reason: "PID 4108 does not use this profile",
    });
    expect(signals).toEqual([]);
    expect(await exists("SingletonLock")).toBe(true);
  });

  test("stops a Chrome this process launched but no longer tracks", async () => {
    await lockProfile(HOST, 4109);
    const { deps, signals } = fakeSystem({ 4109: chrome(process.pid) });

    await expect(releaseStaleProfileLock(dir, undefined, deps)).resolves.toEqual({
      status: "stopped",
      pid: 4109,
    });
    expect(signals).toEqual([[4109, "SIGTERM"]]);
  });

  describe.skipIf(process.platform === "win32")("with a real process", () => {
    let child: ChildProcess | undefined;

    afterEach(() => {
      if (child?.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    });

    test("stops the process holding the lock and clears it", async () => {
      child = spawn(process.execPath, [
        "-e",
        "setInterval(() => {}, 1000)",
        "--",
        `--user-data-dir=${dir}`,
      ]);
      await once(child, "spawn");
      const exited = once(child, "exit");
      await lockProfile(os.hostname(), child.pid!);

      await expect(releaseStaleProfileLock(dir, child.pid)).resolves.toEqual({
        status: "stopped",
        pid: child.pid,
      });
      await exited;
      expect(child.signalCode).toBe("SIGTERM");
      expect(await exists("SingletonLock")).toBe(false);
    });

    test("stops a process that rewrote its command line into one string", async () => {
      child = spawn(process.execPath, [
        "-e",
        'process.title = `chromium --headless=new --user-data-dir=${process.argv[1]} --no-sandbox`; console.log("ready"); setInterval(() => {}, 1000)',
        dir,
      ]);
      await once(child.stdout!, "data");
      const exited = once(child, "exit");
      await lockProfile(os.hostname(), child.pid!);

      await expect(releaseStaleProfileLock(dir, child.pid)).resolves.toEqual({
        status: "stopped",
        pid: child.pid,
      });
      await exited;
      expect(child.signalCode).toBe("SIGTERM");
    });
  });
});
