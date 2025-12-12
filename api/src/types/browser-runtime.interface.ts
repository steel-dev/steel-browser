import { Browser, BrowserContext, Page } from "puppeteer-core";
import { BrowserLauncherOptions } from "./browser.js";
import { SessionData } from "../services/context/types.js";
import { BasePlugin } from "../services/cdp/plugins/core/base-plugin.js";
import { BrowserLogger } from "../services/cdp/instrumentation/browser-logger.js";
import { BrowserFingerprintWithHeaders } from "fingerprint-generator";
import { IncomingMessage } from "http";
import { Duplex } from "stream";
import { FastifyBaseLogger } from "fastify";

/**
 * Common interface for browser runtime implementations.
 * Both CDPService and Orchestrator implement this interface.
 */
export interface BrowserRuntime {
  // Core lifecycle
  launch(config?: BrowserLauncherOptions): Promise<Browser>;
  shutdown(): Promise<void>;
  startNewSession(sessionConfig: BrowserLauncherOptions): Promise<Browser>;
  endSession(): Promise<void>;

  // Browser/Page access
  getBrowserInstance(): Browser | null;
  getPrimaryPage(): Promise<Page>;
  createPage(): Promise<Page>;
  createBrowserContext(proxyUrl?: string): Promise<BrowserContext>;
  getAllPages(): Page[] | Promise<Page[]>;
  refreshPrimaryPage(): Promise<void>;

  // Configuration
  getLaunchConfig(): BrowserLauncherOptions | undefined;
  getUserAgent(): string | undefined;
  getDimensions(): { width: number; height: number };
  getFingerprintData(): BrowserFingerprintWithHeaders | null;

  // Session context
  getBrowserState(): Promise<SessionData>;
  getSessionContext(): SessionData | null;

  // Plugin management
  registerPlugin(plugin: BasePlugin): void;
  unregisterPlugin(pluginName: string): boolean;
  getPlugin<T extends BasePlugin>(pluginName: string): T | undefined;
  waitUntil(task: Promise<void>): void;

  // Hooks
  registerLaunchHook(hook: (config: BrowserLauncherOptions) => Promise<void> | void): void;
  registerShutdownHook(hook: (config: BrowserLauncherOptions | null) => Promise<void> | void): void;

  // WebSocket proxying
  setProxyWebSocketHandler(
    handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => Promise<void>,
  ): void;
  proxyWebSocket(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void>;

  // Debugging
  getDebuggerUrl(): string;
  getDebuggerWsUrl(pageId?: string): string;
  getTargetId(page: Page): string;

  // Instrumentation
  getInstrumentationLogger(): BrowserLogger | null;
  getLogger(name: string): FastifyBaseLogger;

  // State
  isRunning(): boolean;

  // Event emitter methods (for socket handlers)
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  removeListener(event: string | symbol, listener: (...args: any[]) => void): this;
}
