import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 10000,
    hookTimeout: 5000,
    env: { NODE_ENV: "test" },
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
          exclude: ["build/**", "dist/**", "node_modules/**"],
        },
      },
      {
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: [
            "extensions/**/test/**/*.test.ts",
            "extensions/**/test/**/*.spec.ts",
            "secret-manager/test/**/*.test.ts",
            "secret-manager/test/**/*.spec.ts",
          ],
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["./tests/integration/setup.ts"],
          testTimeout: 60000,
          hookTimeout: 30000,
          fileParallelism: false,
        },
      },
    ],
  },
});
