import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import puppeteer, { type Browser } from "puppeteer-core";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { getChromeExecutablePath } from "../../../utils/browser.js";
import { readChromeVersion } from "./chrome-version.js";
import { getUserAgentBrandLists } from "./user-agent-brands.js";

const executablePath = getChromeExecutablePath();
const hasBrowser = fs.existsSync(executablePath);

// Compares the port with what the installed Chromium reports by itself.
describe.skipIf(!hasBrowser)("Chromium UA-CH brand list port against the binary", () => {
  let browser: Browser;
  let profile: string;
  let server: http.Server;
  let origin: string;

  beforeAll(async () => {
    // userAgentData exists only in secure contexts; 127.0.0.1 is one.
    server = http.createServer((_, res) => res.end("<!doctype html>"));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    profile = fs.mkdtempSync(path.join(os.tmpdir(), "steel-brands-"));
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      userDataDir: profile,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    });
  });

  afterAll(async () => {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true });
  });

  test("reads the same version as Browser.getVersion", async () => {
    const product = await browser.version();
    const version = await readChromeVersion(executablePath);
    expect(product).toMatch(new RegExp(`/${version!.full.replace(/\./g, "\\.")}$`));
  });

  test("generates the brands and full version list the binary sends", async () => {
    const version = await readChromeVersion(executablePath);
    const page = await browser.newPage();
    await page.goto(origin);
    const native = await page.evaluate(async () => {
      const data = (navigator as any).userAgentData;
      const { fullVersionList } = await data.getHighEntropyValues(["fullVersionList"]);
      return { brands: data.brands, fullVersionList };
    });
    // Google Chrome builds add their product brand; Chromium builds do not.
    const brand = native.brands.some((b: { brand: string }) => b.brand === "Google Chrome")
      ? "Google Chrome"
      : null;
    expect(native).toEqual(getUserAgentBrandLists(version!.full, brand));
  });
});
