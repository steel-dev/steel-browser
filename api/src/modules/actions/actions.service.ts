import { BrowserContext, Page } from "puppeteer-core";
import { ScrapeFormat } from "../../types/index.js";
import { SessionService } from "../../services/session.service.js";
import { CDPService } from "../../services/cdp/cdp.service.js";
import { IProxyServer } from "../../utils/proxy.js";
import {
  ScrapeResponse,
  SearchResponse,
  ScreenshotResponse,
  PDFResponse,
} from "./actions.schema.js";
import {
  cleanHtml,
  getDefuddleContent,
  htmlToMarkdown,
  transformHtml,
} from "../../utils/scrape/index.js";
import { getErrors } from "../../utils/errors.js";
import { updateLog } from "../../utils/logging.js";
import { normalizeUrl } from "../../utils/url.js";

/**
 * Core implementation of the scrape logic
 */
export const scrape = async (
  sessionService: SessionService,
  browserService: CDPService,
  url?: string,
  format?: ScrapeFormat[],
  screenshot?: boolean,
  pdf?: boolean,
  proxyUrl?: string,
  logUrl?: string,
  delay?: number,
): Promise<ScrapeResponse> => {
  const startTime = Date.now();
  let times: Record<string, number> = {};

  let proxy: IProxyServer | null = null;
  let context: BrowserContext | null = null;

  try {
    if (proxyUrl) {
      proxy = await sessionService.proxyFactory(proxyUrl);
      await proxy.listen();
    }

    times.proxyTime = Date.now() - startTime;

    let page: Page;

    if (!browserService.isRunning()) {
      await browserService.launch();
    }

    if (proxy) {
      context = await browserService.createBrowserContext(proxy.url);
      page = await context.newPage();
      times.proxyPageTime = Date.now() - startTime - (times.proxyTime || 0);
    } else {
      page = await browserService.getPrimaryPage();
      times.pageTime = Date.now() - startTime - (times.proxyTime || 0);
    }

    if (url) {
      const normalizedUrl = normalizeUrl(url);
      if (!normalizedUrl) {
        throw new Error(`Invalid URL: ${url}`);
      }
      await page.goto(normalizedUrl, { timeout: 30000, waitUntil: "domcontentloaded" });
      times.pageLoadTime = Date.now() - startTime - (times.pageTime || 0);
    }

    if (delay) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    // Polyfill the __name function injected by esbuild
    // https://github.com/evanw/esbuild/issues/2605#issuecomment-2146054255
    // https://github.com/cloudflare/workers-sdk/issues/7107
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

    times.extractionTime = Date.now() - startTime - (times.pageLoadTime || 0);

    let scrapeResponse: Record<string, any> = {
      content: {},
      metadata,
      links,
    };

    let cleanedHtml: string | undefined;
    let readabilityContent: Awaited<ReturnType<typeof getDefuddleContent>> | undefined;

    if (format && format.length > 0) {
      if (format.includes(ScrapeFormat.HTML)) {
        scrapeResponse.content.html = html;
      }

      const needsCleanedHtml = format.includes(ScrapeFormat.CLEANED_HTML);

      const needsReadability =
        format.includes(ScrapeFormat.READABILITY) || format.includes(ScrapeFormat.MARKDOWN);

      if (needsCleanedHtml) {
        const cleanHtmlStart = Date.now();
        cleanedHtml = cleanHtml(html);
        times.cleanedHtmlTime = Date.now() - cleanHtmlStart;

        if (format.includes(ScrapeFormat.CLEANED_HTML)) {
          scrapeResponse.content.cleaned_html = cleanedHtml;
        }
      }

      if (needsReadability) {
        const readabilityStart = Date.now();
        readabilityContent = await getDefuddleContent(transformHtml(html, url));
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
      scrapeResponse.content.html = html;
    }

    if (base64Screenshot) {
      scrapeResponse.screenshot = base64Screenshot;
    }
    if (pdfBuffer) {
      const base64Pdf = Buffer.from(pdfBuffer).toString("base64");
      scrapeResponse.pdf = base64Pdf;
    }

    times.totalInstanceTime = Date.now() - startTime;

    if (logUrl) {
      await updateLog(logUrl, { times });
    }

    return scrapeResponse as ScrapeResponse;
  } catch (e: unknown) {
    const error = getErrors(e);

    if (logUrl) {
      await updateLog(logUrl, { times, response: { browserError: error } });
    }

    if (url) {
      await browserService.refreshPrimaryPage();
    }

    throw new Error(error);
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    if (proxy) {
      await proxy.close(true).catch(() => {});
    }
  }
};

/**
 * Core implementation of the search logic
 */
export const search = async (
  sessionService: SessionService,
  browserService: CDPService,
  query: string,
  proxyUrl?: string,
  logUrl?: string,
): Promise<SearchResponse> => {
  const startTime = Date.now();
  let times: Record<string, number> = {};

  let proxy: IProxyServer | null = null;
  let context: BrowserContext | null = null;

  try {
    if (proxyUrl) {
      proxy = await sessionService.proxyFactory(proxyUrl);
      await proxy.listen();
    }

    let page: Page;

    times.proxyTime = Date.now() - startTime;

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

    await page.evaluate(() => {
      (window as any).__name = (func: Function) => func;
    });

    // Go to Brave
    await page.goto("https://search.brave.com/search?q=" + encodeURIComponent(query), {
      waitUntil: "networkidle2",
    });
    // Wait for results to load
    await page.waitForSelector("#results");
    // Scrape results
    const results = await page.evaluate(() => {
      const items = document.querySelectorAll("div.snippet");
      return Array.from(items)
        .map((item) => {
          if (
            [
              "llm-snippet",
              "faq",
              "pagination-snippet",
              "search-elsewhere",
              "infoblox-snippet",
              "discussions",
            ].includes(item.id)
          ) {
            return;
          }

          const urlEl = item.querySelector("div.result-content a");
          const descEl = item.querySelector("div.generic-snippet");
          const titleEl = item.querySelector("div.result-content a div.title");
          return {
            title: titleEl?.textContent?.trim() || null,
            url: urlEl?.getAttribute("href") || null,
            description: descEl?.textContent?.split("-")[1]?.trim() || null,
          };
        })
        .filter(
          (item) =>
            item &&
            typeof item === "object" &&
            "title" in item &&
            "url" in item &&
            "description" in item &&
            item.title !== null &&
            item.url !== null,
        );
    });

    times.totalInstanceTime = Date.now() - startTime;

    if (logUrl) {
      await updateLog(logUrl, { times });
    }

    return { results } as SearchResponse;
  } catch (e: any) {
    const error = getErrors(e);

    if (logUrl) {
      await updateLog(logUrl, { times, response: { browserError: error } });
    }

    throw new Error(error);
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }

    if (proxy) {
      await proxy.close(true).catch(() => {});
    }
  }
};

/**
 * Core implementation of the screenshot logic
 */
export const screenshot = async (
  sessionService: SessionService,
  browserService: CDPService,
  url?: string,
  logUrl?: string,
  proxyUrl?: string,
  delay?: number,
  fullPage?: boolean,
): Promise<ScreenshotResponse> => {
  const startTime = Date.now();
  let times: Record<string, number> = {};

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
      times.proxyPageTime = Date.now() - startTime - (times.proxyTime || 0);
    } else {
      page = await browserService.getPrimaryPage();
      times.pageTime = Date.now() - startTime - (times.proxyTime || 0);
    }

    if (url) {
      const normalizedUrl = normalizeUrl(url);
      if (!normalizedUrl) {
        throw new Error(`Invalid URL: ${url}`);
      }
      await page.goto(normalizedUrl, { timeout: 30000, waitUntil: "domcontentloaded" });
      times.pageLoadTime = Date.now() - startTime - (times.pageTime || 0);
    }

    if (delay) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const screenshot = await page.screenshot({
      fullPage: !!fullPage,
      type: "jpeg",
      quality: 100,
    });

    times.screenshotTime = Date.now() - startTime - (times.pageLoadTime || 0);

    if (logUrl) {
      await updateLog(logUrl, { times });
    }

    return { statusCode: 200, payload: screenshot };
  } catch (e: unknown) {
    const error = getErrors(e);

    if (logUrl) {
      await updateLog(logUrl, { times, response: { browserError: error } });
    }

    if (url) {
      await browserService.refreshPrimaryPage();
    }

    return { statusCode: 500, payload: { message: error } };
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    if (proxy) {
      await proxy.close(true).catch(() => {});
    }
  }
};

/**
 * Core implementation of the PDF logic
 */
export const pdf = async (
  sessionService: SessionService,
  browserService: CDPService,
  url?: string,
  logUrl?: string,
  proxyUrl?: string,
  delay?: number,
): Promise<PDFResponse> => {
  const startTime = Date.now();
  let times: Record<string, number> = {};

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
      times.proxyPageTime = Date.now() - startTime - (times.proxyTime || 0);
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
      times.pageLoadTime = Date.now() - (times.pageTime || 0) - (times.proxyTime || 0) - startTime;
    }

    if (delay) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const pdf = await page.pdf();
    times.pdfTime =
      Date.now() -
      (times.pageLoadTime || 0) -
      (times.pageTime || 0) -
      (times.proxyTime || 0) -
      startTime;

    if (logUrl) {
      await updateLog(logUrl, { times });
    }

    return { statusCode: 200, payload: pdf };
  } catch (e: unknown) {
    const error = getErrors(e);

    if (logUrl) {
      await updateLog(logUrl, { times, response: { browserError: error } });
    }

    if (url) {
      await browserService.refreshPrimaryPage();
    }

    return { statusCode: 500, payload: { message: error } };
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    if (proxy) {
      await proxy.close(true).catch(() => {});
    }
  }
};
