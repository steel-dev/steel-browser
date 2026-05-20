import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

describe("package exports", () => {
  it("exports logger from the emitted build path", () => {
    const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));

    expect(packageJson.exports["./logger"].import).toEqual({
      types: "./build/services/cdp/instrumentation/browser-logger.d.ts",
      default: "./build/services/cdp/instrumentation/browser-logger.js",
    });
  });
});
