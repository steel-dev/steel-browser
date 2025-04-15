import { Page } from "puppeteer-core";
import { LocalStorageData, StorageProvider, StorageProviderName } from "../types";
import { FastifyBaseLogger } from "fastify";

export class LocalStorageProvider extends StorageProvider<StorageProviderName.LocalStorage> {
  public name: StorageProviderName.LocalStorage = StorageProviderName.LocalStorage;
  private storageData: Record<string, LocalStorageData> = {};

  constructor(options: { debugMode?: boolean; logger?: FastifyBaseLogger } = {}) {
    super();
    this.debugMode = options.debugMode || false;
    this.logger = options.logger;
  }

  /**
   * Get localStorage data from the current page and update our cache
   */
  public async getCurrentData(page: Page): Promise<LocalStorageData> {
    try {
      if (page.url() === "about:blank") {
        return {};
      }

      const hostname = new URL(page.url()).hostname;

      // Get current localStorage data from the page
      const currentStorage = await page.evaluate(() => {
        const items: Record<string, string> = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key) {
            items[key] = localStorage.getItem(key) || "";
          }
        }
        return items;
      });

      // Update our cached data with the latest values
      this.storageData[hostname] = { ...this.storageData[hostname], ...currentStorage };

      this.log(`Updated storage data for ${hostname}`, false, "debug");

      return this.storageData[hostname] || {};
    } catch (error) {
      this.log(`Error getting localStorage: ${error}`, true);
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

      // Apply to page
      if (Object.keys(storageItems).length > 0) {
        this.log(`Setting ${Object.keys(storageItems).length} localStorage items for ${hostname}`, false, "debug");
        await page.evaluate((items: Record<string, string>) => {
          for (const [key, value] of Object.entries(items)) {
            window.localStorage.setItem(key, value);
          }
        }, storageItems);
      }
    } catch (error) {
      this.log(`Error setting localStorage: ${error}`, true);
      throw error;
    }
  }

  public setAll(data: Record<string, LocalStorageData>): void {
    this.storageData = data;
  }

  /**
   * Get all tracked data regardless of current page
   */
  public getAllData(): Record<string, LocalStorageData> {
    this.log(`Returning data for ${Object.keys(this.storageData).length} domains`, false, "debug");
    return this.storageData;
  }
}
