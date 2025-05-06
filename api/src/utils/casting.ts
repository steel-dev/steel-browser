import { Page } from "puppeteer-core";
import { NavigationEvent } from "../types/casting.js";

export const navigatePage = async (event: NavigationEvent["event"], targetPage: Page): Promise<void> => {
  if (event.action === "back") {
    await targetPage.goBack();
  } else if (event.action === "forward") {
    await targetPage.goForward();
  } else if (event.action === "refresh") {
    await targetPage.reload();
  } else if (event.url) {
    const formattedUrl = event.url.startsWith("http") ? event.url : `https://${event.url}`;

    await targetPage.goto(formattedUrl);
  }
};

export const getPageTitle = async (page: Page): Promise<string> => {
  try {
    return await page.title();
  } catch (error) {
    console.error("Error getting page title:", error);
    return "Untitled";
  }
};

export const getPageFavicon = async (page: Page): Promise<string | null> => {
  try {
    return await page.evaluate(() => {
      const iconLink = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
      if (iconLink) {
        const href = iconLink.getAttribute("href");
        if (href?.startsWith("http")) return href;
        if (href?.startsWith("//")) return window.location.protocol + href;
        if (href?.startsWith("/")) return window.location.origin + href;
        return window.location.origin + "/" + href;
      }
      return null;
    });
  } catch (error) {
    console.error("Error getting page favicon:", error);
    return null;
  }
};
