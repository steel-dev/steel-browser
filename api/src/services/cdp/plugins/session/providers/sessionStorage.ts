import { Page } from "puppeteer-core";
import { StorageProvider, StorageProviderName } from "../types";

export class SessionStorageProvider implements StorageProvider {
  public name: StorageProviderName = StorageProviderName.SessionStorage;

  public async get(page: Page): Promise<string> {
    try {
      const storage = await page.evaluate(() => {
        const items: Record<string, string> = {};
        for (let i = 0; i < sessionStorage.length; i++) {
          const key = sessionStorage.key(i);
          if (key) {
            items[key] = sessionStorage.getItem(key) || "";
          }
        }
        return items;
      });

      return JSON.stringify({
        [new URL(page.url()).hostname]: storage,
      });
    } catch (error) {
      console.error("Error getting sessionStorage:", error);
      return "{}";
    }
  }

  public async set(page: Page, data: string): Promise<void> {
    try {
      const storageData = JSON.parse(data) as Record<string, Record<string, string>>;
      const hostname = new URL(page.url()).hostname;
      const storageItems = storageData[hostname] || {};

      if (Object.keys(storageItems).length > 0) {
        await page.evaluate((items: Record<string, string>) => {
          for (const [key, value] of Object.entries(items)) {
            window.sessionStorage.setItem(key, value);
          }
        }, storageItems);
      }
    } catch (error) {
      console.error("Error setting sessionStorage:", error);
      throw error;
    }
  }
}
