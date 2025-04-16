import { Page } from "puppeteer-core";
import { SessionStorageData, StorageProvider, StorageProviderName } from "../types";
import { FastifyBaseLogger } from "fastify";

export class SessionStorageProvider extends StorageProvider<StorageProviderName.SessionStorage> {
  public name: StorageProviderName.SessionStorage = StorageProviderName.SessionStorage;
  private storageData: Record<string, SessionStorageData> = {};

  constructor(options: { debugMode?: boolean; logger?: FastifyBaseLogger } = {}) {
    super();
    this.debugMode = options.debugMode || false;
    this.logger = options.logger;
  }

  /**
   * Get sessionStorage data from the current page and update our cache
   */
  public async getCurrentData(page: Page): Promise<SessionStorageData> {
    try {
      if (page.url() === "about:blank") {
        return {};
      }

      const hostname = new URL(page.url()).hostname;

      // Get current sessionStorage data from the page
      const currentStorage = await page.evaluate(() => {
        const items: Record<string, string> = {};
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          if (key) {
            items[key] = sessionStorage.getItem(key) || "";
          }
        }
        return items;
      });

      // Update our cached data with the latest values
      this.storageData[hostname] = { ...this.storageData[hostname], ...currentStorage };

      this.log(`Updated storage data for ${hostname}`, false, "debug");

      return this.storageData[hostname] || {};
    } catch (error) {
      this.log(`Error getting sessionStorage: ${error}`, true);
      const hostname = page.url() !== "about:blank" ? new URL(page.url()).hostname : "";
      return hostname ? this.storageData[hostname] || {} : {};
    }
  }

  public async inject(page: Page): Promise<void> {
    try {
      const url = page.url();
      if (url === "about:blank") {
        return;
      }

      const hostname = new URL(url).hostname;
      const storageItems = this.storageData[hostname];

      if (!storageItems) {
        this.log(`No sessionStorage items to restore for ${hostname}`, false, "debug");
        return;
      }

      // Apply to page
      if (Object.keys(storageItems).length > 0) {
        this.log(`Setting ${Object.keys(storageItems).length} sessionStorage items for ${hostname}`, false, "debug");
        await page.evaluate((items: Record<string, string>) => {
          for (const [key, value] of Object.entries(items)) {
            window.sessionStorage.setItem(key, value);
          }
        }, storageItems);
      }
    } catch (error) {
      this.log(`Error setting sessionStorage: ${error}`, true);
      throw error;
    }
  }

  public setAll(data: Record<string, SessionStorageData>): void {
    this.storageData = data;
  }

  /**
   * Get all tracked data regardless of current page
   */
  public getAllData(): Record<string, SessionStorageData> {
    this.log(`Returning data for ${Object.keys(this.storageData).length} domains`, false, "debug");
    return this.storageData;
  }
}
