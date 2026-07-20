import { type Target, type CDPSession, TargetType } from "puppeteer-core";
import type { FastifyBaseLogger } from "fastify";

import { attachPageEvents } from "./page-events.js";
import type { AttachPageEventsOptions } from "./page-events.js";
import { attachCDPEvents } from "./cdp-events.js";
import { attachBrowserInteractionEvents } from "./browser-interaction-events.js";
import { attachExtensionEvents } from "./extension-events.js";
import { attachWorkerEvents } from "./worker-events.js";
import type { AttachWorkerEventsOptions } from "./worker-events.js";
import { BrowserLogger } from "./browser-logger.js";

const INTERNAL_EXTENSIONS = new Set<string>([
  // TODO: need secret manager, recorder, and capacha IDs
]);

export interface TargetInstrumentationOptions extends AttachPageEventsOptions {
  captureWorkerNetwork?: boolean;
}

export class TargetInstrumentationManager {
  private attachedSessions = new Set<string>();
  private cdpSessions = new Map<string, CDPSession>();

  private instrumentationOptions: TargetInstrumentationOptions;

  constructor(
    private logger: BrowserLogger,
    private appLogger: FastifyBaseLogger,
    instrumentationOptions?: TargetInstrumentationOptions,
  ) {
    this.instrumentationOptions = instrumentationOptions ?? {};
  }

  async attach(target: Target, type: TargetType) {
    const url = target.url?.() ?? "";
    const isExtensionTarget = url.startsWith("chrome-extension://");
    const isDedicatedWorker =
      type === TargetType.OTHER && (target as any)._getTargetInfo?.().type === "worker";
    const sessionId = (target as any)._targetId;

    if (this.attachedSessions.has(sessionId)) {
      return;
    }

    this.attachedSessions.add(sessionId);

    switch (type) {
      case TargetType.PAGE:
      case TargetType.BACKGROUND_PAGE: {
        // Create a single CDP session shared by page-events and cdp-events
        const session = await target.createCDPSession();
        this.cdpSessions.set(sessionId, session);
        await this.enableDomainsForTarget(session, type, isExtensionTarget);

        const page = await target.page();
        if (page) {
          await attachPageEvents(page, session, this.logger, type, this.instrumentationOptions);
          if (!isExtensionTarget) {
            await attachBrowserInteractionEvents(session, page, this.logger, type, sessionId);
          }
        }

        attachCDPEvents(session, this.logger);

        if (isExtensionTarget) {
          await attachExtensionEvents(target, this.logger, INTERNAL_EXTENSIONS, this.appLogger);
        }
        break;
      }

      case TargetType.SERVICE_WORKER: {
        const session = await target.createCDPSession();
        this.cdpSessions.set(sessionId, session);
        await this.enableDomainsForTarget(session, type, isExtensionTarget);
        attachCDPEvents(session, this.logger);

        if (isExtensionTarget) {
          await attachExtensionEvents(target, this.logger, INTERNAL_EXTENSIONS, this.appLogger);
        } else {
          attachWorkerEvents(target, session, this.logger, type, this.workerEventsOptions());
        }
        break;
      }

      case TargetType.SHARED_WORKER: {
        const session = await target.createCDPSession();
        this.cdpSessions.set(sessionId, session);
        await this.enableDomainsForTarget(session, type, isExtensionTarget);
        attachCDPEvents(session, this.logger);

        if (isExtensionTarget) {
          await attachExtensionEvents(target, this.logger, INTERNAL_EXTENSIONS, this.appLogger);
        } else {
          attachWorkerEvents(target, session, this.logger, type, this.workerEventsOptions());
        }
        break;
      }

      case TargetType.WEBVIEW: {
        const session = await target.createCDPSession();
        this.cdpSessions.set(sessionId, session);
        await this.enableDomainsForTarget(session, type, isExtensionTarget);
        attachCDPEvents(session, this.logger);

        if (isExtensionTarget) {
          await attachExtensionEvents(target, this.logger, INTERNAL_EXTENSIONS, this.appLogger);
        } else {
          attachWorkerEvents(target, session, this.logger, type);
        }
        break;
      }

      case TargetType.OTHER: {
        const session = await target.createCDPSession();
        this.cdpSessions.set(sessionId, session);
        await this.enableDomainsForTarget(session, type, isExtensionTarget, isDedicatedWorker);
        attachCDPEvents(session, this.logger);

        if (isExtensionTarget) {
          await attachExtensionEvents(target, this.logger, INTERNAL_EXTENSIONS, this.appLogger);
        } else if (isDedicatedWorker) {
          attachWorkerEvents(target, session, this.logger, type, this.workerEventsOptions());
        }
        break;
      }

      case TargetType.BROWSER:
      default: {
        const session = await target.createCDPSession();
        this.cdpSessions.set(sessionId, session);
        await this.enableDomainsForTarget(session, type, isExtensionTarget);
        attachCDPEvents(session, this.logger);

        if (isExtensionTarget) {
          await attachExtensionEvents(target, this.logger, INTERNAL_EXTENSIONS, this.appLogger);
        }
        break;
      }
    }
  }

  detach(targetId: string) {
    this.attachedSessions.delete(targetId);
    const session = this.cdpSessions.get(targetId);
    if (session) {
      this.cdpSessions.delete(targetId);
      session.detach().catch(() => {
        // Session may already be closed if the target was destroyed
      });
    }
  }

  private async enableDomainsForTarget(
    session: CDPSession,
    type: TargetType,
    isExtension: boolean,
    isDedicatedWorker = false,
  ): Promise<void> {
    const enabledDomains = new Set<string>();

    const enable = async (domain: string) => {
      if (enabledDomains.has(domain)) return;
      try {
        await session.send(`${domain}.enable` as any);
        enabledDomains.add(domain);
      } catch (err) {
        this.appLogger.error({ err }, `[TargetManager] Failed to enable ${domain} for ${type}:`);
      }
    };

    switch (type) {
      case TargetType.PAGE:
      case TargetType.BACKGROUND_PAGE:
        await enable("Runtime");
        await enable("Page");
        await enable("Log");
        await enable("Network");
        break;

      case TargetType.SERVICE_WORKER:
      case TargetType.SHARED_WORKER:
        await enable("Runtime");
        await enable("Log");
        if (isExtension || this.instrumentationOptions.captureWorkerNetwork === true) {
          await enable("Network");
        }
        break;

      case TargetType.WEBVIEW:
      case TargetType.OTHER:
        if (isExtension || isDedicatedWorker) {
          await enable("Runtime");
          await enable("Log");
          if (isExtension || this.instrumentationOptions.captureWorkerNetwork === true) {
            await enable("Network");
          }
        }
        break;

      default:
        break;
    }
  }

  private workerEventsOptions(): AttachWorkerEventsOptions {
    return {
      dangerouslyLogRequestDetails: this.instrumentationOptions.dangerouslyLogRequestDetails,
      captureNetwork: this.instrumentationOptions.captureWorkerNetwork === true,
    };
  }
}
