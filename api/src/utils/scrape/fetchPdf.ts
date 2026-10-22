import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { Page } from "puppeteer-core";
import { SocksProxyAgent } from "socks-proxy-agent";

export const PDF_FETCH_TIMEOUT_MS = 30_000;
export const PDF_MAX_MEGABYTES = 50;

export interface FetchPdfOptions {
  proxyUrl?: string;
  timeoutMs?: number;
  maxMegabytes?: number;
}

export async function fetchPdf(page: Page, targetUrl: string, options: FetchPdfOptions = {}) {
  const { proxyUrl, timeoutMs = PDF_FETCH_TIMEOUT_MS, maxMegabytes = PDF_MAX_MEGABYTES } = options;
  const signal = AbortSignal.timeout(timeoutMs);

  const [cookies, userAgent] = await beforeDeadline(
    Promise.all([
      page.cookies(targetUrl),
      page.evaluate(() => navigator.userAgent).catch(() => page.browser().userAgent()),
    ]),
    signal,
  ).catch((error: unknown) => {
    throw signal.aborted ? downloadTimedOut(timeoutMs) : error;
  });
  const headers: Record<string, string> = {
    Referer: new URL(targetUrl).origin + "/",
    "User-Agent": userAgent,
  };
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  if (cookieHeader) headers["Cookie"] = cookieHeader;

  const agent = proxyUrl ? proxyAgentFor(proxyUrl) : undefined;

  const response = await axios
    .get<Buffer>(targetUrl, {
      responseType: "arraybuffer",
      headers,
      httpAgent: agent,
      httpsAgent: agent,
      proxy: false,
      signal,
      maxContentLength: maxMegabytes * 1024 * 1024,
      validateStatus: () => true,
    })
    .catch((error: unknown) => {
      throw downloadError(error, signal.aborted, timeoutMs, maxMegabytes);
    });

  const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
  if (response.status < 200 || response.status >= 300 || !contentType.includes("application/pdf")) {
    throw new Error(`Expected PDF; got status ${response.status} content-type ${contentType}`);
  }

  return {
    buffer: Buffer.from(response.data),
    status: response.status,
    headers: flattenHeaders(response.headers),
    contentType,
  };
}

function beforeDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function downloadTimedOut(timeoutMs: number): Error {
  return new Error(`PDF download timed out after ${timeoutMs} ms`);
}

function proxyAgentFor(proxyUrl: string) {
  return proxyUrl.startsWith("socks")
    ? new SocksProxyAgent(proxyUrl)
    : new HttpsProxyAgent(proxyUrl);
}

function downloadError(
  error: unknown,
  timedOut: boolean,
  timeoutMs: number,
  maxMegabytes: number,
): Error {
  if (timedOut) return downloadTimedOut(timeoutMs);
  if (axios.isAxiosError(error) && error.message.includes("maxContentLength")) {
    return new Error(`PDF is larger than ${maxMegabytes} MB`);
  }
  return new Error(
    `PDF download failed: ${error instanceof Error ? error.message : String(error)}`,
  );
}

function flattenHeaders(headers: object): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      Array.isArray(value) ? value.join(", ") : String(value),
    ]),
  );
}
