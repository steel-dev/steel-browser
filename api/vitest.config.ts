import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
