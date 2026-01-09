import { Browser, Page, Target } from "puppeteer-core";
import { BrowserPlugin } from "../plugins/base-plugin.js";
import { BrowserFingerprintWithHeaders } from "fingerprint-generator";
import { SessionData } from "../../services/context/types.js";
import { TaskRegistryRef } from "../machine/actors/task-registry.actor.js";

export { SessionData };

export interface RuntimeConfig {
  sessionId: string;
  port: number;
  dataPlanePort?: number;
  headless?: boolean;
  proxyUrl?: string;
  timezone?: string | Promise<string>;
  userAgent?: string;
  userDataDir?: string;
  sessionContext?: SessionData | null;
  extensions?: string[];
  userPreferences?: Record<string, unknown>;
  fingerprint?: BrowserFingerprintWithHeaders | null;
  blockAds?: boolean;
  credentials?: unknown;
  skipFingerprintInjection?: boolean;
  deviceConfig?: { device: "desktop" | "mobile" };
  dimensions?: { width: number; height: number } | null;
  internalBypass?: string;
  host?: string;
  chromeExecutablePath?: string;
  chromeArgs?: string[];
  filterChromeArgs?: string[];
  display?: string;
  debugChromeProcess?: boolean;
}

export interface ResolvedConfig extends Omit<RuntimeConfig, "timezone"> {
  timezone: string;
  userDataDir: string;
  headless: boolean;
  fingerprint: BrowserFingerprintWithHeaders | null;
  sessionContext: SessionData | null;
}

export interface ProxyRef {
  url: string;
  close: () => Promise<void>;
}

export interface BrowserRef {
  id: string;
  instance: Browser;
  primaryPage: Page;
  pid: number;
  wsEndpoint: string;
  launchedAt: number;
}

export interface BrowserProcess {
  pid: number;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface BrowserLauncher {
  launch(config: ResolvedConfig, proxy: ProxyRef | null): Promise<BrowserRef>;
  close(browser: BrowserRef): Promise<void>;
  forceClose(browser: BrowserRef): Promise<void>;

  getProcess(browser: BrowserRef): BrowserProcess | null;

  onDisconnected(browser: BrowserRef, callback: () => void): () => void;
  onTargetCreated(browser: BrowserRef, callback: (target: Target) => void): () => void;
  onTargetDestroyed(browser: BrowserRef, callback: (targetId: string) => void): () => void;
}

export interface IMachineContext {
  launcher: BrowserLauncher;
  rawConfig: RuntimeConfig | null;
  resolvedConfig: ResolvedConfig | null;
  proxy: ProxyRef | null;
  browser: BrowserRef | null;
  fingerprint: BrowserFingerprintWithHeaders | null;
  error: Error | null;
  plugins: BrowserPlugin[];
  sessionState: SessionData | null;
  taskRegistry: TaskRegistryRef | null;
}

export type SupervisorEvent =
  | { type: "START"; config: RuntimeConfig; plugins?: BrowserPlugin[] }
  | { type: "STOP" }
  | { type: "END_SESSION" }
  | { type: "BROWSER_CRASHED"; error: Error }
  | { type: "USER_DISCONNECTED" }
  | { type: "FATAL_ERROR"; error: Error }
  | { type: "WAIT_UNTIL"; fn: (signal: AbortSignal) => Promise<void>; label?: string }
  | { type: "DRAIN"; timeoutMs: number; resolve?: () => void }
  | { type: "CANCEL_ALL"; reason: string }
  | { type: "BROWSER_EVENT"; event: string; data: any };
