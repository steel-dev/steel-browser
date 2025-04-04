import { Page } from "puppeteer-core";
import { ZodError } from "zod";
import { CorruptedSessionDataError, SessionData, SessionDataSchema, StorageProviderName } from "./types";
import { CookieStorageProvider } from "./providers/cookie";
import { LocalStorageProvider } from "./providers/localStorage";
import { SessionStorageProvider } from "./providers/sessionStorage";
import { IndexedDBStorageProvider } from "./providers/indexedDB";

export interface SessionManagerOptions {
  /**
   * List of storage providers to enable.
   * If none is provided, all the storage providers will be enabled.
   */
  storageProviders?: StorageProviderName[];

  /**
   * Whether to enable debug mode for verbose logging
   */
  debugMode?: boolean;
}

// Initialize the storage provider map
const createStorageProviders = (debugMode: boolean = false) => ({
  [StorageProviderName.Cookies]: new CookieStorageProvider(),
  [StorageProviderName.LocalStorage]: new LocalStorageProvider(),
  [StorageProviderName.SessionStorage]: new SessionStorageProvider(),
  [StorageProviderName.IndexedDB]: new IndexedDBStorageProvider({ debugMode }),
});

// Default options for the session manager
export const defaultSessionManagerOptions: SessionManagerOptions = {
  storageProviders: Object.values(StorageProviderName),
  debugMode: false,
};

export class SessionManager {
  protected readonly page: Page;
  private readonly storageProviders: Record<string, any>;
  private readonly debugMode: boolean;

  constructor(page: Page, options: { debugMode?: boolean } = {}) {
    this.page = page;
    this.debugMode = options.debugMode || false;
    this.storageProviders = createStorageProviders(this.debugMode);

    if (this.debugMode) {
      console.log(`[SessionManager] Initialized for page ${page.url()}`);
    }
  }

  /**
   * Dump all session data from the current page
   */
  public async dump(options: SessionManagerOptions = defaultSessionManagerOptions): Promise<SessionData> {
    const providers = options.storageProviders || defaultSessionManagerOptions.storageProviders!;
    const data: SessionData = {};

    for (const providerName of providers) {
      try {
        if (this.debugMode) {
          console.log(`[SessionManager] Dumping ${providerName} data`);
        }

        data[providerName] = await this.storageProviders[providerName].get(this.page);

        if (this.debugMode) {
          console.log(`[SessionManager] Successfully dumped ${providerName} data`);
        }
      } catch (error) {
        console.error(`[SessionManager] Error dumping ${providerName}:`, error);
      }
    }

    return data;
  }

  /**
   * Restore session data to the current page
   */
  public async restore(
    sessionData: SessionData,
    options: SessionManagerOptions = defaultSessionManagerOptions,
  ): Promise<void> {
    let data: SessionData;
    try {
      data = SessionDataSchema.parse(sessionData);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new CorruptedSessionDataError(err);
      }
      throw err;
    }

    const providers = options.storageProviders || defaultSessionManagerOptions.storageProviders!;

    await Promise.all(
      providers.map(async (providerName) => {
        const providerData = data[providerName];
        if (providerData) {
          try {
            if (this.debugMode) {
              console.log(`[SessionManager] Restoring ${providerName} data`);
            }

            await this.storageProviders[providerName].set(this.page, providerData);

            if (this.debugMode) {
              console.log(`[SessionManager] Successfully restored ${providerName} data`);
            }
          } catch (error) {
            console.error(`[SessionManager] Error restoring ${providerName}:`, error);
          }
        }
      }),
    );
  }

  /**
   * Helper function to serialize the output of dump into JSON format.
   */
  public async dumpString(options: SessionManagerOptions = defaultSessionManagerOptions): Promise<string> {
    return JSON.stringify(await this.dump(options));
  }

  /**
   * Helper function to parse a JSON string into a SessionData object and feed it to `restore`
   */
  public async restoreString(
    sessionData: string,
    options: SessionManagerOptions = defaultSessionManagerOptions,
  ): Promise<void> {
    await this.restore(JSON.parse(sessionData), options);
  }

  /**
   * Helper to convert from the old sessionContext format to the new SessionData format
   */
  public static convertFromSessionContext(sessionContext?: {
    cookies?: any[];
    localStorage?: Record<string, Record<string, string>>;
  }): SessionData {
    if (!sessionContext) return {};

    const data: SessionData = {};

    if (sessionContext.cookies && sessionContext.cookies.length > 0) {
      data[StorageProviderName.Cookies] = JSON.stringify(sessionContext.cookies);
    }

    if (sessionContext.localStorage && Object.keys(sessionContext.localStorage).length > 0) {
      data[StorageProviderName.LocalStorage] = JSON.stringify(sessionContext.localStorage);
    }

    return data;
  }

  /**
   * Helper to convert from the new SessionData format to the old sessionContext format
   */
  public static convertToSessionContext(sessionData: SessionData): {
    cookies?: any[];
    localStorage?: Record<string, Record<string, string>>;
  } {
    const result: {
      cookies?: any[];
      localStorage?: Record<string, Record<string, string>>;
    } = {};

    if (sessionData[StorageProviderName.Cookies]) {
      try {
        result.cookies = JSON.parse(sessionData[StorageProviderName.Cookies]);
      } catch (error) {
        console.error("[SessionManager] Error parsing cookies from SessionData:", error);
      }
    }

    if (sessionData[StorageProviderName.LocalStorage]) {
      try {
        result.localStorage = JSON.parse(sessionData[StorageProviderName.LocalStorage]);
      } catch (error) {
        console.error("[SessionManager] Error parsing localStorage from SessionData:", error);
      }
    }

    return result;
  }
}
