import { Browser, Page, Target } from "puppeteer-core";
import { BrowserLauncher, BrowserProcess, BrowserRef, ProxyRef, ResolvedConfig } from "./types.js";

export interface MockLauncherOptions {
  launchDelay?: number;
  shouldFail?: boolean;
  crashAfterMs?: number;
}

export class MockLauncher implements BrowserLauncher {
  public launchCalls: ResolvedConfig[] = [];
  public closeCalls: BrowserRef[] = [];
  public forceCloseCalls: BrowserRef[] = [];
  private disconnectCallbacks = new Map<string, Set<() => void>>();
  private targetCreatedCallbacks = new Map<string, Set<(target: Target) => void>>();
  private targetDestroyedCallbacks = new Map<string, Set<(targetId: string) => void>>();

  constructor(private options: MockLauncherOptions = {}) {}

  async launch(config: ResolvedConfig, proxy: ProxyRef | null): Promise<BrowserRef> {
    this.launchCalls.push(config);

    if (this.options.launchDelay) {
      await new Promise((resolve) => setTimeout(resolve, this.options.launchDelay));
    }

    if (this.options.shouldFail) {
      throw new Error("Mock launch failure");
    }

    const browserId = config.sessionId || `mock-browser-${Date.now()}`;

    const mockBrowser = {
      wsEndpoint: () => `ws://mock-launcher/${browserId}`,
      process: () => ({ pid: 99999 }),
      close: async () => {},
      on: (event: string, cb: any) => {
        // Handled via our manual callbacks for simulation
      },
      off: (event: string, cb: any) => {},
      targets: () => [],
    } as unknown as Browser;

    const mockPage = {
      url: () => "about:blank",
      close: async () => {},
    } as unknown as Page;

    const browserRef: BrowserRef = {
      id: browserId,
      instance: mockBrowser,
      primaryPage: mockPage,
      pid: 99999,
      wsEndpoint: `ws://mock-launcher/${browserId}`,
      launchedAt: Date.now(),
    };

    if (this.options.crashAfterMs) {
      setTimeout(() => {
        this.simulateCrash(browserRef);
      }, this.options.crashAfterMs);
    }

    return browserRef;
  }

  async close(browser: BrowserRef): Promise<void> {
    this.closeCalls.push(browser);
  }

  async forceClose(browser: BrowserRef): Promise<void> {
    this.forceCloseCalls.push(browser);
  }

  getProcess(browser: BrowserRef): BrowserProcess | null {
    return {
      pid: browser.pid,
      kill: (signal) => true,
    };
  }

  onDisconnected(browser: BrowserRef, callback: () => void): () => void {
    if (!this.disconnectCallbacks.has(browser.id)) {
      this.disconnectCallbacks.set(browser.id, new Set());
    }
    this.disconnectCallbacks.get(browser.id)!.add(callback);
    return () => this.disconnectCallbacks.get(browser.id)?.delete(callback);
  }

  onTargetCreated(browser: BrowserRef, callback: (target: Target) => void): () => void {
    if (!this.targetCreatedCallbacks.has(browser.id)) {
      this.targetCreatedCallbacks.set(browser.id, new Set());
    }
    this.targetCreatedCallbacks.get(browser.id)!.add(callback);
    return () => this.targetCreatedCallbacks.get(browser.id)?.delete(callback);
  }

  onTargetDestroyed(browser: BrowserRef, callback: (targetId: string) => void): () => void {
    if (!this.targetDestroyedCallbacks.has(browser.id)) {
      this.targetDestroyedCallbacks.set(browser.id, new Set());
    }
    this.targetDestroyedCallbacks.get(browser.id)!.add(callback);
    return () => this.targetDestroyedCallbacks.get(browser.id)?.delete(callback);
  }

  // Simulation helpers
  public simulateCrash(browser: BrowserRef): void {
    const callbacks = this.disconnectCallbacks.get(browser.id);
    if (callbacks) {
      callbacks.forEach((cb) => cb());
    }
  }

  public simulateTargetCreated(browser: BrowserRef, target: Target): void {
    const callbacks = this.targetCreatedCallbacks.get(browser.id);
    if (callbacks) {
      callbacks.forEach((cb) => cb(target));
    }
  }

  public simulateTargetDestroyed(browser: BrowserRef, targetId: string): void {
    const callbacks = this.targetDestroyedCallbacks.get(browser.id);
    if (callbacks) {
      callbacks.forEach((cb) => cb(targetId));
    }
  }
}
