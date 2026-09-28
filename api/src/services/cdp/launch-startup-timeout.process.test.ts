import { LaunchShutdownGate } from "./launch-shutdown-gate.js";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import puppeteer from "puppeteer-core";
import { expect, it, vi } from "vitest";
const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
function running(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

it.skipIf(process.platform === "win32")(
  "failed startup blocks retries while the never-ready process tree is cleaned up",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "steel-launch-timeout-"));
    const executable = join(directory, "browser-fixture");
    const script = join(directory, "browser-fixture.cjs");
    const identityFile = join(directory, "identities.json");
    let identities: { parent: number; child: number } | undefined;
    let outcome:
      | Promise<{ browser?: Awaited<ReturnType<typeof puppeteer.launch>>; error?: unknown }>
      | undefined;
    try {
      await writeFile(
        script,
        `
      const { spawn } = require("node:child_process");
      const { writeFileSync } = require("node:fs");
      const child = spawn(process.execPath, ["-e", 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);'], { stdio: "ignore" });
      process.on("SIGTERM", () => {});
      writeFileSync(${JSON.stringify(
        identityFile,
      )}, JSON.stringify({ parent: process.pid, child: child.pid }));
      setInterval(() => {}, 1000);
    `,
      );
      await writeFile(
        executable,
        `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(script)}\n`,
        { mode: 0o700 },
      );
      // The fixture never prints a DevTools endpoint. Puppeteer owns these processes,
      // but cannot return a Browser handle to the application.
      const shutdown = vi.fn();
      const gate = new LaunchShutdownGate(vi.fn(), shutdown);
      outcome = gate
        .launch(() =>
          puppeteer.launch({ executablePath: executable, headless: true, timeout: 2000 }),
        )
        .then(
          (browser) => ({ browser }),
          (error) => ({ error }),
        );
      await vi.waitFor(
        async () => {
          identities = JSON.parse(await readFile(identityFile, "utf8"));
          expect(Number.isSafeInteger(identities!.parent)).toBe(true);
          expect(Number.isSafeInteger(identities!.child)).toBe(true);
          expect(identities!.parent).toBeGreaterThan(1);
          expect(identities!.child).toBeGreaterThan(1);
        },
        { timeout: 1500, interval: 20 },
      );
      expect(running(identities!.parent)).toBe(true);
      expect(running(identities!.child)).toBe(true);
      const result = await outcome;
      expect(result.browser).toBeUndefined();
      expect(result.error).toMatchObject({ isRetryable: false, cause: { name: "TimeoutError" } });
      expect(shutdown).toHaveBeenCalledOnce();
      const retry = vi.fn();
      await expect(gate.launch(retry)).rejects.toMatchObject({ isRetryable: false });
      expect(retry).not.toHaveBeenCalled();
      await vi.waitFor(
        () => {
          expect(running(identities!.parent)).toBe(false);
          expect(running(identities!.child)).toBe(false);
        },
        { timeout: 7000, interval: 20 },
      );
    } finally {
      const result = await outcome;
      await result?.browser?.close();
      // Only IDs recorded by this disposable fixture are eligible for cleanup.
      if (identities)
        for (const pid of [identities.parent, identities.child]) {
          if (Number.isSafeInteger(pid) && pid > 1 && running(pid)) process.kill(pid, "SIGKILL");
        }
      await rm(directory, { recursive: true, force: true });
    }
  },
  15000,
);
