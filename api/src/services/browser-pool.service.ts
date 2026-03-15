import { FastifyBaseLogger } from "fastify";
import { CDPService } from "./cdp/cdp.service.js";

export interface PoolSlot {
  index: number;
  cdpPort: number;
  cdpService: CDPService;
  sessionId: string | null;
}

export class BrowserPool {
  private slots: PoolSlot[];
  private logger: FastifyBaseLogger;

  constructor(
    maxSessions: number,
    cdpPortBase: number,
    logger: FastifyBaseLogger,
    private storageFactory: () => any,
    private enableConsoleLogging: boolean,
  ) {
    this.logger = logger.child({ component: "BrowserPool" });
    this.slots = Array.from({ length: maxSessions }, (_, i) => ({
      index: i,
      cdpPort: cdpPortBase + i,
      cdpService: new CDPService(
        { cdpPort: cdpPortBase + i },
        logger,
        storageFactory(),
        enableConsoleLogging,
      ),
      sessionId: null,
    }));
    this.logger.info(
      `[BrowserPool] Initialized with ${maxSessions} slots (ports ${cdpPortBase}-${cdpPortBase + maxSessions - 1})`,
    );
  }

  acquire(sessionId: string): PoolSlot | null {
    const slot = this.slots.find((s) => s.sessionId === null);
    if (!slot) {
      this.logger.warn(
        `[BrowserPool] Pool full — cannot acquire slot for session ${sessionId}`,
      );
      return null;
    }
    slot.sessionId = sessionId;
    this.logger.info(
      `[BrowserPool] Acquired slot ${slot.index} (port ${slot.cdpPort}) for session ${sessionId}`,
    );
    return slot;
  }

  release(sessionId: string): void {
    const slot = this.slots.find((s) => s.sessionId === sessionId);
    if (slot) {
      this.logger.info(
        `[BrowserPool] Released slot ${slot.index} (port ${slot.cdpPort}) from session ${sessionId}`,
      );
      slot.sessionId = null;
    }
  }

  getSlot(sessionId: string): PoolSlot | undefined {
    return this.slots.find((s) => s.sessionId === sessionId);
  }

  getSlotByCdpPort(port: number): PoolSlot | undefined {
    return this.slots.find((s) => s.cdpPort === port);
  }

  get activeCount(): number {
    return this.slots.filter((s) => s.sessionId !== null).length;
  }

  get maxSessions(): number {
    return this.slots.length;
  }

  getAllActiveSlots(): PoolSlot[] {
    return this.slots.filter((s) => s.sessionId !== null);
  }
}
