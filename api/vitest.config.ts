import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const recorderRrwebEsm = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "extensions/recorder/node_modules/rrweb/es/rrweb/packages/rrweb/src/entries/all.js",
);

export default defineConfig({
  resolve: {
    alias: {
      rrweb: recorderRrwebEsm,
    },
  },
  test: {
    include: ["src/**/*.test.ts", "extensions/recorder/src/**/*.test.js"],
    testTimeout: 30000,
  },
});
