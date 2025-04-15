import { Page } from "puppeteer-core";
import { CookieData, StorageProvider, StorageProviderName } from "../types";
import { FastifyBaseLogger } from "fastify";

export class CookieStorageProvider extends StorageProvider<StorageProviderName.Cookies> {
  public name: StorageProviderName.Cookies = StorageProviderName.Cookies;
  private cookies: CookieData[] = [];

  constructor(options: { debugMode?: boolean; logger?: FastifyBaseLogger } = {}) {
    super();
    this.debugMode = options.debugMode || false;
    this.logger = options.logger;
  }

  public async getCurrentData(page: Page): Promise<CookieData[]> {
    try {
      const client = await page.target().createCDPSession();
      try {
        this.log("Fetching cookies via CDP", false, "debug");
        const { cookies } = await client.send("Network.getAllCookies");
        this.cookies = cookies as CookieData[];
        this.log(`Retrieved ${cookies.length} cookies`, false, "debug");
        return cookies as CookieData[];
      } finally {
        await client.detach();
      }
    } catch (error) {
      this.log(`Error getting cookies: ${error}`, true);
      return [];
    }
  }

  public async inject(page: Page): Promise<void> {
    try {
      if (this.cookies.length > 0) {
        this.log(`Setting ${this.cookies.length} cookies`, false, "debug");
      }

      let validCookiesCount = 0;
      for (const cookie of this.cookies) {
        if (!cookie.name || !cookie.value || !cookie.domain) {
          this.log(`Skipping invalid cookie (missing required fields): ${JSON.stringify(cookie)}`, false, "warn");
          continue;
        }

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
        validCookiesCount++;
      }

      this.log(`Successfully set ${validCookiesCount} cookies`, false, "debug");
    } catch (error) {
      this.log(`Error setting cookies: ${error}`, true);
      throw error;
    }
  }

  public setAll(data: CookieData[]): void {
    this.cookies = data;
  }

  public getAllData(): CookieData[] {
    this.log(`Returning ${this.cookies.length} cookies`, false, "debug");
    return this.cookies;
  }
}
