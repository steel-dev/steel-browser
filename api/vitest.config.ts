import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["build/**", "dist/**", "node_modules/**"],
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts", "src/**/*.spec.ts"],
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
    ],
  },
});


