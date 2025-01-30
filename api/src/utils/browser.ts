import fs from "fs";
import path from "path";
import { Page } from "puppeteer-core";
import { env } from "../env";
import { BrowserPaths, Platform } from "../types";
import { UnsupportedPlatformError, InvalidBrowserTypeError, ExecutableNotFoundError } from "./errors";

export enum BrowserType {
  CHROME = "chrome",
}

const isSupportedPlatform = (platform: string): platform is Platform => {
  return ['darwin', 'linux', 'win32'].includes(platform);
};

export const BROWSER_PATHS: Record<BrowserType, BrowserPaths> = {
  [BrowserType.CHROME]: {
    darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
    linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"],
    win32: [
      `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
      `C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe`
    ]
  },
};

export const getBrowserExecutablePath = (
  browserType: BrowserType = BrowserType.CHROME,
  platform: string = process.platform
): string => {
  if (!isSupportedPlatform(platform)) {
    throw new UnsupportedPlatformError(platform);
  }

  if (!BROWSER_PATHS[browserType]) {
    throw new InvalidBrowserTypeError(browserType);
  }

  if (browserType === BrowserType.CHROME && env.CHROME_EXECUTABLE_PATH) {
    const customPath = path.normalize(env.CHROME_EXECUTABLE_PATH);
    if (!fs.existsSync(customPath)) {
      throw new ExecutableNotFoundError([customPath]);
    }
    return customPath;
  }

  const possiblePaths = BROWSER_PATHS[browserType][platform];
  const validPath = possiblePaths.find(p => fs.existsSync(p));

  if (!validPath) {
    throw new ExecutableNotFoundError(possiblePaths);
  }

  return validPath;
};


export const getChromeExecutablePath = () => {
  if (env.CHROME_EXECUTABLE_PATH) {
    const executablePath = env.CHROME_EXECUTABLE_PATH;
    const normalizedPath = path.normalize(executablePath);
    if (!fs.existsSync(normalizedPath)) {
      console.warn(`Your custom chrome executable at ${normalizedPath} does not exist`);
    } else {
      return executablePath;
    }
  }

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
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }

  return "/usr/bin/google-chrome-stable";
};

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
