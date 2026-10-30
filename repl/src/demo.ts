import { execFile } from "node:child_process";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import puppeteer, { type Browser, type Frame, type Page } from "puppeteer-core";

const apiUrl = process.env.STEEL_API_URL ?? "http://localhost:3000";
const uiUrl = process.env.STEEL_UI_URL ?? "http://localhost:5173";
const output = fileURLToPath(new URL("../../images/demo.gif", import.meta.url));
const video = `${tmpdir()}/steel-demo.webm` as const;
const backdrop = `${tmpdir()}/steel-demo.png` as const;
const canvas = { width: 1680, height: 1150 };
const frame = { x: 120, y: 110, width: 1440, height: 930 };

const execFileAsync = promisify(execFile);

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function post<T>(path: string, body: object): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`POST ${path} returned ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

function tunnel() {
  const { width, height } = canvas;
  const { x, y, width: w, height: h } = frame;
  const lerp = (from: number, to: number, t: number) => from + (to - from) * t;
  const paths: string[] = [];
  for (let plane = 1; plane < 7; plane++) {
    const t = (1 - 1 / (1 + (3 * plane) / 7)) / 0.75;
    const left = lerp(0, x, t);
    const top = lerp(0, y, t);
    const right = lerp(width, x + w, t);
    const bottom = lerp(height, y + h, t);
    paths.push(`M${left} ${top}H${right}V${bottom}H${left}Z`);
  }
  for (let rail = 0; rail <= 10; rail++) {
    const f = rail / 10;
    paths.push(
      `M${width * f} 0L${x + w * f} ${y}`,
      `M${width * f} ${height}L${x + w * f} ${y + h}`,
      `M0 ${height * f}L${x} ${y + h * f}`,
      `M${width} ${height * f}L${x + w} ${y + h * f}`,
    );
  }
  return paths.join("");
}

function stageHtml(url: string) {
  return `<!doctype html>
<html>
  <head>
    <style>
      body {
        margin: 0;
        background: #d7f0ff;
      }
      .grid {
        position: absolute;
        inset: 0;
      }
      .window {
        position: absolute;
        top: ${frame.y}px;
        left: ${frame.x}px;
        overflow: hidden;
        border-radius: 10px;
        background: #080807;
      }
      .bar {
        display: flex;
        gap: 8px;
        align-items: center;
        height: 30px;
        padding: 0 14px;
      }
      .bar span {
        width: 11px;
        height: 11px;
        border-radius: 50%;
        background: #50504b;
      }
      iframe {
        display: block;
        width: 1440px;
        height: 900px;
        border: 0;
      }
      #cursor {
        position: fixed;
        top: -2.5px;
        left: -5px;
        opacity: 0;
        pointer-events: none;
        transform: translate(600px, 300px);
        transform-origin: 5px 2.5px;
        transition:
          transform 800ms cubic-bezier(0.45, 0, 0.2, 1),
          opacity 200ms;
        filter: drop-shadow(0 1px 2px rgb(0 0 0 / 0.35));
      }
    </style>
  </head>
  <body>
    <svg class="grid" width="${canvas.width}" height="${canvas.height}">
      <path d="${tunnel()}" fill="none" stroke="#3ab8ff" stroke-width="2" />
    </svg>
    <div class="window">
      <div class="bar">
        <span></span>
        <span></span>
        <span></span>
      </div>
      <iframe src="${url}"></iframe>
    </div>
    <svg id="cursor" width="24" height="24" viewBox="0 0 24 24">
      <path
        d="M5 2.5v16.2l4.3-4.1 2.7 6.2 2.9-1.3-2.7-6.1h6z"
        fill="#111"
        stroke="#fff"
        stroke-width="1.4"
        stroke-linejoin="round"
      />
    </svg>
  </body>
</html>`;
}

async function center(target: Page | Frame, selector: string) {
  const element = await target.waitForSelector(selector);
  const box = await element?.boundingBox();
  if (!box) throw new Error(`${selector} is not visible`);
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
}

async function styleCursor(stage: Page, style: Record<string, string>) {
  await stage.evaluate((style) => {
    const cursor = document.getElementById("cursor");
    if (cursor) Object.assign(cursor.style, style);
  }, style);
}

async function clickInUi(stage: Page, ui: Frame, selector: string) {
  const { x, y } = await center(ui, selector);
  await styleCursor(stage, { opacity: "1" });
  await pause(250);
  await styleCursor(stage, { transform: `translate(${x}px, ${y}px)` });
  await pause(850);
  await stage.mouse.move(x, y);
  await pause(250);
  await styleCursor(stage, {
    transition: "transform 120ms ease-out",
    transform: `translate(${x}px, ${y}px) scale(0.82)`,
  });
  await stage.mouse.click(x, y);
  await pause(140);
  await styleCursor(stage, { transform: `translate(${x}px, ${y}px)` });
}

async function clickInPage(agent: Page, selector: string) {
  const { x, y } = await center(agent, selector);
  await agent.mouse.move(x, y, { steps: 22 });
  await pause(150);
  await agent.mouse.click(x, y);
}

async function scroll(agent: Page, distance: number) {
  await agent.evaluate((top) => window.scrollBy({ top, behavior: "smooth" }), distance);
}

async function run() {
  const server = createServer((_, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(stageHtml(uiUrl));
  });
  server.listen(0, "localhost").unref();
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  const session = await post<{ id: string; websocketUrl: string }>("/v1/sessions", {
    dimensions: { width: 1280, height: 800 },
  });
  let steel: Browser | undefined;
  let recorder: Browser | undefined;

  try {
    steel = await puppeteer.connect({
      browserWSEndpoint: session.websocketUrl,
      defaultViewport: null,
    });
    recorder = await puppeteer.launch({
      channel: "chrome",
      defaultViewport: canvas,
    });
    const agent = (await steel.pages())[0] ?? (await steel.newPage());
    const stage = await recorder.newPage();
    await stage.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
    await stage.evaluateOnNewDocument((origin) => {
      if (location.origin === origin) localStorage.setItem("steel-browser:rail", "0");
    }, new URL(uiUrl).origin);
    await stage.goto(`http://localhost:${port}`);
    const ui = await (await stage.waitForSelector("iframe"))?.contentFrame();
    if (!ui) throw new Error(`Can't load the UI at ${uiUrl}`);
    const live = await (await ui.waitForSelector("iframe.live-frame"))?.contentFrame();
    await live?.waitForSelector("#connection-status.online");

    await agent.goto("https://en.wikipedia.org/wiki/Web_browser", { waitUntil: "networkidle2" });
    await agent.mouse.move(980, 620);
    await pause(1500);

    const panel = await (await ui.waitForSelector(".panel"))?.boundingBox();
    if (!panel) throw new Error("The UI panel is not visible");
    const area = {
      x: Math.floor(panel.x),
      y: Math.floor(panel.y),
      width: Math.ceil(panel.width),
      height: Math.ceil(panel.height),
    };
    await stage.screenshot({ path: backdrop });
    const screencast = await stage.screencast({ path: video, crop: area, quality: 4 });
    await pause(500);

    await clickInPage(agent, '#searchform input[name="search"]');
    await pause(250);
    await agent.keyboard.type("Headless browser", { delay: 45 });
    await pause(600);
    await Promise.all([
      agent.waitForNavigation({ waitUntil: "domcontentloaded" }),
      agent.keyboard.press("Enter"),
    ]);
    await agent.mouse.move(760, 460, { steps: 12 });
    await pause(400);
    await scroll(agent, 520);
    await pause(1000);

    await clickInUi(stage, ui, "button.devtools-toggle");
    await pause(1800);
    await scroll(agent, 480);
    await pause(1500);

    await screencast.stop();
    await execFileAsync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-loop",
      "1",
      "-framerate",
      "20",
      "-i",
      backdrop,
      "-i",
      video,
      "-filter_complex",
      `[0][1]overlay=${area.x}:${area.y}:shortest=1,split[a][b];[a]palettegen=stats_mode=full[p];[b][p]paletteuse=dither=bayer:diff_mode=rectangle`,
      output,
    ]);
    console.log(`Saved ${output}`);
  } finally {
    await recorder?.close();
    await steel?.disconnect();
    await post(`/v1/sessions/${session.id}/release`, {});
    await rm(video, { force: true });
    await rm(backdrop, { force: true });
  }
}

run().catch(console.error);
