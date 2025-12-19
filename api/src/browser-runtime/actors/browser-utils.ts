import fs from "fs";
import path from "path";
import { Page } from "puppeteer-core";

export const getChromeExecutablePath = (customPath?: string) => {
  if (customPath) {
    const normalizedPath = path.normalize(customPath);
    if (fs.existsSync(normalizedPath)) {
      return customPath;
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

  return "/usr/bin/chromium";
};

export async function installMouseHelper(page: Page, device: string) {
  await page.evaluateOnNewDocument((deviceType) => {
    if (window !== window.parent) return;
    window.addEventListener(
      "DOMContentLoaded",
      () => {
        if (deviceType === "desktop") {
          const CURSOR_ID = "__cursor__";
          if (document.getElementById(CURSOR_ID)) return;

          const cursor = document.createElement("div");
          cursor.id = CURSOR_ID;
          Object.assign(cursor.style, {
            position: "fixed",
            top: "0px",
            left: "0px",
            width: "20px",
            height: "20px",
            backgroundImage: `url("data:image/svg+xml;utf8,<svg width='16' height='16' viewBox='0 0 20 20' fill='black' outline='white' xmlns='http://www.w3.org/2000/svg'><path d='M15.8089 7.22221C15.9333 7.00888 15.9911 6.78221 15.9822 6.54221C15.9733 6.29333 15.8978 6.06667 15.7555 5.86221C15.6133 5.66667 15.4311 5.52445 15.2089 5.43555L1.70222 0.0888888C1.47111 0 1.23555 -0.0222222 0.995555 0.0222222C0.746667 0.0755555 0.537779 0.186667 0.368888 0.355555C0.191111 0.533333 0.0755555 0.746667 0.0222222 0.995555C-0.0222222 1.23555 0 1.47111 0.0888888 1.70222L5.43555 15.2222C5.52445 15.4445 5.66667 15.6267 5.86221 15.7689C6.06667 15.9111 6.28888 15.9867 6.52888 15.9955H6.58221C6.82221 15.9955 7.04445 15.9333 7.24888 15.8089C7.44445 15.6845 7.59555 15.52 7.70221 15.3155L10.2089 10.2222L15.3022 7.70221C15.5155 7.59555 15.6845 7.43555 15.8089 7.22221Z' ></path></svg>")`,
            backgroundSize: "cover",
            pointerEvents: "none",
            zIndex: "99999",
            transform: "translate(-2px, -2px)",
          });

          document.body.appendChild(cursor);

          document.addEventListener("mousemove", (e) => {
            cursor.style.top = e.clientY + "px";
            cursor.style.left = e.clientX + "px";
          });
        } else {
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
              // @ts-ignore
              for (let i = 0; i < 5; i++)
                box.classList.toggle("button-" + i, event.buttons & (1 << i));
            },
            true,
          );
          document.addEventListener(
            "mousedown",
            (event) => {
              // @ts-ignore
              for (let i = 0; i < 5; i++)
                box.classList.toggle("button-" + i, event.buttons & (1 << i));
              box.classList.add("button-" + event.which);
            },
            true,
          );
          document.addEventListener(
            "mouseup",
            (event) => {
              // @ts-ignore
              for (let i = 0; i < 5; i++)
                box.classList.toggle("button-" + i, event.buttons & (1 << i));
              box.classList.remove("button-" + event.which);
            },
            true,
          );
        }
      },
      false,
    );
  }, device);
}
