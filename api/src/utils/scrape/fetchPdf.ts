import { Page } from "puppeteer-core";

export const PDF_FETCH_TIMEOUT_MS = 30_000;

export async function fetchPdf(page: Page, targetUrl: string) {
  const cookies = await page.cookies(targetUrl);
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const headers: Record<string, string> = { Referer: new URL(targetUrl).origin + "/" };
  if (cookieHeader) headers["Cookie"] = cookieHeader;

  const response = await fetch(targetUrl, {
    method: "GET",
    redirect: "follow",
    headers,
    signal: AbortSignal.timeout(PDF_FETCH_TIMEOUT_MS),
  });
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  if (!response.ok || !contentType.includes("application/pdf")) {
    throw new Error(`Expected PDF; got status ${response.status} content-type ${contentType}`);
  }

  return { buffer: Buffer.from(await response.arrayBuffer()), response, contentType };
}
