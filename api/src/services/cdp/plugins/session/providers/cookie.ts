import { Page } from "puppeteer-core";
import { StorageProvider, StorageProviderName } from "../types";

export class CookieStorageProvider implements StorageProvider {
  public name: StorageProviderName = StorageProviderName.Cookies;

  public async get(page: Page): Promise<string> {
    try {
      const client = await page.target().createCDPSession();
      try {
        const { cookies } = await client.send("Network.getAllCookies");
        return JSON.stringify(cookies);
      } finally {
        await client.detach();
      }
    } catch (error) {
      console.error("Error getting cookies:", error);
      return "[]";
    }
  }

  public async set(page: Page, data: string): Promise<void> {
    try {
      const cookies = JSON.parse(data);
      if (!Array.isArray(cookies)) {
        throw new Error("Cookie data must be an array");
      }

      for (const cookie of cookies) {
        // Skip invalid cookies
        if (!cookie.name || !cookie.value || !cookie.domain) {
          continue;
        }

        // Convert to SetCookie format
        await page.setCookie({
          name: cookie.name,
          value: cookie.value,
          domain: cookie.domain,
          path: cookie.path || "/",
          expires: cookie.expires || undefined,
          httpOnly: cookie.httpOnly || false,
          secure: cookie.secure || false,
          sameSite: cookie.sameSite || undefined,
        });
      }
    } catch (error) {
      console.error("Error setting cookies:", error);
      throw error;
    }
  }
}
