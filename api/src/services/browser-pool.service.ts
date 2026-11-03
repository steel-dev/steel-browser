import type { FastifyBaseLogger } from "fastify";
import type { LogStorage } from "./cdp/instrumentation/storage/log-storage.interface.js";
import { CDPService } from "./cdp/cdp.service.js";
import { ShutdownReason } from "./cdp/plugins/core/base-plugin.js";
import { SeleniumService } from "./selenium.service.js";
import type { BrowserLauncherOptions } from "../types/index.js";
import { env } from "../env.js";

export interface BrowserSlot {
  readonly index: number;
  readonly cdpPort: number;
  readonly cdpService: CDPService;
  readonly seleniumService: SeleniumService;
  sessionId: string | null;
}

export class BrowserPool {
  private readonly slots: BrowserSlot[];
  private readonly logger: FastifyBaseLogger;

  constructor(options: {
    maxSessions: number;
    cdpPortBase: number;
    seleniumPortBase: number;
    logger: FastifyBaseLogger;
    storages: Array<LogStorage | null>;
    enableConsoleLogging: boolean;
  }) {
    this.logger = options.logger;
    if (options.maxSessions > options.storages.length) {
      throw new Error("A log storage instance is required for every browser slot");
    }
    if (options.cdpPortBase + options.maxSessions - 1 > 65535) {
      throw new Error("CDP_PORT_BASE and MAX_SESSIONS exceed the TCP port range");
    }
    if (options.seleniumPortBase + options.maxSessions - 1 > 65535) {
      throw new Error("SELENIUM_PORT_BASE and MAX_SESSIONS exceed the TCP port range");
    }

    this.slots = Array.from({ length: options.maxSessions }, (_, index) => {
      const cdpPort = options.cdpPortBase + index;
      return {
        index,
        cdpPort,
        cdpService: new CDPService(
          {
            cdpPort,
            remoteDebuggingAddress: index === 0 ? env.HOST : "127.0.0.1",
          },
          options.logger.child({ browserSlot: index }),
          options.storages[index],
          options.enableConsoleLogging,
        ),
        seleniumService: new SeleniumService(
          options.logger.child({ browserSlot: index }),
          options.seleniumPortBase + index,
        ),
        sessionId: null,
      };
    });
  }

  get defaultSlot(): BrowserSlot {
    return this.slots[0];
  }

  get maxSessions(): number {
    return this.slots.length;
  }

  get activeCount(): number {
    return this.slots.filter((slot) => slot.sessionId !== null).length;
  }

  acquire(sessionId: string): BrowserSlot | undefined {
    const slot = this.slots.find((candidate) => candidate.sessionId === null);
    if (slot) slot.sessionId = sessionId;
    return slot;
  }

  getSlot(sessionId: string): BrowserSlot | undefined {
    return this.slots.find((slot) => slot.sessionId === sessionId);
  }

  release(sessionId: string): boolean {
    const slot = this.getSlot(sessionId);
    if (!slot) return false;
    slot.sessionId = null;
    return true;
  }

  registerLaunchHook(hook: (config: BrowserLauncherOptions) => Promise<void> | void): void {
    for (const slot of this.slots) slot.cdpService.registerLaunchHook(hook);
  }

  registerShutdownHook(
    hook: (config: BrowserLauncherOptions | null) => Promise<void> | void,
  ): void {
    for (const slot of this.slots) slot.cdpService.registerShutdownHook(hook);
  }

  registerSessionEndedHook(
    hook: (sessionId: string | undefined, reason: ShutdownReason) => void,
  ): void {
    for (const slot of this.slots) slot.cdpService.on("sessionEnded", hook);
  }

  async shutdownAll(): Promise<void> {
    const results = await Promise.allSettled(
      this.slots.flatMap(({ cdpService, seleniumService }) => [
        cdpService.shutdown(ShutdownReason.SESSION_END),
        seleniumService.close(),
      ]),
    );
    for (const result of results) {
      if (result.status === "rejected") {
        this.logger.error({ err: result.reason }, "Browser slot shutdown failed");
      }
    }
  }
}
