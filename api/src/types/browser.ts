import { BrowserEventType } from "./enums";
import { Protocol } from "puppeteer-core";
export interface BrowserLauncherOptions {
  options: BrowserServerOptions;
  req?: Request;
  stealth?: boolean;
  sessionContext?: {
    cookies?: Protocol.Network.Cookie[];
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
  userDataDir?: string;
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
