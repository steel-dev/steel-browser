import { EventEmitter } from "events";
import { FastifyBaseLogger } from "fastify";
import path from "path";
import { SessionData } from "./types.js";
import { ChromeLocalStorageReader } from "../leveldb/localstorage.js";
import { ChromeSessionStorageReader } from "../leveldb/sessionstorage.js";

export class ChromeContextService extends EventEmitter {
  private logger: FastifyBaseLogger;

  constructor(logger: FastifyBaseLogger) {
    super();
    this.logger = logger;
  }

  /**
   * Get all session data from a Chrome user data directory
   * @param userDataDir Path to Chrome user data directory
   * @returns SessionData containing cookies, localStorage, sessionStorage, and more
   */
  public async getSessionData(userDataDir?: string): Promise<SessionData> {
    if (!userDataDir) {
      this.logger.warn("No userDataDir specified, returning empty session data");
      return {
        localStorage: {},
        sessionStorage: {},
        indexedDB: {},
        cookies: [],
      };
    }

    this.logger.info(`Extracting session data from Chrome user data directory: ${userDataDir}`);

    try {
      const sessionData: SessionData = {};

      const localStorage = await this.extractLocalStorage(userDataDir);
      if (localStorage && Object.keys(localStorage).length > 0) {
        sessionData.localStorage = localStorage;
      }

      const sessionStorage = await this.extractSessionStorage(userDataDir);
      if (sessionStorage && Object.keys(sessionStorage).length > 0) {
        sessionData.sessionStorage = sessionStorage;
      }

      return sessionData;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error extracting session data: ${errorMessage}`);
      throw new Error(`Failed to extract session data: ${errorMessage}`);
    }
  }

  /**
   * Helper to get Chrome profile paths in a cross-platform way
   * Takes into account different Chrome profile directory structures
   */
  private getProfilePath(userDataDir: string, ...pathSegments: string[]): string {
    // Chrome profile directories vary by platform and version
    // Both "Default" and "Profile 1" are standard locations
    const possibleProfileDirs = ["Default", "Profile 1"];

    // First check if the userDataDir already includes a profile directory
    const dirName = path.basename(userDataDir);
    if (possibleProfileDirs.includes(dirName)) {
      // userDataDir already points to a profile directory
      return path.join(userDataDir, ...pathSegments);
    }

    const defaultPath = path.join(userDataDir, "Default", ...pathSegments);

    return defaultPath;
  }

  /**
   * Extract localStorage from Chrome's LevelDB database
   */
  private async extractLocalStorage(userDataDir: string): Promise<Record<string, Record<string, string>>> {
    const localStoragePath = this.getProfilePath(userDataDir, "Local Storage", "leveldb");
    this.logger.info(`Extracting localStorage from ${localStoragePath}`);

    try {
      this.logger.info(`Reading localStorage from ${localStoragePath}`);
      return await ChromeLocalStorageReader.readLocalStorage(localStoragePath);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error extracting localStorage: ${errorMessage}`);
      return {};
    }
  }

  /**
   * Extract sessionStorage from Chrome's Session Storage
   */
  private async extractSessionStorage(userDataDir: string): Promise<Record<string, Record<string, string>>> {
    // Normalize path for cross-platform compatibility
    const sessionStoragePath = this.getProfilePath(userDataDir, "Session Storage");

    try {
      this.logger.info(`Reading sessionStorage from ${sessionStoragePath}`);
      const sessionStorage = await ChromeSessionStorageReader.readSessionStorage(sessionStoragePath);
      return sessionStorage;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error extracting sessionStorage: ${errorMessage}`);
      return {};
    }
  }
}
