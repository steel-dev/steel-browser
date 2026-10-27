import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import type { FastifyBaseLogger } from "fastify";
import puppeteer, { type Browser } from "puppeteer-core";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import type { BrowserLauncherOptions } from "../../types/browser.js";
import { CDPService } from "./cdp.service.js";
import { ShutdownReason } from "./plugins/core/base-plugin.js";

vi.mock("../file.service.js", () => ({
  FileService: {
    getInstance: () => ({
      cleanupFiles: vi.fn().mockResolvedValue(undefined),
      getBaseFilesPath: () => os.tmpdir(),
    }),
  },
}));

vi.mock("../timezone-fetcher.service.js", () => ({
  TimezoneFetcher: class {
    getTimezone() {
      return Promise.resolve("UTC");
    }
  },
}));

vi.mock("../../utils/extensions.js", () => ({
  getExtensionPaths: vi.fn().mockResolvedValue([]),
}));

const logger = {
  child: () => logger,
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
};

const prototype = CDPService.prototype as unknown as {
  requiresRequestInterception(this: {
    launchConfig?: Partial<BrowserLauncherOptions>;
    compiledUrlPatterns: RegExp[];
  }): boolean;
};

function requiresRequestInterception(
  launchConfig?: Partial<BrowserLauncherOptions>,
  compiledUrlPatterns: RegExp[] = [],
) {
  return prototype.requiresRequestInterception.call({ launchConfig, compiledUrlPatterns });
}

describe("CDPService request interception", () => {
  test("leaves interception disabled without blocking features", () => {
    expect(requiresRequestInterception()).toBe(false);
    expect(requiresRequestInterception({ blockAds: false })).toBe(false);
    expect(requiresRequestInterception({ optimizeBandwidth: false })).toBe(false);
    expect(requiresRequestInterception({ optimizeBandwidth: {} })).toBe(false);
  });

  test("enables interception for ad and URL blocking", () => {
    expect(requiresRequestInterception({ blockAds: true })).toBe(true);
    expect(requiresRequestInterception({}, [/ads/])).toBe(true);
  });

  test.each([
    ["blockImages", { blockImages: true }],
    ["blockMedia", { blockMedia: true }],
    ["blockStylesheets", { blockStylesheets: true }],
    ["blockHosts", { blockHosts: ["example.com"] }],
    ["blockUrlPatterns", { blockUrlPatterns: ["**/tracking/**"] }],
  ])("enables interception for optimizeBandwidth %s", (_, optimizeBandwidth) => {
    expect(requiresRequestInterception({ optimizeBandwidth })).toBe(true);
  });
});

describe("CDPService without request interception", () => {
  let dataDir: string;
  let server: http.Server;
  let origin: string;
  let service: CDPService | undefined;
  let client: Browser | undefined;

  beforeAll(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "steel-interception-"));
    server = http.createServer((req, res) => {
      if (req.url === "/app.js") {
        res.writeHead(200, { "content-type": "application/javascript" });
        res.end(
          `window.external_ = [localStorage.getItem("token"), sessionStorage.getItem("tab")];`,
        );
        return;
      }
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        `<script>window.inline_ = [localStorage.getItem("token"), sessionStorage.getItem("tab")];</script><script src="/app.js"></script>`,
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await client?.disconnect().catch(() => {});
    await service?.shutdown(ShutdownReason.SESSION_END).catch(() => {});
    client = undefined;
    service = undefined;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  async function start(config: Partial<BrowserLauncherOptions> = {}) {
    service = new CDPService({}, logger as unknown as FastifyBaseLogger, undefined, false);
    await service.startNewSession({
      options: {
        headless: true,
        args: ["--no-sandbox", "--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0"],
      },
      skipFingerprintInjection: true,
      userDataDir: fs.mkdtempSync(path.join(dataDir, "profile-")),
      ...config,
    });
    client = await puppeteer.connect({
      browserWSEndpoint: service.getBrowserInstance()!.wsEndpoint(),
      defaultViewport: null,
    });
    const [page] = await client.pages();
    return page;
  }

  test("blocks file:// navigations before the file loads", async () => {
    const secret = path.join(dataDir, "secret.txt");
    fs.writeFileSync(secret, "file-guard-secret");
    const page = await start();
    const endSession = vi.spyOn(service!, "endSession").mockResolvedValue(undefined);
    const session = await page.createCDPSession();

    session.send("Page.navigate", { url: `file://${secret}` }).catch(() => {});
    const seen: string[] = [];
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline) {
      const result = await session
        .send("Runtime.evaluate", {
          expression: "document.documentElement ? document.documentElement.innerText : ''",
          returnByValue: true,
        })
        .catch(() => undefined);
      seen.push(String(result?.result.value ?? ""));
    }

    expect(seen.join("\n")).not.toContain("file-guard-secret");
    expect(endSession).toHaveBeenCalledWith(ShutdownReason.SECURITY_VIOLATION);
  }, 30000);

  test("restores session storage before the page's first script runs", async () => {
    const page = await start({
      sessionContext: {
        localStorage: { [origin]: { token: "session-token" } },
        sessionStorage: { [origin]: { tab: "session-tab" } },
      },
    });

    await page.goto(origin);

    expect(await page.evaluate(() => [(window as any).inline_, (window as any).external_])).toEqual(
      [
        ["session-token", "session-tab"],
        ["session-token", "session-tab"],
      ],
    );
  }, 30000);
});
