import { FastifyReply } from "fastify";
import { BrowserContext, Page, HTTPResponse } from "puppeteer-core";
import { CDPService } from "../../services/cdp/cdp.service.js";
import { SessionService } from "../../services/session.service.js";
import { ScrapeFormat } from "../../types/index.js";
import { getErrors } from "../../utils/errors.js";
import { updateLog } from "../../utils/logging.js";
import { IProxyServer } from "../../utils/proxy.js";
import {
  cleanHtml,
  getDefuddleContent,
  htmlToMarkdown,
  transformHtml,
} from "../../utils/scrape/index.js";
import { normalizeUrl } from "../../utils/url.js";
import { PDFRequest, ScrapeRequest, ScreenshotRequest } from "./actions.schema.js";
import { DefuddleResponse } from "defuddle";
import pdf2html from "pdf2html";
import {
  buildHtmlLikeMetadataFromPdf,
  extractLinksFromConvertedHtml,
} from "../../utils/scrape/pdfToHtml.js";
import { safeGoto } from "../../utils/scrape/safeGoTo.js";

export const handleScrape = async (
  sessionService: SessionService,
  browserService: CDPService,
  request: ScrapeRequest,
  reply: FastifyReply,
) => {
  const startTime = Date.now();
  let times: Record<string, number> = {};
  const { url, format, screenshot, pdf, proxyUrl, logUrl, delay } = request.body;

  let proxy: IProxyServer | null = null;
  let context: BrowserContext | null = null;

  try {
    if (proxyUrl) {
      proxy = await sessionService.proxyFactory(proxyUrl);
      await proxy.listen();
    }
    times.proxyTime = Date.now() - startTime;

    let page: Page;
    let response: HTTPResponse | null = null;
    let pdfResponse: HTTPResponse | null = null;
    let isPdfNavigation = false;

    if (!browserService.isRunning()) {
      await browserService.launch();
    }

    if (proxy) {
      // If a proxy is used, we proceed with browser navigation; implementing proxy-aware Node fetch
      // would require an HTTP agent and is outside current scope.
      context = await browserService.createBrowserContext(proxy.url);
      page = await context.newPage();
      times.proxyPageTime = Date.now() - startTime - times.proxyTime;
    } else {
      page = await browserService.getPrimaryPage();
      times.pageTime = Date.now() - startTime - times.proxyTime;
    }

    // PDF retrieval will use node fetch with session cookies; removed CDP tracking

    let normalizedUrl: string | null = null;
    if (url) {
      normalizedUrl = normalizeUrl(url);
      if (!normalizedUrl) {
        throw new Error(`Invalid URL: ${url}`);
      }
    }

    const safeResponse = normalizedUrl
      ? await safeGoto(page, normalizedUrl, {
          timeout: 30000,
          waitUntil: "domcontentloaded",
        })
      : { response: null, isPdf: false, pdfResponse: null };

    response = safeResponse.response !== null ? safeResponse.response : safeResponse.pdfResponse;
    pdfResponse = safeResponse.pdfResponse;
    const isPdf = safeResponse.isPdf;

    if (delay) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const contentType = response?.headers()["content-type"]?.toLowerCase() || "";

    let scrapeResponse: Record<string, any> = {};
    let htmlContent = "";
    let cleanedHtml: string;
    let readabilityContent: DefuddleResponse;

    if (isPdf || contentType.includes("application/pdf")) {
      // Node fetch using session cookies (same browser auth state)
      const targetUrl = normalizedUrl || url!;
      const cookies = await page.cookies(targetUrl);
      const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
      const fetchHeaders: Record<string, string> = {};
      if (cookieHeader) fetchHeaders["Cookie"] = cookieHeader;
      if (!fetchHeaders["Referer"]) {
        const u = new URL(targetUrl);
        fetchHeaders["Referer"] = u.origin + "/";
      }
      const nodeRes = await fetch(targetUrl, {
        method: "GET",
        redirect: "follow",
        headers: fetchHeaders,
      });
      const nodeCT = (nodeRes.headers.get("content-type") || "").toLowerCase();
      if (!nodeRes.ok || !nodeCT.includes("application/pdf")) {
        throw new Error(`Expected PDF; got status ${nodeRes.status} content-type ${nodeCT}`);
      }
      const arrBuf = await nodeRes.arrayBuffer();
      const pdfBuffer = Buffer.from(arrBuf);

      const convertStart = Date.now();
      htmlContent = await pdf2html.html(pdfBuffer);
      times.pdfHtmlConvertTime = Date.now() - convertStart;

      const metaStart = Date.now();
      const pdfMeta = await pdf2html.meta(pdfBuffer);
      times.pdfMetaTime = Date.now() - metaStart;

      const htmlMeta = buildHtmlLikeMetadataFromPdf(pdfMeta, {
        urlSource: targetUrl,
        statusCode: nodeRes.status,
        htmlForFallback: htmlContent,
      });

      const htmlLinks = extractLinksFromConvertedHtml(htmlContent);

      scrapeResponse = {
        content: {},
        metadata: {
          ...htmlMeta,
          statusCode: nodeRes.status,
          headers: Object.fromEntries(nodeRes.headers.entries()),
          originalContentType: nodeCT,
          pdfAcquisition: "node-fetch-with-cookies",
        },
        links: htmlLinks,
      };

      if (pdf) {
        scrapeResponse.pdf = pdfBuffer.toString("base64");
      }
    } else {
      // Regular HTML flow
      await page.evaluate(() => {
        (window as any).__name = (func: Function) => func;
      });

      const [{ html, metadata, links }, base64Screenshot, pdfBuffer] = await Promise.all([
        page.evaluate(() => {
          const getMetaContent = (selector: string) => {
            const element = document.querySelector(selector);
            return element ? element.getAttribute("content") : null;
          };
          const getMetaByName = (name: string) => getMetaContent(`meta[name="${name}"]`);
          const getMetaByProperty = (property: string) =>
            getMetaContent(`meta[property="${property}"]`);

          const extractJsonLd = () => {
            const scripts = document.querySelectorAll('script[type="application/ld+json"]');
            const jsonLdData: any[] = [];
            scripts.forEach((script) => {
              try {
                const data = JSON.parse(script.textContent || "");
                jsonLdData.push(data);
              } catch (e) {
                console.error(e);
              }
            });
            return jsonLdData;
          };

          return {
            html: document.documentElement.outerHTML,
            links: [...document.links].map((l) => ({
              url: l.href,
              text: l.textContent?.trim() || "",
            })),
            metadata: {
              title: document.title,
              language: document.documentElement.lang,
              urlSource: window.location.href,
              timestamp: new Date().toISOString(),

              description: getMetaByName("description"),
              keywords: getMetaByName("keywords"),
              author: getMetaByName("author"),

              ogTitle: getMetaByProperty("og:title"),
              ogDescription: getMetaByProperty("og:description"),
              ogImage: getMetaByProperty("og:image"),
              ogUrl: getMetaByProperty("og:url"),
              ogSiteName: getMetaByProperty("og:site_name"),

              articleAuthor: getMetaByProperty("article:author"),
              publishedTime: getMetaByProperty("article:published_time"),
              modifiedTime: getMetaByProperty("article:modified_time"),

              canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href"),
              favicon: document.querySelector('link[rel="icon"]')?.getAttribute("href"),

              jsonLd: extractJsonLd(),
              statusCode: 200,
            },
          };
        }),
        screenshot ? page.screenshot({ encoding: "base64", type: "jpeg", quality: 100 }) : null,
        pdf ? page.pdf() : null,
      ]);

      htmlContent = html;
      times.extractionTime = Date.now() - startTime - (times.pageLoadTime || 0);

      scrapeResponse = { content: {}, metadata, links };

      if (base64Screenshot) {
        scrapeResponse.screenshot = base64Screenshot;
      }
      if (pdfBuffer) {
        scrapeResponse.pdf = Buffer.from(pdfBuffer).toString("base64");
      }
    }

    // Format handling (works for both PDF converted HTML and normal HTML)
    if (format && format.length > 0) {
      if (format.includes(ScrapeFormat.HTML)) {
        scrapeResponse.content.html = htmlContent;
      }

      const needsCleanedHtml = format.includes(ScrapeFormat.CLEANED_HTML);
      const needsReadability =
        format.includes(ScrapeFormat.READABILITY) || format.includes(ScrapeFormat.MARKDOWN);

      if (needsCleanedHtml) {
        const cleanHtmlStart = Date.now();
        cleanedHtml = cleanHtml(htmlContent);
        times.cleanedHtmlTime = Date.now() - cleanHtmlStart;

        if (format.includes(ScrapeFormat.CLEANED_HTML)) {
          scrapeResponse.content.cleaned_html = cleanedHtml;
        }
      }

      if (needsReadability) {
        const readabilityStart = Date.now();
        readabilityContent = await getDefuddleContent(
          transformHtml(htmlContent, normalizedUrl || url),
        );
        times.readabilityTime = Date.now() - readabilityStart;

        if (format.includes(ScrapeFormat.READABILITY)) {
          scrapeResponse.content.readability = readabilityContent.content;
        }
      }

      if (format.includes(ScrapeFormat.MARKDOWN)) {
        const markdownStart = Date.now();
        scrapeResponse.content.markdown = await htmlToMarkdown(readabilityContent!.content);
        times.markdownTime = Date.now() - markdownStart;
      }
    } else {
      scrapeResponse.content.html = htmlContent;
    }

    times.totalInstanceTime = Date.now() - startTime;

    if (logUrl) {
      await updateLog(logUrl, { times });
    }

    return reply.send(scrapeResponse);
  } catch (e: unknown) {
    const error = getErrors(e);

    if (logUrl) {
      await updateLog(logUrl, { times, response: { browserError: error } });
    }

    if (url) {
      await browserService.refreshPrimaryPage();
    }
    return reply.code(500).send({ message: error });
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    if (proxy) {
      await proxy.close(true).catch(() => {});
    }
  }
};

export const handleScreenshot = async (
  sessionService: SessionService,
  browserService: CDPService,
  request: ScreenshotRequest,
  reply: FastifyReply,
) => {
  const startTime = Date.now();
  let times: Record<string, number> = {};
  const { url, logUrl, proxyUrl, delay, fullPage } = request.body;

  let proxy: IProxyServer | null = null;
  let context: BrowserContext | null = null;

  if (!browserService.isRunning()) {
    await browserService.launch();
  }

  try {
    if (proxyUrl) {
      proxy = await sessionService.proxyFactory(proxyUrl);
      await proxy.listen();
    }

    times.proxyTime = Date.now() - startTime;

    let page: Page;

    if (proxy) {
      context = await browserService.createBrowserContext(proxy.url);
      page = await context.newPage();
      times.proxyPageTime = Date.now() - startTime - times.proxyTime;
    } else {
      page = await browserService.getPrimaryPage();
      times.pageTime = Date.now() - startTime;
    }

    if (url) {
      const normalizedUrl = normalizeUrl(url);
      if (!normalizedUrl) {
        throw new Error(`Invalid URL: ${url}`);
      }
      await page.goto(normalizedUrl, { timeout: 30000, waitUntil: "domcontentloaded" });
      times.pageLoadTime = Date.now() - times.pageTime - times.proxyTime - startTime;
    }

    if (delay) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const screenshot = await page.screenshot({ fullPage, type: "jpeg", quality: 100 });
    times.screenshotTime =
      Date.now() - times.pageLoadTime - times.pageTime - times.proxyTime - startTime;

    if (logUrl) {
      await updateLog(logUrl, { times });
    }

    return reply.send(screenshot);
  } catch (e: unknown) {
    const error = getErrors(e);

    if (logUrl) {
      await updateLog(logUrl, { times, response: { browserError: error } });
    }

    if (url) {
      await browserService.refreshPrimaryPage();
    }

    return reply.code(500).send({ message: error });
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    if (proxy) {
      await proxy.close(true).catch(() => {});
    }
  }
};

export const handlePDF = async (
  sessionService: SessionService,
  browserService: CDPService,
  request: PDFRequest,
  reply: FastifyReply,
) => {
  const startTime = Date.now();
  let times: Record<string, number> = {};
  const { url, logUrl, proxyUrl, delay } = request.body;

  let proxy: IProxyServer | null = null;
  let context: BrowserContext | null = null;

  if (!browserService.isRunning()) {
    await browserService.launch();
  }

  try {
    if (proxyUrl) {
      proxy = await sessionService.proxyFactory(proxyUrl);
      await proxy.listen();
    }

    times.proxyTime = Date.now() - startTime;

    let page: Page;

    if (proxy) {
      context = await browserService.createBrowserContext(proxy.url);
      page = await context.newPage();
      times.proxyPageTime = Date.now() - startTime - times.proxyTime;
    } else {
      page = await browserService.getPrimaryPage();
      times.pageTime = Date.now() - startTime;
    }

    if (url) {
      const normalizedUrl = normalizeUrl(url);
      if (!normalizedUrl) {
        throw new Error(`Invalid URL: ${url}`);
      }
      await page.goto(normalizedUrl, { timeout: 30000, waitUntil: "domcontentloaded" });
      times.pageLoadTime = Date.now() - times.pageTime - times.proxyTime - startTime;
    }

    if (delay) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const pdf = await page.pdf();
    times.pdfTime = Date.now() - times.pageLoadTime - times.pageTime - times.proxyTime - startTime;

    if (logUrl) {
      await updateLog(logUrl, { times });
    }

    return reply.send(pdf);
  } catch (e: unknown) {
    const error = getErrors(e);

    if (logUrl) {
      await updateLog(logUrl, { times, response: { browserError: error } });
    }

    if (url) {
      await browserService.refreshPrimaryPage();
    }

    return reply.code(500).send({ message: error });
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    if (proxy) {
      await proxy.close(true).catch(() => {});
    }
  }
};
