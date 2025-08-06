import { JSDOM } from "jsdom";

export const transformHtml = (htmlContent: string, baseUrl?: string): string => {
  const dom = new JSDOM(htmlContent);
  const document = dom.window.document;

  optimizeImages(document);

  if (baseUrl) {
    normalizeUrls(document, baseUrl);
  }

  return document.documentElement.outerHTML;
};

const optimizeImages = (document: Document) => {
  const imagesWithSrcset = document.querySelectorAll("img[srcset]");

  imagesWithSrcset.forEach((img) => {
    const element = img as HTMLImageElement;
    const srcsetValue = element.getAttribute("srcset");
    if (!srcsetValue) return;

    const imageSources = srcsetValue.split(",").map((entry) => {
      const parts = entry.trim().split(" ");
      return {
        url: parts[0],
        size: parseInt((parts[1] ?? "1x").slice(0, -1), 10),
        isPixelDensity: (parts[1] ?? "").endsWith("x"),
      };
    });

    const currentSrc = element.getAttribute("src");
    if (imageSources.every((source) => source.isPixelDensity) && currentSrc) {
      imageSources.push({
        url: currentSrc,
        size: 1,
        isPixelDensity: true,
      });
    }

    imageSources.sort((a, b) => b.size - a.size);

    const bestSource = imageSources[0];
    if (bestSource) {
      element.setAttribute("src", bestSource.url);
      element.removeAttribute("srcset");
    }
  });
};

const normalizeUrls = (document: Document, baseUrl: string) => {
  try {
    const urlBase = new URL(baseUrl);

    const processElements = (selector: string, attribute: string) => {
      const elements = document.querySelectorAll(selector);
      elements.forEach((element) => {
        try {
          const currentValue = element.getAttribute(attribute);
          if (currentValue) {
            element.setAttribute(attribute, new URL(currentValue, urlBase).href);
          }
        } catch {}
      });
    };

    processElements("img[src]", "src");
    processElements("a[href]", "href");
    processElements("link[href]", "href");
    processElements("video[src]", "src");
    processElements("audio[src]", "src");
    processElements("source[src]", "src");
  } catch {}
};
