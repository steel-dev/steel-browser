import fs from "fs";
import path from "path";
import { Page } from "puppeteer-core";
import { env } from "../env.js";
import { execSync } from "child_process";
import os from "os";

/**
 * Get Chrome/Chromium executable path
 * Priority:
 * 1. Custom CHROME_EXECUTABLE_PATH from env
 * 2. Playwright Chrome (if available)
 * 3. System Google Chrome
 * 4. System Chromium (fallback)
 */
export const getChromeExecutablePath = () => {
  // 1. Custom path from environment
  if (env.CHROME_EXECUTABLE_PATH) {
    const executablePath = env.CHROME_EXECUTABLE_PATH;
    const normalizedPath = path.normalize(executablePath);
    if (!fs.existsSync(normalizedPath)) {
      console.warn(`Your custom chrome executable at ${normalizedPath} does not exist`);
    } else {
      return executablePath;
    }
  }

  // 2. Try Playwright Chrome first (preferred for better anti-detection)
  const playwrightChrome = getPlaywrightChromePath();
  if (playwrightChrome && fs.existsSync(playwrightChrome)) {
    console.info(`Using Playwright Chrome: ${playwrightChrome}`);
    return playwrightChrome;
  }

  // 3. System Google Chrome
  if (process.platform === "win32") {
    const programFilesPath = `${process.env["ProgramFiles"]}\\Google\\Chrome\\Application\\chrome.exe`;
    const programFilesX86Path = `C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe`;

    if (fs.existsSync(programFilesPath)) {
      return programFilesPath;
    } else if (fs.existsSync(programFilesX86Path)) {
      return programFilesX86Path;
    }
  }

  if (process.platform === "darwin") {
    const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    if (fs.existsSync(chromePath)) {
      return chromePath;
    }
  }

  if (process.platform === "linux") {
    // Try common Chrome paths on Linux
    const chromePaths = [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    ];

    for (const chromePath of chromePaths) {
      if (fs.existsSync(chromePath)) {
        return chromePath;
      }
    }
  }

  // 4. Fallback to chromium
  return "/usr/bin/chromium";
};

/**
 * Get Playwright Chrome browser path
 * Playwright stores browsers in:
 * - Linux/macOS: ~/.cache/ms-playwright/
 * - Windows: %USERPROFILE%\AppData\Local\ms-playwright\
 */
function getPlaywrightChromePath(): string | null {
  try {
    const playwrightCacheDir =
      process.env.PLAYWRIGHT_BROWSERS_PATH ||
      path.join(
        process.platform === "win32"
          ? process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")
          : process.platform === "darwin"
          ? path.join(os.homedir(), "Library", "Caches")
          : path.join(os.homedir(), ".cache"),
        "ms-playwright",
      );

    if (!fs.existsSync(playwrightCacheDir)) {
      return null;
    }

    // Find Chrome directories (format: chromium-<version>)
    const entries = fs.readdirSync(playwrightCacheDir);
    const chromeDirs = entries
      .filter((entry) => entry.startsWith("chromium-"))
      .sort()
      .reverse(); // Get latest version

    if (chromeDirs.length === 0) {
      return null;
    }

    const latestChromeDir = path.join(playwrightCacheDir, chromeDirs[0]);

    // Construct executable path based on platform
    let executablePath: string;
    if (process.platform === "win32") {
      executablePath = path.join(latestChromeDir, "chrome-win", "chrome.exe");
    } else if (process.platform === "darwin") {
      executablePath = path.join(
        latestChromeDir,
        "chrome-mac",
        "Chromium.app",
        "Contents",
        "MacOS",
        "Chromium",
      );
    } else {
      executablePath = path.join(latestChromeDir, "chrome-linux", "chrome");
    }

    return fs.existsSync(executablePath) ? executablePath : null;
  } catch (error) {
    console.warn(`Failed to locate Playwright Chrome: ${error}`);
    return null;
  }
}

/**
 * Install Playwright browsers programmatically
 * Can be called to ensure Chrome is available
 */
export async function installPlaywrightBrowsers(): Promise<void> {
  try {
    console.info("Installing Playwright browsers...");
    execSync("npx playwright install chromium", {
      stdio: "inherit",
      cwd: process.cwd(),
    });
    console.info("Playwright browsers installed successfully");
  } catch (error) {
    console.error(`Failed to install Playwright browsers: ${error}`);
    throw error;
  }
}

export async function installMouseHelper(page: Page) {
  await page.evaluateOnNewDocument(() => {
    // Install mouse helper only for top-level frame.
    if (window !== window.parent) return;
    window.addEventListener(
      "DOMContentLoaded",
      () => {
        const box = document.createElement("puppeteer-mouse-pointer");
        const styleElement = document.createElement("style");
        styleElement.innerHTML = `
        puppeteer-mouse-pointer {
          pointer-events: none;
          position: absolute;
          top: 0;
          z-index: 10000;
          left: 0;
          width: 20px;
          height: 20px;
          background: rgba(0,0,0,.4);
          border: 1px solid white;
          border-radius: 10px;
          margin: -10px 0 0 -10px;
          padding: 0;
          transition: background .2s, border-radius .2s, border-color .2s;
        }
        puppeteer-mouse-pointer.button-1 {
          transition: none;
          background: rgba(0,0,0,0.9);
        }
        puppeteer-mouse-pointer.button-2 {
          transition: none;
          border-color: rgba(0,0,255,0.9);
        }
        puppeteer-mouse-pointer.button-3 {
          transition: none;
          border-radius: 4px;
        }
        puppeteer-mouse-pointer.button-4 {
          transition: none;
          border-color: rgba(255,0,0,0.9);
        }
        puppeteer-mouse-pointer.button-5 {
          transition: none;
          border-color: rgba(0,255,0,0.9);
        }
      `;
        document.head.appendChild(styleElement);
        document.body.appendChild(box);
        document.addEventListener(
          "mousemove",
          (event) => {
            box.style.left = event.pageX + "px";
            box.style.top = event.pageY + "px";
            updateButtons(event.buttons);
          },
          true,
        );
        document.addEventListener(
          "mousedown",
          (event) => {
            updateButtons(event.buttons);
            box.classList.add("button-" + event.which);
          },
          true,
        );
        document.addEventListener(
          "mouseup",
          (event) => {
            updateButtons(event.buttons);
            box.classList.remove("button-" + event.which);
          },
          true,
        );
        function updateButtons(buttons) {
          for (let i = 0; i < 5; i++)
            // @ts-ignore
            box.classList.toggle("button-" + i, buttons & (1 << i));
        }
      },
      false,
    );
  });
}

export function filterHeaders(headers: Record<string, string>) {
  const headersToRemove = [
    "accept-encoding",
    "accept",
    "cache-control",
    "pragma",
    "sec-fetch-dest",
    "sec-fetch-mode",
    "sec-fetch-site",
    "sec-fetch-user",
    "upgrade-insecure-requests",
  ];
  const filteredHeaders = { ...headers };
  headersToRemove.forEach((header) => {
    delete filteredHeaders[header];
  });
  return filteredHeaders;
}
