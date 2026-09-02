import { EventEmitter } from "events";
import { FastifyBaseLogger } from "fastify";
import { getProfilePath } from "../../utils/context.js";
import { ChromeLocalStorageReader } from "../leveldb/localstorage.js";
import { ChromeSessionStorageReader } from "../leveldb/sessionstorage.js";
import { SessionData } from "./types.js";

const CONTEXT_CACHE_TTL_MS = Number(process.env.CONTEXT_CACHE_TTL_MS ?? 1000);

export class ChromeContextService extends EventEmitter {
  private logger: FastifyBaseLogger;
  private cached: { key: string; at: number; data: SessionData } | null = null;
  private inFlight: { key: string; promise: Promise<SessionData> } | null = null;

  constructor(logger: FastifyBaseLogger) {
    super();
    this.logger = logger;
  }

  public invalidate(): void {
    this.cached = null;
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

    const now = Date.now();
    if (
      this.cached &&
      this.cached.key === userDataDir &&
      now - this.cached.at < CONTEXT_CACHE_TTL_MS
    ) {
      return this.cached.data;
    }

    if (this.inFlight && this.inFlight.key === userDataDir) {
      return this.inFlight.promise;
    }

    const promise = this.extractSessionData(userDataDir)
      .then((data) => {
        this.cached = { key: userDataDir, at: Date.now(), data };
        return data;
      })
      .finally(() => {
        if (this.inFlight?.promise === promise) this.inFlight = null;
      });

    this.inFlight = { key: userDataDir, promise };
    return promise;
  }

  private async extractSessionData(userDataDir: string): Promise<SessionData> {
    this.logger.info(`Extracting session data from Chrome user data directory: ${userDataDir}`);

    try {
      const sessionData: SessionData = {};

      const [localStorage, sessionStorage] = await Promise.all([
        this.extractLocalStorage(userDataDir),
        this.extractSessionStorage(userDataDir),
      ]);

      if (localStorage && Object.keys(localStorage).length > 0) {
        sessionData.localStorage = localStorage;
      }

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
   * Extract localStorage from Chrome's LevelDB database
   */
  private async extractLocalStorage(
    userDataDir: string,
  ): Promise<Record<string, Record<string, string>>> {
    const localStoragePath = getProfilePath(userDataDir, "Local Storage", "leveldb");
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
  private async extractSessionStorage(
    userDataDir: string,
  ): Promise<Record<string, Record<string, string>>> {
    // Normalize path for cross-platform compatibility
    const sessionStoragePath = getProfilePath(userDataDir, "Session Storage");

    try {
      this.logger.info(`Reading sessionStorage from ${sessionStoragePath}`);
      const sessionStorage =
        await ChromeSessionStorageReader.readSessionStorage(sessionStoragePath);
      return sessionStorage;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error extracting sessionStorage: ${errorMessage}`);
      return {};
    }
  }
}
