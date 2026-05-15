import type { BrowserEventType } from "./enums.js";
import type {
  CookieData,
  IndexedDBDatabase,
  LocalStorageData,
  SessionStorageData,
} from "../services/context/types.js";
import { BrowserFingerprintWithHeaders } from "fingerprint-generator";
import type { CredentialsOptions } from "../modules/sessions/sessions.schema.js";

export interface OptimizeBandwidthOptions {
  blockImages?: boolean;
  blockMedia?: boolean;
  blockStylesheets?: boolean;
  blockHosts?: string[];
  blockUrlPatterns?: string[];
}

export interface BrowserOrgExtensionsExtra {
  paths?: string[];
}

export interface BrowserLaunchExtra {
  orgExtensions?: BrowserOrgExtensionsExtra;
  [key: string]: unknown;
}

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
  fingerprint?: BrowserFingerprintWithHeaders;
  optimizeBandwidth?: boolean | OptimizeBandwidthOptions;
  customHeaders?: Record<string, string>;
  timezone?: Promise<string>;
  dimensions?: {
    width: number;
    height: number;
  } | null;
  userDataDir?: string;
  userPreferences?: Record<string, any>;
  extra?: BrowserLaunchExtra;
  credentials?: CredentialsOptions;
  skipFingerprintInjection?: boolean;
  deviceConfig?: { device: "desktop" | "mobile" };
  fullscreen?: boolean;
  dangerouslyLogRequestDetails?: boolean;
  semanticAgentLogs?: boolean;
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
