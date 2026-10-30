import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import puppeteer from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CORE_CPU_GRAPHICS_ARGS, coreCpuGraphicsEnvironment } from "./cpu-graphics.js";

// Opt in with an actual Chrome/Core executable and Xvfb installed. These tests
// exercise the production CPU backend without an unsafe SwiftShader opt-in.
const executablePath = process.env.CPU_GRAPHICS_TEST_BROWSER;

function renderProbe() {
  const values: Record<string, unknown> = {};

  for (const api of ["webgl", "webgl2"] as const) {
    const canvas =
      typeof document === "undefined"
        ? new OffscreenCanvas(4, 4)
        : Object.assign(document.createElement("canvas"), { width: 4, height: 4 });
    const gl = canvas.getContext(api) as WebGLRenderingContext | WebGL2RenderingContext | null;
    if (!gl) {
      values[api] = null;
      continue;
    }

    const extension = gl.getExtension("WEBGL_debug_renderer_info");
    const program = gl.createProgram()!;

    for (const [type, source] of [
      [gl.VERTEX_SHADER, "attribute vec2 p; void main(){gl_Position=vec4(p,0.,1.);}"],
      [gl.FRAGMENT_SHADER, "precision mediump float; void main(){gl_FragColor=vec4(1.,0.,0.,1.);}"],
    ] as const) {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      gl.attachShader(program, shader);
    }

    gl.linkProgram(program);
    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    const position = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const pixel = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);

    values[api] = {
      renderer: extension && gl.getParameter(extension.UNMASKED_RENDERER_WEBGL),
      version: gl.getParameter(gl.VERSION),
      linked: gl.getProgramParameter(program, gl.LINK_STATUS),
      pixel: Array.from(pixel),
      realBinding: gl.getParameter(gl.ARRAY_BUFFER_BINDING) === buffer,
      error: gl.getError(),
    };
  }

  return values;
}

describe.skipIf(!executablePath)("CPU-only Core graphics backend", () => {
  let xvfb: ChildProcess;
  let display: string;
  let origin: string;

  const server = createServer((request, response) => {
    if (request.url === "/worker.js") {
      response.setHeader("Content-Type", "application/javascript");
      response.end(`postMessage((${renderProbe.toString()})())`);
    } else {
      response.setHeader("Content-Type", "text/html");
      response.end("<!doctype html><title>Local CPU graphics regression</title>");
    }
  });

  beforeAll(async () => {
    xvfb = spawn("Xvfb", ["-displayfd", "3", "-screen", "0", "1920x1080x24", "-nolisten", "tcp"], {
      stdio: ["ignore", "ignore", "ignore", "pipe"],
    });

    display = await new Promise<string>((resolve, reject) => {
      xvfb.stdio[3]!.once("data", (chunk) => resolve(`:${String(chunk).trim()}`));
      xvfb.once("error", reject);
      xvfb.once("exit", () => reject(new Error("Xvfb exited before display setup")));
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    xvfb?.kill();
  });

  it.each([false, true])(
    "executes WebGL 1/2 shaders in page and worker (headless=%s)",
    async (headless) => {
      const browser = await puppeteer.launch({
        executablePath,
        headless,
        env: { ...process.env, ...coreCpuGraphicsEnvironment(display) },
        args: [
          ...CORE_CPU_GRAPHICS_ARGS,
          "--disable-background-networking",
          ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
        ],
      });

      try {
        const page = await browser.newPage();
        await page.setRequestInterception(true);
        page.on(
          "request",
          (request) =>
            void (request.url().startsWith(`${origin}/`) ? request.continue() : request.abort()),
        );

        await page.goto(origin);

        const session = await browser.target().createCDPSession();
        const { gpu } = await session.send("SystemInfo.getInfo");
        await session.detach();

        // Check the real backend below the web-facing identity mask as well.
        expect(JSON.stringify(gpu)).toMatch(/llvmpipe/i);

        const documentValues = await page.evaluate(renderProbe);
        const workerValues = await page.evaluate(
          () =>
            new Promise<Record<string, any>>((resolve, reject) => {
              const worker = new Worker("/worker.js");
              worker.onmessage = (event) => {
                worker.terminate();
                resolve(event.data);
              };
              worker.onerror = reject;
            }),
        );

        for (const values of [documentValues, workerValues]) {
          for (const api of ["webgl", "webgl2"]) {
            expect(values[api]).toMatchObject({
              linked: true,
              pixel: [255, 0, 0, 255],
              realBinding: true,
              error: 0,
              renderer: expect.stringMatching(/llvmpipe|^WebKit WebGL$/i),
            });
          }
        }

        expect(workerValues).toEqual(documentValues);
      } finally {
        await browser.close();
      }
    },
  );
});
