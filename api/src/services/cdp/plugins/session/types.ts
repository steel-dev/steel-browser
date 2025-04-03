import { Page } from "puppeteer-core";
import { z } from "zod";

// StorageProviderName enum
export enum StorageProviderName {
  Cookies = "cookies",
  LocalStorage = "localStorage",
  SessionStorage = "sessionStorage",
  IndexedDB = "indexedDB",
}

// SessionData type
export type SessionData = Partial<Record<StorageProviderName, string>>;

// Storage Provider base abstract class
export abstract class StorageProvider {
  public abstract name: StorageProviderName;
  public abstract get(page: Page): Promise<string>;
  public abstract set(page: Page, data: string): Promise<void>;
}

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
  name: z.string(),
  value: z.string(),
  domain: z.string(),
  path: z.string(),
  expires: z.number(),
  size: z.number(),
  httpOnly: z.boolean(),
  secure: z.boolean(),
  session: z.boolean(),
  sameSite: CDPSameSite.optional(),
  priority: CDPCookiePriority,
  sameParty: z.boolean(),
  sourceScheme: CDPSourceScheme,
  sourcePort: z.number(),
});
export type CDPCookie = z.infer<typeof CDPCookieSchema>;

/**
 * IndexedDB schemas
 */
export const IndexedDBSchema = z.string();
export const IndexedDBDatabaseSchema = z.object({
  name: z.string(),
  data: IndexedDBSchema,
  securityOrigin: z.string(),
});
export type IndexedDBDatabase = z.infer<typeof IndexedDBDatabaseSchema>;

/**
 * CDP IndexedDB DatabaseNames response
 */
export const CDPIndexedDBDatabaseNames = z.object({
  databaseNames: z.array(z.string()),
});

/**
 * CDP Network.CookieParam schema
 * @see https://chromedevtools.github.io/devtools-protocol/tot/Network/#type-CookieParam
 */
export const CDPCookieParam = z.object({
  name: z.string(),
  value: z.string(),
  url: z.string().optional(),
  domain: z.string().optional(),
  path: z.string().optional(),
  secure: z.boolean().optional(),
  httpOnly: z.boolean().optional(),
  sameSite: CDPSameSite.optional(),
  // Time since Epoch
  expires: z.number().optional(),
  priority: CDPCookiePriority.optional(),
  sameParty: z.boolean().optional(),
  sourceScheme: CDPSourceScheme.optional(),
  sourcePort: z.number().optional(),
});

export const SessionDataSchema = z.object({
  localStorage: z.string().optional(),
  sessionStorage: z.string().optional(),
  indexedDB: z.string().optional(),
  cookie: z.string().optional(),
});
