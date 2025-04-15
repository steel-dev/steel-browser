import { Page, Protocol } from "puppeteer-core";
import { z } from "zod";
import { FastifyBaseLogger } from "fastify";

export enum StorageProviderName {
  Cookies = "cookies",
  LocalStorage = "localStorage",
  SessionStorage = "sessionStorage",
  IndexedDB = "indexedDB",
}

export type LocalStorageData = Record<string, string>;
export type SessionStorageData = Record<string, string>;
export type CookieData = z.infer<typeof CDPCookieSchema>;

export const IndexedDBSchema = z.string();
export const IndexedDBDatabaseSchema = z.object({
  name: z.string(),
  data: z.any(), // Using any here to accommodate different structures
  securityOrigin: z.string(),
});
export type IndexedDBDatabase = z.infer<typeof IndexedDBDatabaseSchema>;
export type IndexedDBData = IndexedDBDatabase[];

export interface StorageProviderDataMap {
  [StorageProviderName.LocalStorage]: LocalStorageData;
  [StorageProviderName.SessionStorage]: SessionStorageData;
  [StorageProviderName.Cookies]: CookieData[];
  [StorageProviderName.IndexedDB]: IndexedDBData;
}

// Utility type to get the data type for a specific provider
export type ProviderDataType<T extends StorageProviderName> = StorageProviderDataMap[T];

// Storage Provider base abstract class with generics
export abstract class StorageProvider<T extends StorageProviderName> {
  public abstract name: T;
  protected logger?: FastifyBaseLogger;
  protected debugMode: boolean = false;

  // Get data from current page
  public abstract getCurrentData(page: Page): Promise<ProviderDataType<T>>;

  // Inject data to page from storage provider
  public abstract inject(page: Page): Promise<void>;

  // Set all data to storage provider
  public abstract setAll(data: ProviderDataType<T> | Record<string, ProviderDataType<T>>): void;

  // Get all tracked data
  public abstract getAllData(): Record<string, ProviderDataType<T>> | ProviderDataType<T>;

  // Set logger and debug mode
  public setLogger(logger?: FastifyBaseLogger, debugMode: boolean = false): void {
    this.logger = logger;
    this.debugMode = debugMode;
  }

  // Helper method for consistent logging
  protected log(message: string, isError: boolean = false, level: "debug" | "info" | "warn" | "error" = "info"): void {
    if (level === "debug" && !this.debugMode) {
      return;
    }

    const prefix = `[${this.name}Provider]`;
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
}

export type SessionData = {
  [StorageProviderName.Cookies]?: CookieData[];
  [StorageProviderName.LocalStorage]?: Record<string, LocalStorageData>;
  [StorageProviderName.SessionStorage]?: Record<string, SessionStorageData>;
  [StorageProviderName.IndexedDB]?: Record<string, IndexedDBData>;
};

// Error classes
export class CorruptedSessionDataError extends Error {
  constructor(zodError: z.ZodError) {
    super(`Session data is corrupted: ${zodError.message}`);
    this.name = "CorruptedSessionDataError";
  }
}

// CDP related schemas
export const CDPSameSite = z.enum(["Strict", "Lax", "None"]);
export const CDPCookiePriority = z.enum(["Low", "Medium", "High"]);
export const CDPSourceScheme = z.enum(["Unset", "NonSecure", "Secure"]);

/**
 * CDP Network.Cookie schema
 * @see https://chromedevtools.github.io/devtools-protocol/tot/Network/#type-Cookie
 */
export const CDPCookieSchema = z.object({
  name: z.string().describe("The name of the cookie"),
  value: z.string().describe("The value of the cookie"),
  domain: z.string().describe("The domain of the cookie"),
  path: z.string().describe("The path of the cookie"),
  expires: z.number().describe("The expiration date of the cookie"),
  size: z.number().optional().describe("The size of the cookie"),
  httpOnly: z.boolean().describe("Whether the cookie is HTTP only"),
  secure: z.boolean().describe("Whether the cookie is secure"),
  partitionKey: z.string().optional().describe("The partition key of the cookie"),
  session: z.boolean().optional().describe("Whether the cookie is a session cookie"),
  sameSite: CDPSameSite.optional().describe("The same site attribute of the cookie"),
  priority: CDPCookiePriority.optional().describe("The priority of the cookie"),
  sameParty: z.boolean().optional().describe("Whether the cookie is a same party cookie"),
  sourceScheme: CDPSourceScheme.optional().describe("The source scheme of the cookie"),
  sourcePort: z.number().optional().describe("The source port of the cookie"),
});
export type CDPCookie = z.infer<typeof CDPCookieSchema>;

/**
 * CDP IndexedDB DatabaseNames response
 */
export const CDPIndexedDBDatabaseNames = z.object({
  databaseNames: z.array(z.string()).describe("The names of the indexedDB databases"),
});

export const SessionDataSchema = z.object({
  [StorageProviderName.Cookies]: z.array(CDPCookieSchema).optional(),
  [StorageProviderName.LocalStorage]: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  [StorageProviderName.SessionStorage]: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  [StorageProviderName.IndexedDB]: z.record(z.string(), z.array(IndexedDBDatabaseSchema)).optional(),
});
