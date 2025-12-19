import { Browser, Page, Target } from "puppeteer-core";
import { BrowserPlugin } from "../plugins/base-plugin.js";

export interface RuntimeConfig {
  sessionId: string;
  port: number;
  headless?: boolean;
  proxyUrl?: string;
  timezone?: string | Promise<string>;
  userAgent?: string;
  userDataDir?: string;
  extensions?: string[];
  userPreferences?: Record<string, unknown>;
  fingerprint?: unknown;
  blockAds?: boolean;
  credentials?: unknown;
  skipFingerprintInjection?: boolean;
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
}

export interface ProxyRef {
  url: string;
  close: () => Promise<void>;
}

export interface BrowserRef {
  id: string; // Unique identifier (for mocks)
  instance: Browser; // Puppeteer Browser (or mock)
  primaryPage: Page; // Primary page reference
  pid: number; // Process ID
  wsEndpoint: string; // WebSocket endpoint
  launchedAt: number; // Timestamp for metrics
}

export interface BrowserProcess {
  pid: number;
  kill(signal?: NodeJS.Signals): boolean;
}

export interface BrowserLauncher {
  // Lifecycle
  launch(config: ResolvedConfig, proxy: ProxyRef | null): Promise<BrowserRef>;
  close(browser: BrowserRef): Promise<void>;
  forceClose(browser: BrowserRef): Promise<void>;

  // Process visibility
  getProcess(browser: BrowserRef): BrowserProcess | null;

  // Events (for crash detection, etc.)
  onDisconnected(browser: BrowserRef, callback: () => void): () => void;
  onTargetCreated(browser: BrowserRef, callback: (target: Target) => void): () => void;
  onTargetDestroyed(browser: BrowserRef, callback: (targetId: string) => void): () => void;
}

export interface MachineContext {
  launcher: BrowserLauncher;
  rawConfig: RuntimeConfig | null;
  resolvedConfig: ResolvedConfig | null;
  proxy: ProxyRef | null;
  browser: BrowserRef | null;
  error: Error | null;
  plugins: BrowserPlugin[];
}

export type SupervisorEvent =
  | { type: "START"; config: RuntimeConfig; plugins?: BrowserPlugin[] }
  | { type: "STOP" }
  | { type: "BROWSER_CRASHED"; error: Error }
  | { type: "USER_DISCONNECTED" }
  | { type: "FATAL_ERROR"; error: Error };
