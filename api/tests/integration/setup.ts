import { beforeAll, afterAll } from "vitest";
import fs from "fs";

beforeAll(() => {
  const chromePaths = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    process.env.CHROME_EXECUTABLE_PATH,
  ].filter(Boolean);

  const chromeExists = chromePaths.some((p) => p && fs.existsSync(p));
  if (!chromeExists) {
    console.warn("Chrome not found at standard paths. Integration tests may fail.");
  }
});

afterAll(() => {
  // Global cleanup if needed
});
