import { execFile } from "child_process";

export interface ChromeVersion {
  /** Major version, e.g. 156. */
  major: number;
  /** Four-part version, e.g. "156.0.8078.108". */
  full: string;
}

const VERSION_TIMEOUT_MS = 10_000;
const cache = new Map<string, Promise<ChromeVersion | null>>();

/**
 * Parses `chrome --version` output such as "Chromium 156.0.8078.108 built on
 * Debian GNU/Linux 12 (bookworm)" or "Google Chrome 156.0.8078.108", and the
 * `Browser.getVersion` product string "Chrome/156.0.8078.108".
 */
export function parseChromeVersion(output: string): ChromeVersion | null {
  const match = /(?:^|[\s/])(\d+)\.(\d+)\.(\d+)\.(\d+)(?:\s|$)/.exec(output.trim());
  if (!match) return null;
  return { major: Number(match[1]), full: match.slice(1, 5).join(".") };
}

/**
 * Reads the version of the browser binary once per executable path. Resolves
 * to null when the binary cannot report it (Windows Chrome does not print
 * --version, a missing binary, a timeout).
 */
export function readChromeVersion(executablePath: string): Promise<ChromeVersion | null> {
  let version = cache.get(executablePath);
  if (!version) {
    version = new Promise((resolve) => {
      execFile(
        executablePath,
        ["--version"],
        { timeout: VERSION_TIMEOUT_MS, windowsHide: true },
        (error, stdout) => resolve(error ? null : parseChromeVersion(String(stdout))),
      );
    });
    cache.set(executablePath, version);
    // Do not pin a transient failure for the life of the process.
    void version.then((value) => {
      if (!value) cache.delete(executablePath);
    });
  }
  return version;
}
