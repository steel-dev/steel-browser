import { BrowserEventType } from "./enums";
import { CookieData } from "../services/cdp/plugins/session/types";

export interface BrowserLauncherOptions {
  options: BrowserServerOptions;
  req?: Request;
  stealth?: boolean;
  sessionContext?: {
    cookies?: CookieData[];
    localStorage?: Record<string, Record<string, any>>;
    sessionStorage?: Record<string, Record<string, any>>;
    indexedDB?: Record<string, { name: string; securityOrigin: string; data?: any }[]>;
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
