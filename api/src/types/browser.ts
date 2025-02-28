import { Protocol } from "puppeteer-core";
import { BrowserEventType } from "./enums";

export interface BrowserLauncherOptions {
  options: BrowserServerOptions;
  req?: Request;
  stealth?: boolean;
  sessionContext?: {
    cookies?: Protocol.Network.CookieParam[];
    localStorage?: Record<string, Record<string, any>>;
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

export type Platform = "darwin" | "linux" | "win32";

export interface BrowserPaths {
  darwin: string[];
  linux: string[];
  win32: string[];
}
