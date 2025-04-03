import { Browser, Page } from "puppeteer-core";
import { BasePlugin, PluginOptions } from "../core/base-plugin";
import { SessionManager, SessionManagerOptions } from "./session-manager";
import { SessionData } from "./types";
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
      this.log("Browser launched, initializing session management");
    }
  }

  /**
   * Called when a new page is created
   * Attaches session manager to the page and restores session if enabled
   */
  public async onPageCreated(page: Page): Promise<void> {
    try {
      // Extend the page with a session manager
      const sessionManager = new SessionManager(page, { debugMode: this.debugMode });

      // Attach the session manager to the page
      page.session = sessionManager;

      if (this.debugMode) {
        this.log(`Page created (${this.getTargetId(page)}), session manager attached`);
      }

      // Auto-restore session if enabled and we have session data for this page
      if (this.autoRestoreSession) {
        const targetId = this.getTargetId(page);
        const sessionData = this.sessionData.get(targetId);

        if (sessionData) {
          if (this.debugMode) {
            this.log(`Auto-restoring session for page ${targetId}`);
          }

          try {
            await sessionManager.restore(sessionData, this.sessionManagerOptions);
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
   * Called before a page closes
   * Dumps session data if enabled
   */
  public async onBeforePageClose(page: Page): Promise<void> {
    try {
      // Auto-dump session if enabled
      if (this.autoDumpSession) {
        const targetId = this.getTargetId(page);

        if (this.debugMode) {
          this.log(`Auto-dumping session for page ${targetId}`);
        }

        const sessionManager = page.session;
        if (sessionManager) {
          const sessionData = await sessionManager.dump(this.sessionManagerOptions);
          this.sessionData.set(targetId, sessionData);

          if (this.debugMode) {
            this.log(`Session dumped for page ${targetId}`);
          }
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
    if (this.debugMode) {
      this.log("Browser closing, saving final session state");
    }

    try {
      // Attempt to save session data from all pages
      const pages = await browser.pages();

      for (const page of pages) {
        try {
          const targetId = this.getTargetId(page);
          const sessionManager = page.session;

          if (sessionManager) {
            const sessionData = await sessionManager.dump(this.sessionManagerOptions);
            this.sessionData.set(targetId, sessionData);

            if (this.debugMode) {
              this.log(`Final session saved for page ${targetId}`);
            }
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
    if (this.debugMode) {
      this.log("CDPService shutting down, cleaning up session plugin");
    }

    // Clear session data
    this.sessionData.clear();
  }

  /**
   * Set session data that will be auto-restored for new pages
   */
  public setSessionData(targetId: string, sessionData: SessionData): void {
    this.sessionData.set(targetId, sessionData);

    if (this.debugMode) {
      this.log(`Session data set for target ${targetId}`);
    }
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
  private log(message: string, isError = false): void {
    const prefix = "[SessionPlugin]";

    if (this.logger) {
      isError ? this.logger.error(`${prefix} ${message}`) : this.logger.info(`${prefix} ${message}`);
    } else {
      isError ? console.error(`${prefix} ${message}`) : console.log(`${prefix} ${message}`);
    }
  }
}
