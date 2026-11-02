import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import puppeteer, { type Browser } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { CDPService } from "./cdp.service.js";
import {
  overrideDeviceMemoryHints,
  withDeviceMemoryHints,
} from "../../utils/device-memory-hints.js";

const logger = {
  child: () => logger,
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
};

describe("selected memory request hints", () => {
  it("queues configured hints before asynchronous new-page setup yields", () => {
    const service = new CDPService({}, logger as any);
    Object.assign(service, {
      launchConfig: {},
      fingerprintData: { headers: {}, fingerprint: { navigator: { deviceMemory: 4 } } },
    });
    const send = vi.fn().mockResolvedValue({});
    (service as any).queueFingerprintHeaders({ _session: () => ({ send }) });
    expect(send).toHaveBeenCalledWith("Network.setExtraHTTPHeaders", {
      headers: { "device-memory": "4", "sec-ch-device-memory": "4" },
    });
    send.mockClear();
    Object.assign(service, { launchConfig: { skipFingerprintInjection: true } });
    (service as any).queueFingerprintHeaders({ _session: () => ({ send }) });
    expect(send).not.toHaveBeenCalled();
  });

  it("uses the same configured memory in the production HTTP and JavaScript injection paths", async () => {
    const service = new CDPService({}, logger as any);
    Object.assign(service, { launchConfig: {} });
    const page = {
      setUserAgent: vi.fn().mockResolvedValue(undefined),
      setExtraHTTPHeaders: vi.fn().mockResolvedValue(undefined),
      createCDPSession: vi.fn().mockResolvedValue({ send: vi.fn().mockResolvedValue({}) }),
      evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
      isClosed: () => false,
    };
    await (service as any).injectFingerprintSafely(page, {
      headers: { "Device-Memory": "32", "sec-ch-device-memory": "32" },
      fingerprint: {
        navigator: {
          userAgent: "Mozilla/5.0 Chrome/156.0.0.0",
          platform: "Linux x86_64",
          deviceMemory: 4,
          hardwareConcurrency: 13,
          userAgentData: { platform: "Linux", mobile: false, brands: [] },
        },
      },
    });
    expect(page.setExtraHTTPHeaders).toHaveBeenCalledWith({
      "device-memory": "4",
      "sec-ch-device-memory": "4",
    });
    expect(page.evaluateOnNewDocument).toHaveBeenCalledWith(
      expect.stringContaining("const FIXED_DEVICE_MEMORY = 4"),
    );
  });

  it("rewrites both header spellings without changing other headers or creating unsolicited hints", () => {
    const input = { "Device-Memory": "32", "sec-ch-device-memory": "32", authorization: "fixture" };
    expect(overrideDeviceMemoryHints(input, 4)).toEqual({
      ...input,
      "Device-Memory": "4",
      "sec-ch-device-memory": "4",
    });
    expect(input["Device-Memory"]).toBe("32");
    expect(withDeviceMemoryHints(input, 4)).toEqual({
      authorization: "fixture",
      "device-memory": "4",
      "sec-ch-device-memory": "4",
    });
    expect(overrideDeviceMemoryHints({ accept: "*/*" }, 4)).toBeUndefined();
    expect(() => overrideDeviceMemoryHints(input, Number.NaN)).toThrow(RangeError);
  });

  it("uses the selected profile in the existing request path and leaves native/disabled sessions alone", async () => {
    const service = new CDPService({}, logger as any);
    const continuation = vi.fn();
    const request = {
      url: () => "https://example.test/",
      headers: () => ({ "device-memory": "32", "sec-ch-device-memory": "32" }),
      continue: continuation,
    };
    Object.assign(service, {
      launchConfig: {},
      fingerprintData: { fingerprint: { navigator: { deviceMemory: 4 } } },
    });
    await (service as any).handlePageRequest(request, {});
    expect(continuation).toHaveBeenLastCalledWith({
      headers: { "device-memory": "4", "sec-ch-device-memory": "4" },
    });
    Object.assign(service, { launchConfig: { skipFingerprintInjection: true } });
    await (service as any).handlePageRequest(request, {});
    expect(continuation).toHaveBeenLastCalledWith(undefined);
  });
});

const executablePath = [
  process.env.CHROME_EXECUTABLE_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((path): path is string => Boolean(path && existsSync(path)));

describe.skipIf(!executablePath)("negotiated memory hints in Chromium", () => {
  let browser: Browser;
  let server: Server;
  let origin: string;
  beforeAll(async () => {
    server = createServer((request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Accept-CH", "Device-Memory, Sec-CH-Device-Memory");
      response.setHeader("Content-Type", "application/json");
      if (request.url === "/sw.js") {
        response.setHeader("Content-Type", "application/javascript");
        response.end(`
          self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
          self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
          self.addEventListener('fetch', event => {
            if (new URL(event.request.url).pathname !== '/controlled') return;
            event.respondWith((async () => {
              const forwarded = await (await fetch(event.request)).json();
              return Response.json({
                incoming: { memory: event.request.headers.get('device-memory'), secMemory: event.request.headers.get('sec-ch-device-memory') },
                forwarded
              });
            })());
          });
        `);
        return;
      }
      if (request.url === "/redirect") {
        response.writeHead(302, { location: "/echo" });
        response.end();
        return;
      }
      response.end(
        JSON.stringify({
          memory: request.headers["device-memory"] ?? null,
          secMemory: request.headers["sec-ch-device-memory"] ?? null,
        }),
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-background-networking"],
    });
  });
  afterAll(async () => {
    await browser?.close();
    server?.closeAllConnections();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("overrides hints before service-worker dispatch, including fetch, redirects and frames", async () => {
    const page = await browser.newPage();
    const service = new CDPService({}, logger as any);
    Object.assign(service, {
      launchConfig: {},
      fingerprintData: { fingerprint: { navigator: { deviceMemory: 4 } } },
    });
    const failures: unknown[] = [];
    try {
      await page.setExtraHTTPHeaders(withDeviceMemoryHints({}, 4));
      await page.setRequestInterception(true);
      page.on(
        "request",
        (request) =>
          void (service as any)
            .handlePageRequest(request, page)
            .catch((error: unknown) => failures.push(error)),
      );
      const initial = await page.goto(origin);
      expect(await initial!.json()).toEqual({ memory: "4", secMemory: "4" });
      const result = await page.evaluate(async () => {
        const fetchResult = await (await fetch("/redirect")).json();
        const frame = document.createElement("iframe");
        frame.src = "/echo";
        await new Promise<void>((resolve) => {
          frame.onload = () => resolve();
          document.body.append(frame);
        });
        const frameResult = JSON.parse(frame.contentDocument!.body.textContent!);
        frame.remove();
        return { fetchResult, frameResult };
      });
      expect(result).toEqual({
        fetchResult: { memory: "4", secMemory: "4" },
        frameResult: { memory: "4", secMemory: "4" },
      });
      expect(failures).toEqual([]);
      const controlled = await page.evaluate(async () => {
        await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) {
          await new Promise<void>((resolve) =>
            navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), {
              once: true,
            }),
          );
        }
        return (await fetch("/controlled")).json();
      });
      expect(controlled).toEqual({
        incoming: { memory: "4", secMemory: "4" },
        forwarded: { memory: "4", secMemory: "4" },
      });
    } finally {
      await page.close();
    }
  });
});
