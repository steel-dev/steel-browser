import { Page, HTTPResponse } from "puppeteer-core";

/**
 * Navigates to a URL and ignores net::ERR_ABORTED if the main-frame response is a PDF.
 * Returns { response, isPdf, pdfResponse }.
 *
 * - response: the normal Puppeteer Response from page.goto (null if it aborted on a PDF)
 * - isPdf: boolean indicating if the main-frame response was a PDF
 * - pdfResponse: the Response for the PDF (so you can buffer() it, if desired)
 */
export async function safeGoto(page: Page, url: string, options = {}) {
  let pdfResponse: HTTPResponse | null = null;

  const onResponse = (res: HTTPResponse) => {
    // Only consider main-frame document navigations
    const req = res.request();
    const isMainFrameDoc = req.resourceType() === "document" && req.frame() === page.mainFrame();

    if (!isMainFrameDoc) return;

    const ct = (res.headers()["content-type"] || "").toLowerCase();
    console.log("content-type", ct);
    if (ct.includes("application/pdf")) {
      pdfResponse = res;
    }
  };

  page.on("response", onResponse);

  try {
    const resp = await page.goto(url, options);
    return { response: resp, isPdf: !!pdfResponse, pdfResponse };
  } catch (err: any) {
    const message = String((err && err.message) || "");
    // If we detected a PDF and Chromium aborted the navigation, swallow it
    if (pdfResponse && message.includes("net::ERR_ABORTED")) {
      return { response: null, isPdf: true, pdfResponse };
    }
    throw err;
  } finally {
    page.off("response", onResponse);
  }
}
