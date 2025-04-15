import { Page } from "puppeteer-core";
import { ZodError } from "zod";
import {
  CookieData,
  CorruptedSessionDataError,
  IndexedDBData,
  LocalStorageData,
  SessionData,
  SessionDataSchema,
  SessionStorageData,
  StorageProviderName,
} from "./types";
import { CookieStorageProvider } from "./providers/cookie";
import { LocalStorageProvider } from "./providers/localStorage";
import { SessionStorageProvider } from "./providers/sessionStorage";
import { IndexedDBStorageProvider } from "./providers/indexedDB";
import { FastifyBaseLogger } from "fastify";

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

  /**
   * Logger for output
   */
  logger?: FastifyBaseLogger;
}

// Initialize the storage provider map
const createStorageProviders = (debugMode: boolean = false, logger?: FastifyBaseLogger) => {
  const providers = {
    [StorageProviderName.Cookies]: new CookieStorageProvider({ debugMode, logger }),
    [StorageProviderName.LocalStorage]: new LocalStorageProvider({ debugMode, logger }),
    [StorageProviderName.SessionStorage]: new SessionStorageProvider({ debugMode, logger }),
    [StorageProviderName.IndexedDB]: new IndexedDBStorageProvider({ debugMode, logger }),
  };

  return providers;
};

// Default options for the session manager
export const defaultSessionManagerOptions: SessionManagerOptions = {
  storageProviders: Object.values(StorageProviderName),
  debugMode: false,
};

export class SessionManager {
  protected readonly page: Page;
  private readonly storageProviders: Record<string, any>;
  private readonly debugMode: boolean;
  private readonly logger?: FastifyBaseLogger;

  constructor(page: Page, options: { debugMode?: boolean; logger?: FastifyBaseLogger } = {}) {
    this.page = page;
    this.debugMode = options.debugMode || false;
    this.logger = options.logger;
    this.storageProviders = createStorageProviders(this.debugMode, this.logger);

    if (this.debugMode) {
      this.log(`Initialized for page ${page.url()}`);
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
          this.log(`Dumping ${providerName} data`);
        }

        const providerData = await this.storageProviders[providerName].getCurrentData(this.page);
        data[providerName] = providerData;

        if (this.debugMode) {
          this.log(`Successfully dumped ${providerName} data`);
        }
      } catch (error) {
        this.log(`Error dumping ${providerName}: ${error}`, true);
      }
    }

    return data;
  }

  /**
   * Get the current accumulated session data without querying the page
   * This returns all the data that has been collected from all pages
   */
  public async getTrackedData(): Promise<SessionData> {
    const data: SessionData = {};

    try {
      for (const providerName of Object.values(StorageProviderName)) {
        const provider = this.storageProviders[providerName];

        // If provider has getAllData method, use it to get tracked data
        if (provider && "getCurrentData" in provider) {
          // First, get current page data to make sure tracking is up to date
          await provider.getCurrentData(this.page);

          // Then get all tracked data
          const providerData = provider.getAllData();

          // Only include non-empty data
          if (
            providerData &&
            typeof providerData === "object" &&
            (Array.isArray(providerData) ? providerData.length > 0 : Object.keys(providerData).length > 0)
          ) {
            data[providerName] = providerData;
          }
        }
      }
    } catch (error) {
      this.log(`Error getting tracked data: ${error}`, true);
    }

    return data;
  }

  /**
   * Restore session data
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
              this.log(`Restoring ${providerName} data`);
            }

            // Pass data directly to the provider
            await this.storageProviders[providerName].setAll(providerData);

            if (this.debugMode) {
              this.log(`Successfully restored ${providerName} data`);
            }
          } catch (error) {
            this.log(`Error restoring ${providerName}: ${error}`, true);
          }
        }
      }),
    );
  }

  /**
   * Inject session data into the current page
   */
  public async inject(options: SessionManagerOptions = defaultSessionManagerOptions): Promise<void> {
    const providers = options.storageProviders || defaultSessionManagerOptions.storageProviders!;

    await Promise.all(
      providers.map(async (providerName) => {
        try {
          if (this.debugMode) {
            this.log(`Injecting ${providerName} data`);
          }

          // Pass data directly to the provider
          await this.storageProviders[providerName].inject(this.page);

          if (this.debugMode) {
            this.log(`Successfully injected ${providerName} data`);
          }
        } catch (error) {
          this.log(`Error injecting ${providerName}: ${error}`, true);
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
    cookies?: CookieData[];
    localStorage?: Record<string, LocalStorageData>;
    sessionStorage?: Record<string, SessionStorageData>;
    indexedDB?: Record<string, IndexedDBData>;
  }): SessionData {
    if (!sessionContext) return {};

    const data: SessionData = {};

    if (sessionContext.cookies && sessionContext.cookies.length > 0) {
      data[StorageProviderName.Cookies] = sessionContext.cookies;
    }

    if (sessionContext.localStorage && Object.keys(sessionContext.localStorage).length > 0) {
      data[StorageProviderName.LocalStorage] = sessionContext.localStorage;
    }

    if (sessionContext.sessionStorage && Object.keys(sessionContext.sessionStorage).length > 0) {
      data[StorageProviderName.SessionStorage] = sessionContext.sessionStorage;
    }

    if (sessionContext.indexedDB && Object.keys(sessionContext.indexedDB).length > 0) {
      data[StorageProviderName.IndexedDB] = sessionContext.indexedDB;
    }

    return data;
  }

  /**
   * Helper to convert from the new SessionData format to the old sessionContext format
   */
  public static convertToSessionContext(sessionData: SessionData): {
    cookies?: CookieData[];
    localStorage?: Record<string, LocalStorageData>;
  } {
    const result: {
      cookies?: CookieData[];
      localStorage?: Record<string, LocalStorageData>;
      sessionStorage?: Record<string, SessionStorageData>;
      indexedDB?: Record<string, IndexedDBData>;
    } = {};

    if (sessionData[StorageProviderName.Cookies]) {
      result.cookies = sessionData[StorageProviderName.Cookies];
    }

    if (sessionData[StorageProviderName.LocalStorage]) {
      result.localStorage = sessionData[StorageProviderName.LocalStorage];
    }

    return result;
  }

  /**
   * Helper for consistent logging
   */
  private log(message: string, isError = false, level: "debug" | "info" | "warn" | "error" = "info"): void {
    // Skip debug logs completely when debugMode is false
    if (level === "debug" && !this.debugMode) {
      return;
    }

    const prefix = "[SessionManager]";
    const fullMessage = `${prefix} ${message}`;

    if (this.logger) {
      if (isError) {
        this.logger.error(fullMessage);
      } else {
        this.logger[level](fullMessage);
      }
    } else {
      if (isError) {
        console.error(fullMessage);
      } else if (level === "warn") {
        console.warn(fullMessage);
      } else {
        console.log(fullMessage);
      }
    }
  }

  /**
   * Static helper for consistent logging in static methods
   */
  private static log(message: string, isError = false): void {
    const prefix = "[SessionManager]";
    isError ? console.error(`${prefix} ${message}`) : console.log(`${prefix} ${message}`);
  }
}
