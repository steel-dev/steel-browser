import type { BrowserEventType } from "./enums.js";
import type {
  CookieData,
  IndexedDBDatabase,
  LocalStorageData,
  SessionStorageData,
} from "../services/context/types.js";
import type { CredentialsOptions } from "../modules/sessions/sessions.schema.js";
import type { BrowserFingerprintWithHeaders } from "fingerprint-generator";

export type OptimizeBandwidthOptions = {
  blockImages?: boolean;
  blockMedia?: boolean;
  blockStylesheets?: boolean;
  blockHosts?: string[];
  blockUrlPatterns?: string[];
};

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
  optimizeBandwidth?: boolean | OptimizeBandwidthOptions;
  customHeaders?: Record<string, string>;
  timezone?: Promise<string>;
  dimensions?: {
    width: number;
    height: number;
  } | null;
  userDataDir?: string;
  userPreferences?: Record<string, any>;
  extra?: Record<string, Record<string, string>>;
  credentials?: CredentialsOptions;
  skipFingerprintInjection?: boolean;
  /** Persisted fingerprint data to reuse across sessions */
  fingerprint?: BrowserFingerprintWithHeaders;
  /** User ID for deterministic fingerprint generation and session persistence */
  userId?: string;
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
