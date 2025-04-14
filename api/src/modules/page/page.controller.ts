import { FastifyReply } from "fastify";
import { SessionService } from "../../services/session.service";
import { CDPService } from "../../services/cdp.service";
import { getErrors } from "../../utils/errors";
import { cleanHtml, getMarkdown, getReadabilityContent } from "../../utils/scrape";
import { ScrapeFormat } from "../../types";
import { updateLog } from "../../utils/logging";
import { Page } from "puppeteer-core";
import { CurrentPagePDFRequest, CurrentPageScrapeRequest, CurrentPageScreenshotRequest } from "./page.schema";

export const handleCurrentPageScrape = async (
  sessionService: SessionService,
  browserService: CDPService,
  request: CurrentPageScrapeRequest,
  reply: FastifyReply,
) => {
  const startTime = Date.now();
  let times: Record<string, number> = {};
  const { format, screenshot, pdf, logUrl, delay } = request.body;
  try {
    const proxy = sessionService.activeSession.proxyServer;

    times.proxyTime = Date.now() - startTime;

    let page: Page;

    if (!browserService.isRunning()) {
      await browserService.launch();
    }

    if (proxy) {
      page = await browserService.getPrimaryPage();
      times.proxyPageTime = Date.now() - startTime - times.proxyTime;
    } else {
      page = await browserService.getPrimaryPage();
    }
    times.pageTime = Date.now() - startTime;
    times.pageLoadTime = Date.now() - times.pageTime - times.proxyTime - startTime;

    let scrapeResponse: Record<string, any> = { content: {} };

    if (delay) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const [{ html, metadata, links }, base64Screenshot, pdfBuffer] = await Promise.all([
      page.evaluate(() => {
        const getMetaContent = (name: string) => {
          const element = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
          return element ? element.getAttribute("content") : null;
        };

        return {
          html: document.documentElement.outerHTML,
          links: [...document.links].map((l) => ({ url: l.href, text: l.textContent })),
          metadata: {
            title: document.title,
            ogImage: getMetaContent("og:image") || undefined,
            ogTitle: getMetaContent("og:title") || undefined,
            urlSource: window.location.href,
            description: getMetaContent("description") || undefined,
            ogDescription: getMetaContent("og:description") || undefined,
            statusCode: 200, // This will always be 200 if the page loaded successfully
            language: document.documentElement.lang,
            timestamp: new Date().toISOString(),
            published_timestamp: getMetaContent("article:published_time") || undefined,
          },
        };
      }),
      screenshot ? page.screenshot({ encoding: "base64", type: "jpeg", quality: 100 }) : null,
      pdf ? page.pdf() : null,
    ]);

    times.extractionTime = Date.now() - startTime - times.pageLoadTime;

    scrapeResponse.metadata = metadata;
    scrapeResponse.links = links;

    if (format && format.length > 0) {
      if (format.includes(ScrapeFormat.HTML)) {
        scrapeResponse.content.html = html;
      }
      if (format.includes(ScrapeFormat.READABILITY)) {
        scrapeResponse.content.readability = getReadabilityContent(html);
        times.readabilityTime = Date.now() - startTime - times.extractionTime;
      }
      if (format.includes(ScrapeFormat.CLEANED_HTML)) {
        scrapeResponse.content.cleaned_html = cleanHtml(html);
        times.cleanedHtmlTime = (Date.now() - times.readabilityTime || Date.now() - times.extractionTime) - startTime;
      }
      if (format.includes(ScrapeFormat.MARKDOWN)) {
        const readabilityContent = scrapeResponse.content.readability ?? getReadabilityContent(html);
        scrapeResponse.content.markdown = getMarkdown(readabilityContent ? readabilityContent?.content : html);
        times.markdownTime =
          (Date.now() - times.cleanedHtmlTime ||
            Date.now() - times.readabilityTime ||
            Date.now() - times.extractionTime) - startTime;
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
    if (logUrl) {
      await updateLog(logUrl, { times });
    }

    times.totalInstanceTime = Date.now() - startTime;

    return reply.send(scrapeResponse);
  } catch (e: unknown) {
    const error = getErrors(e);
    if (logUrl) {
      await updateLog(logUrl, { times, response: { browserError: error } });
    }
    return reply.code(500).send({ message: error });
  }
};

export const handleCurrentPageScreenshot = async (
  sessionService: SessionService,
  browserService: CDPService,
  request: CurrentPageScreenshotRequest,
  reply: FastifyReply,
) => {
  const startTime = Date.now();
  let times: Record<string, number> = {};
  const { logUrl, delay, fullPage } = request.body;
  try {
    const proxy = sessionService.activeSession.proxyServer;

    times.proxyTime = Date.now() - startTime;

    let page: Page;

    if (!browserService.isRunning()) {
      await browserService.launch();
    }

    if (proxy) {
      page = await browserService.getPrimaryPage();
      times.proxyPageTime = Date.now() - startTime - times.proxyTime;
    } else {
      page = await browserService.getPrimaryPage();
    }
    times.pageTime = Date.now() - startTime;
    times.pageLoadTime = Date.now() - times.pageTime - times.proxyTime - startTime;

    if (delay) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    const screenshot = await page.screenshot({ fullPage, type: "jpeg", quality: 100 });
    times.screenshotTime = Date.now() - times.pageLoadTime - times.pageTime - times.proxyTime - startTime;
    if (logUrl) {
      await updateLog(logUrl, { times });
    }
    return reply.send(screenshot);
  } catch (e: unknown) {
    const error = getErrors(e);
    if (logUrl) {
      await updateLog(logUrl, { times, response: { browserError: error } });
    }
    return reply.code(500).send({ message: error });
  }
};

export const handleCurrentPagePDF = async (
  sessionService: SessionService,
  browserService: CDPService,
  request: CurrentPagePDFRequest,
  reply: FastifyReply,
) => {
  const startTime = Date.now();
  let times: Record<string, number> = {};
  const { logUrl, delay } = request.body;
  try {
    const proxy = sessionService.activeSession.proxyServer;

    times.proxyTime = Date.now() - startTime;

    let page: Page;

    if (!browserService.isRunning()) {
      await browserService.launch();
    }

    if (proxy) {
      page = await browserService.getPrimaryPage();
      times.proxyPageTime = Date.now() - startTime - times.proxyTime;
    } else {
      page = await browserService.getPrimaryPage();
    }
    times.pageTime = Date.now() - startTime;
    times.pageLoadTime = Date.now() - times.pageTime - times.proxyTime - startTime;

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
    return reply.code(500).send({ message: error });
  }
};
