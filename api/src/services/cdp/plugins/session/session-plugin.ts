import { Browser, Page } from "puppeteer-core";
import { BasePlugin, PluginOptions } from "../core/base-plugin";
import { SessionManager, SessionManagerOptions } from "./session-manager";
import { SessionData, StorageProviderName } from "./types";
import { FastifyBaseLogger } from "fastify";

export interface SessionPluginOptions extends PluginOptions {
  /**
   * Session manager options
   */
  sessionManagerOptions?: SessionManagerOptions;

  /**
   * Whether to automatically handle session data during page creation
   */
  autoRestoreSession?: boolean;

  /**
   * Whether to automatically dump session data when pages close
   */
  autoDumpSession?: boolean;

  /**
   * Logger for output
   */
  logger?: FastifyBaseLogger;

  /**
   * Debug mode for verbose logging
   */
  debugMode?: boolean;
}

/**
 * Interface to extend Page object with session manager
 */
export interface SessionPluginPageAdditions {
  session: SessionManager;
}

/**
 * A plugin that adds session management capabilities to pages
 *
 * This plugin hooks into the CDPService lifecycle to automatically
 * manage browser session state including cookies, localStorage,
 * sessionStorage, and IndexedDB.
 */
export class SessionPlugin extends BasePlugin {
  private sessionManagerOptions: SessionManagerOptions;
  private autoRestoreSession: boolean;
  private autoDumpSession: boolean;
  private sessionData: Map<string, SessionData>;
  private logger?: FastifyBaseLogger;
  private debugMode: boolean;

  constructor(options: Omit<SessionPluginOptions, "name"> & { name?: string } = {}) {
    super({
      name: "session-plugin",
      ...options,
    });

    this.sessionManagerOptions = options.sessionManagerOptions || {};
    this.autoRestoreSession = options.autoRestoreSession || false;
    this.autoDumpSession = options.autoDumpSession || false;
    this.sessionData = new Map();
    this.logger = options.logger;
    this.debugMode = options.debugMode || false;
  }

  /**
   * Called when browser is launched
   */
  public async onBrowserLaunch(browser: Browser): Promise<void> {
    if (this.debugMode) {
      this.log("Browser launched, initializing session management", false, "debug");
    }
  }

  /**
   * Called when a new page is created
   * Attaches session manager to the page and restores session if enabled
   */
  public async onPageCreated(page: Page): Promise<void> {
    try {
      // Extend the page with a session manager
      const sessionManager = new SessionManager(page, {
        debugMode: this.debugMode,
        logger: this.logger,
      });

      // Attach the session manager to the page
      page.session = sessionManager;

      if (this.debugMode) {
        this.log(`Page created (${this.getTargetId(page)}), session manager attached`, false, "debug");
      }

      // Auto-restore session if enabled and we have session data for this page
      if (this.autoRestoreSession) {
        const targetId = this.getTargetId(page);
        const sessionData = this.sessionData.get(targetId);

        if (sessionData) {
          this.log(`Auto-restoring session for page ${targetId}`, false, "debug");

          try {
            await sessionManager.restore(sessionData, this.sessionManagerOptions);
            await sessionManager.inject(this.sessionManagerOptions);
            this.log(`Session restored for page ${targetId}`);
          } catch (error) {
            this.log(`Error auto-restoring session: ${error}`, true);
          }
        }
      }
    } catch (error) {
      this.log(`Error in onPageCreated: ${error}`, true);
    }
  }

  /**
   * Called when a page is unloading
   * This is the key method to capture data before the page unloads
   */
  public async onPageUnload(page: Page): Promise<void> {
    try {
      const targetId = this.getTargetId(page);

      this.log(`Page unloading (${targetId}), capturing data`, false, "debug");

      const sessionManager = page.session;
      if (sessionManager) {
        // Dump current page data
        const pageData = await sessionManager.dump(this.sessionManagerOptions);

        // Get any existing data for this target
        const existingData = this.sessionData.get(targetId) || {};

        // Merge the data (ensure we keep data from other domains)
        const mergedData = this.mergeSessionData(existingData, pageData);

        // Store the combined data
        this.sessionData.set(targetId, mergedData);

        this.log(`Session data captured for page ${targetId}`, false, "debug");
      }
    } catch (error) {
      this.log(`Error in onPageUnload: ${error}`, true);
    }
  }

  /**
   * Called before a page closes
   * If autoDumpSession is enabled, we'll use the tracked data
   * which includes data collected during page unloads
   */
  public async onBeforePageClose(page: Page): Promise<void> {
    try {
      // Auto-dump session if enabled
      if (this.autoDumpSession) {
        const targetId = this.getTargetId(page);

        this.log(`Auto-dumping session for page ${targetId}`, false, "debug");

        const sessionManager = page.session;
        if (sessionManager) {
          // Get current data from the page
          const pageData = await sessionManager.dump();

          // Get tracked data that includes all domain data
          const trackedData = await sessionManager.getTrackedData();

          // Merge the data to get the most complete dataset
          const mergedData = this.mergeSessionData(trackedData, pageData);

          this.sessionData.set(targetId, mergedData);

          this.log(`Session dumped for page ${targetId}`, false, "info");
        }
      }
    } catch (error) {
      this.log(`Error in onBeforePageClose: ${error}`, true);
    }
  }

  /**
   * Called before browser is closed
   */
  public async onBrowserClose(browser: Browser): Promise<void> {
    this.log("Browser closing, saving final session state", false, "debug");

    try {
      // Attempt to save session data from all pages
      const pages = await browser.pages();

      for (const page of pages) {
        try {
          const targetId = this.getTargetId(page);
          const sessionManager = page.session;

          if (sessionManager) {
            // Get current data from the page
            const pageData = await sessionManager.dump();

            // Get tracked data that includes all domain data
            const trackedData = await sessionManager.getTrackedData();

            // Merge the data to get the most complete dataset
            const mergedData = this.mergeSessionData(trackedData, pageData);

            this.sessionData.set(targetId, mergedData);

            this.log(`Final session saved for page ${targetId}`, false, "debug");
          }
        } catch (error) {
          // Ignore errors for individual pages
        }
      }
    } catch (error) {
      this.log(`Error in onBrowserClose: ${error}`, true);
    }
  }

  /**
   * Called when CDPService is shutting down
   */
  public async onShutdown(): Promise<void> {
    this.log("CDPService shutting down, cleaning up session plugin", false, "debug");

    // Clear session data
    this.sessionData.clear();
  }

  /**
   * Set session data that will be auto-restored for new pages
   */
  public setSessionData(targetId: string, sessionData: SessionData): void {
    this.sessionData.set(targetId, sessionData);

    this.log(`Session data set for target ${targetId}`, false, "debug");
  }

  /**
   * Get session data that was previously dumped
   */
  public getSessionData(targetId: string): SessionData | undefined {
    return this.sessionData.get(targetId);
  }

  /**
   * Helper to get the target ID for a page
   */
  private getTargetId(page: Page): string {
    // @ts-ignore - targetId is not in the public API but it's available
    return page.target()._targetId;
  }

  /**
   * Helper for consistent logging
   */
  private log(message: string, isError = false, level: "debug" | "info" | "warn" | "error" = "info"): void {
    // Skip debug logs completely when debugMode is false
    if (level === "debug" && !this.debugMode) {
      return;
    }

    const prefix = "[SessionPlugin]";
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
   * Helper to merge session data from multiple sources
   * This ensures we keep data from different domains rather than overwriting
   */
  private mergeSessionData(existingData: SessionData, newData: SessionData): SessionData {
    const result = { ...existingData } as any;

    // For each storage provider in the new data
    for (const providerName of Object.keys(newData) as StorageProviderName[]) {
      try {
        // Skip if no new data
        if (!newData[providerName as StorageProviderName]) {
          continue;
        }

        // If there's no existing data for this provider, just use the new data
        if (!result[providerName as StorageProviderName]) {
          result[providerName as StorageProviderName] = newData[providerName as StorageProviderName];
          continue;
        }

        // Handle each provider type differently based on its expected structure
        switch (providerName) {
          case StorageProviderName.Cookies: {
            // Merge arrays with cookie-specific deduplication
            const existingCookies = result[StorageProviderName.Cookies] || [];
            const newCookies = newData[StorageProviderName.Cookies] || [];

            const combinedCookies = [...existingCookies, ...newCookies];
            const seen = new Set();
            result[StorageProviderName.Cookies] = combinedCookies.filter((cookie) => {
              if (!cookie.name || !cookie.domain || !cookie.path) return true;
              const key = `${cookie.name}|${cookie.domain}|${cookie.path}`;
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
            break;
          }

          case StorageProviderName.IndexedDB: {
            // Merge objects indexed by origin with arrays of databases
            const existingOrigins = result[StorageProviderName.IndexedDB] || {};
            const newOrigins = newData[StorageProviderName.IndexedDB] || {};

            const mergedOrigins = { ...existingOrigins };

            // Merge by origin
            for (const [origin, databases] of Object.entries(newOrigins)) {
              if (mergedOrigins[origin]) {
                // Add/update databases by name
                const existingDbMap = new Map(mergedOrigins[origin].map((db) => [db.name, db]));

                for (const db of databases) {
                  existingDbMap.set(db.name, db);
                }

                mergedOrigins[origin] = Array.from(existingDbMap.values());
              } else {
                mergedOrigins[origin] = databases;
              }
            }

            result[StorageProviderName.IndexedDB] = mergedOrigins;
            break;
          }

          case StorageProviderName.LocalStorage:
          case StorageProviderName.SessionStorage: {
            // Handle storage objects indexed by domain
            const storageKey = providerName as StorageProviderName.LocalStorage | StorageProviderName.SessionStorage;
            const existingDomains = result[storageKey] || {};
            const newDomains = newData[storageKey] || {};

            const mergedDomains = { ...existingDomains };

            // Merge by domain
            for (const [domain, items] of Object.entries(newDomains)) {
              mergedDomains[domain] = {
                ...(mergedDomains[domain] || {}),
                ...items,
              };
            }

            result[storageKey] = mergedDomains;
            break;
          }

          default:
            // For any other provider, use the new data
            result[providerName as StorageProviderName] = newData[providerName as StorageProviderName];
        }
      } catch (error) {
        // Log error but don't fail
        this.log(`Error merging data for ${providerName}: ${error}`, true);
      }
    }

    return result as SessionData;
  }

  /**
   * Called when a page navigates to a new URL
   * Applies stored session data for the new origin
   */
  public async onPageNavigate(page: Page): Promise<void> {
    try {
      const url = page.url();
      if (url === "about:blank") {
        return;
      }

      const targetId = this.getTargetId(page);
      this.log(`Page navigated (${targetId}) to ${url}, applying stored session data`, false, "debug");

      const sessionManager = page.session;
      if (sessionManager) {
        this.log(`Applying session data for ${url}`, false, "debug");
        await sessionManager.inject(this.sessionManagerOptions);
      }
    } catch (error) {
      this.log(`Error in onPageNavigate: ${error}`, true);
    }
  }
}
