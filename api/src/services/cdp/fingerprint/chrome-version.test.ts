import { describe, expect, test } from "vitest";
import { parseChromeVersion, readChromeVersion } from "./chrome-version.js";

describe("parseChromeVersion", () => {
  test.each([
    ["Chromium 156.0.8078.108 built on Debian GNU/Linux 12 (bookworm)\n", "156.0.8078.108"],
    ["Google Chrome 156.0.8078.108 \n", "156.0.8078.108"],
    ["Google Chrome for Testing 147.0.7727.15", "147.0.7727.15"],
    ["Chrome/156.0.8078.108", "156.0.8078.108"],
    ["HeadlessChrome/150.0.7600.0", "150.0.7600.0"],
  ])("parses %j", (output, full) => {
    expect(parseChromeVersion(output)).toEqual({ major: Number(full.split(".")[0]), full });
  });

  test.each(["", "Chromium", "Chromium 156.0 beta", "1.2.3"])("rejects %j", (output) => {
    expect(parseChromeVersion(output)).toBeNull();
  });
});

describe("readChromeVersion", () => {
  test("resolves to null when the binary cannot run", async () => {
    await expect(readChromeVersion("/nonexistent/chrome")).resolves.toBeNull();
  });
});
