import type { BrowserEventType } from "./enums.js";
import type { CookieData, IndexedDBDatabase, LocalStorageData, SessionStorageData } from "../services/context/types.js";
import type { CredentialsOptions } from "../modules/sessions/sessions.schema.js";

export interface BrowserLauncherOptions {
  options: BrowserServerOptions;
  req?: Request;
  stealth?: boolean;
  sessionContext?: {
    cookies?: CookieData[];
    localStorage?: Record<string, LocalStorageData>;
    sessionStorage?: Record<string, SessionStorageData>;
    indexedDB?: Record<string, IndexedDBDatabase[]>;
  };
  userAgent?: string;
  extensions?: string[];
  logSinkUrl?: string;
  blockAds?: boolean;
  customHeaders?: Record<string, string>;
  timezone?: string;
  dimensions?: {
    width: number;
    height: number;
  } | null;
  userDataDir?: string;
  extra?: Record<string, Record<string, string>>;
  credentials?: CredentialsOptions;
}

export interface BrowserServerOptions {
  args?: string[];
  chromiumSandbox?: boolean;
  devtools?: boolean;
  downloadsPath?: string;
  headless?: boolean;
  ignoreDefaultArgs?: boolean | string[];
  proxyUrl?: string;
  timeout?: number;
  tracesDir?: string;
}

export type BrowserEvent = {
  type: BrowserEventType;
  text: string;
  timestamp: Date;
};
