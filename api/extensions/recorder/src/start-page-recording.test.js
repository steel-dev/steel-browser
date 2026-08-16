/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { STEEL_RECORDER_SOURCE } from "./recorder-protocol.js";
import { startPageRecording } from "./start-page-recording.js";

const IncrementalSourceCanvasMutation = 9;
const EventTypeIncrementalSnapshot = 3;
const here = path.dirname(fileURLToPath(import.meta.url));

function installCanvasPolyfill() {
  class ImageDataPolyfill {
    constructor(data, width, height) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  }
  window.ImageData = ImageDataPolyfill;
  globalThis.ImageData = ImageDataPolyfill;

  class CanvasRenderingContext2D {
    constructor(canvas) {
      this.canvas = canvas;
    }
    fillRect() {}
    clearRect() {}
    drawImage() {}
    getImageData(_x, _y, width, height) {
      return new ImageDataPolyfill(new Uint8ClampedArray(width * height * 4), width, height);
    }
  }

  class WebGLRenderingContext {
    constructor(canvas) {
      this.canvas = canvas;
    }
    drawArrays() {}
    clear() {}
    getContextAttributes() {
      return { preserveDrawingBuffer: false };
    }
  }

  window.CanvasRenderingContext2D = CanvasRenderingContext2D;
  window.WebGLRenderingContext = WebGLRenderingContext;

  const contexts = new WeakMap();
  Object.defineProperty(window.HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    writable: true,
    value: function getContext(type) {
      const existing = contexts.get(this);
      if (existing) {
        return existing.type === type ? existing.ctx : null;
      }
      if (type === "2d") {
        const ctx = new CanvasRenderingContext2D(this);
        contexts.set(this, { type, ctx });
        return ctx;
      }
      if (type === "webgl" || type === "experimental-webgl") {
        const ctx = new WebGLRenderingContext(this);
        contexts.set(this, { type: "webgl", ctx });
        return ctx;
      }
      return null;
    },
  });

  Object.defineProperty(window.HTMLCanvasElement.prototype, "toDataURL", {
    configurable: true,
    writable: true,
    value: function toDataURL() {
      return "data:image/png;base64,iVBORw0KGgo=";
    },
  });
}

function canvasMutations(events) {
  return events.filter(
    (event) =>
      event?.type === EventTypeIncrementalSnapshot &&
      event?.data?.source === IncrementalSourceCanvasMutation,
  );
}

async function flushCanvasMutations() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
      return;
    }
    setTimeout(resolve, 32);
  });
}

installCanvasPolyfill();

describe("page-world canvas recorder", () => {
  let stop;

  afterEach(() => {
    if (typeof stop === "function") {
      stop();
    }
    stop = undefined;
    delete window.__steelPageRecordingStarted;
    document.body.innerHTML = "";
  });

  it("emits CanvasMutation frames from a 2d context created before recording starts", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    ctx.fillRect(0, 0, 4, 4);

    const events = [];
    stop = startPageRecording({
      packFn: null,
      emit: (event) => events.push(event),
    });

    ctx.fillRect(1, 1, 8, 8);
    await flushCanvasMutations();

    const mutations = canvasMutations(events);
    expect(mutations.length).toBeGreaterThan(0);
    expect(mutations.some((event) => event.data.commands?.some((command) => command.property === "fillRect"))).toBe(
      true,
    );
  });

  it("still emits CanvasMutation frames from a 2d context created after recording starts", async () => {
    const events = [];
    stop = startPageRecording({
      packFn: null,
      emit: (event) => events.push(event),
    });

    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    ctx.fillRect(2, 2, 6, 6);
    await flushCanvasMutations();

    const mutations = canvasMutations(events);
    expect(mutations.length).toBeGreaterThan(0);
    expect(mutations.some((event) => event.data.commands?.some((command) => command.property === "fillRect"))).toBe(
      true,
    );
  });

  it("emits CanvasMutation frames from a webgl context created before recording starts", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    document.body.appendChild(canvas);
    const gl = canvas.getContext("webgl");
    gl.drawArrays(0, 0, 3);

    const events = [];
    stop = startPageRecording({
      packFn: null,
      emit: (event) => events.push(event),
    });

    gl.drawArrays(0, 0, 6);
    await flushCanvasMutations();

    const mutations = canvasMutations(events);
    expect(mutations.length).toBeGreaterThan(0);
    expect(mutations.some((event) => event.data.commands?.some((command) => command.property === "drawArrays"))).toBe(
      true,
    );
  });

  it("does not lock an unused canvas to 2d so a later webgl context still works", () => {
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);

    stop = startPageRecording({
      packFn: null,
      emit: () => {},
    });

    const gl = canvas.getContext("webgl");
    expect(gl).not.toBeNull();
    expect(canvas.getContext("2d")).toBeNull();
  });

  it("forwards recorder events to the isolated world over postMessage", async () => {
    const messages = [];
    const onMessage = (event) => messages.push(event.data);
    window.addEventListener("message", onMessage);

    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");

    stop = startPageRecording({ packFn: null });
    ctx.fillRect(0, 0, 2, 2);
    await flushCanvasMutations();
    await new Promise((resolve) => setTimeout(resolve, 0));

    window.removeEventListener("message", onMessage);
    expect(messages.some((message) => message?.source === STEEL_RECORDER_SOURCE)).toBe(true);
  });
});

describe("recorder extension wiring", () => {
  it("runs rrweb in the page world at document_start", () => {
    const manifest = JSON.parse(readFileSync(path.join(here, "..", "manifest.json"), "utf8"));
    const pageWorld = manifest.content_scripts.find((script) => script.js.includes("dist/recorder-page.js"));
    const isolated = manifest.content_scripts.find((script) => script.js.includes("dist/inject.js"));

    expect(pageWorld).toMatchObject({
      run_at: "document_start",
      world: "MAIN",
    });
    expect(isolated.run_at).toBe("document_start");
    expect(isolated.world).not.toBe("MAIN");
  });

  it("keeps chrome.runtime in the isolated script and does not start rrweb there", () => {
    const inject = readFileSync(path.join(here, "inject.js"), "utf8");
    expect(inject).toContain("STEEL_RECORDER_SOURCE");
    expect(inject).toContain("chrome.runtime.sendMessage");
    expect(inject).not.toMatch(/from ["']rrweb["']/);
    expect(inject).not.toMatch(/\brecord\s*\(/);
  });
});
