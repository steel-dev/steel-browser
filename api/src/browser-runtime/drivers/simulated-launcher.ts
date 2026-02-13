import { Browser, Page, Target } from "puppeteer-core";
import { BrowserLauncher, BrowserProcess, BrowserRef, ProxyRef, ResolvedConfig } from "./types.js";

export interface SimulatedLauncherOptions {
  avgLaunchTimeMs?: number;
  crashProbability?: number; // 0 to 1
  maxConcurrent?: number;
}

export class SimulatedLauncher implements BrowserLauncher {
  private activeBrowsers = new Map<string, BrowserRef>();
  private disconnectCallbacks = new Map<string, Set<() => void>>();
  private metrics = {
    totalLaunched: 0,
    totalCrashed: 0,
    totalClosed: 0,
    launchTimes: [] as number[],
  };

  constructor(private options: SimulatedLauncherOptions = {}) {}

  async launch(config: ResolvedConfig, proxy: ProxyRef | null): Promise<BrowserRef> {
    const startTime = Date.now();

    if (this.options.maxConcurrent && this.activeBrowsers.size >= this.options.maxConcurrent) {
      throw new Error("Simulated capacity reached");
    }

    const launchDelay = this.options.avgLaunchTimeMs
      ? this.options.avgLaunchTimeMs * (0.5 + Math.random())
      : 100;

    await new Promise((resolve) => setTimeout(resolve, launchDelay));

    const browserId = config.sessionId;

    const mockBrowser = {
      wsEndpoint: () => `ws://sim-launcher/${browserId}`,
      process: () => ({ pid: 88888 }),
      close: async () => {},
      on: () => {},
      off: () => {},
      targets: () => [],
    } as unknown as Browser;

    const mockPage = {
      url: () => "about:simulated",
      close: async () => {},
    } as unknown as Page;

    const browserRef: BrowserRef = {
      id: browserId,
      instance: mockBrowser,
      primaryPage: mockPage,
      pid: 88888,
      wsEndpoint: `ws://sim-launcher/${browserId}`,
      launchedAt: Date.now(),
    };

    this.activeBrowsers.set(browserId, browserRef);
    this.metrics.totalLaunched++;
    this.metrics.launchTimes.push(Date.now() - startTime);

    // Random crash simulation
    if (this.options.crashProbability && Math.random() < this.options.crashProbability) {
      const crashDelay = 1000 + Math.random() * 5000;
      setTimeout(() => {
        if (this.activeBrowsers.has(browserId)) {
          this.simulateCrash(browserRef);
        }
      }, crashDelay);
    }

    return browserRef;
  }

  async close(browser: BrowserRef): Promise<void> {
    this.activeBrowsers.delete(browser.id);
    this.metrics.totalClosed++;
  }

  async forceClose(browser: BrowserRef): Promise<void> {
    this.activeBrowsers.delete(browser.id);
    this.metrics.totalClosed++;
  }

  getProcess(browser: BrowserRef): BrowserProcess | null {
    return {
      pid: browser.pid,
      kill: () => {
        this.activeBrowsers.delete(browser.id);
        return true;
      },
    };
  }

  onDisconnected(browser: BrowserRef, callback: () => void): () => void {
    if (!this.disconnectCallbacks.has(browser.id)) {
      this.disconnectCallbacks.set(browser.id, new Set());
    }
    this.disconnectCallbacks.get(browser.id)!.add(callback);
    return () => this.disconnectCallbacks.get(browser.id)?.delete(callback);
  }

  onTargetCreated(): () => void {
    return () => {};
  }
  onTargetDestroyed(): () => void {
    return () => {};
  }

  private simulateCrash(browser: BrowserRef): void {
    this.activeBrowsers.delete(browser.id);
    this.metrics.totalCrashed++;
    const callbacks = this.disconnectCallbacks.get(browser.id);
    if (callbacks) {
      callbacks.forEach((cb) => cb());
    }
  }

  public getMetrics() {
    const avgLaunch =
      this.metrics.launchTimes.length > 0
        ? this.metrics.launchTimes.reduce((a, b) => a + b, 0) / this.metrics.launchTimes.length
        : 0;

    return {
      totalLaunched: this.metrics.totalLaunched,
      totalCrashed: this.metrics.totalCrashed,
      totalClosed: this.metrics.totalClosed,
      currentActive: this.activeBrowsers.size,
      avgLaunchTimeMs: avgLaunch,
    };
  }
}
