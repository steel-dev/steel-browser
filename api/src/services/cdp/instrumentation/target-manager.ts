import { type Target, type CDPSession, TargetType } from "puppeteer-core";
import type { FastifyBaseLogger } from "fastify";

import { attachPageEvents } from "./page-events.js";
import { attachCDPEvents } from "./cdp-events.js";
import { attachExtensionEvents } from "./extension-events.js";
import { attachWorkerEvents } from "./worker-events.js";
import { BrowserLogger } from "./browser-logger.js";

const INTERNAL_EXTENSIONS = new Set<string>([
  // TODO: need secret manager, recorder, and capacha IDs
]);

export class TargetInstrumentationManager {
  private attachedSessions = new Set<string>();

  constructor(
    private logger: BrowserLogger,
    private appLogger: FastifyBaseLogger,
  ) {}

  async attach(target: Target, type: TargetType) {
    const url = target.url?.() ?? "";
    const isExtensionTarget = url.startsWith("chrome-extension://");
    const sessionId = (target as any)._targetId;

    if (this.attachedSessions.has(sessionId)) {
      return;
    }

    this.attachedSessions.add(sessionId);

    switch (type) {
      case TargetType.PAGE:
      case TargetType.BACKGROUND_PAGE: {
        const page = await target.page();
        if (page) {
          await attachPageEvents(page, this.logger, type);
        }

        const session = await target.createCDPSession();
        await this.enableDomainsForTarget(session, type, isExtensionTarget);
        attachCDPEvents(session, this.logger);

        if (isExtensionTarget) {
          await attachExtensionEvents(target, this.logger, INTERNAL_EXTENSIONS, this.appLogger);
        }
        break;
      }

      case TargetType.SERVICE_WORKER: {
        const session = await target.createCDPSession();
        await this.enableDomainsForTarget(session, type, isExtensionTarget);
        attachCDPEvents(session, this.logger);

        if (isExtensionTarget) {
          await attachExtensionEvents(target, this.logger, INTERNAL_EXTENSIONS, this.appLogger);
        } else {
          await attachWorkerEvents(target, this.logger, type);
        }
        break;
      }

      case TargetType.SHARED_WORKER: {
        const session = await target.createCDPSession();
        await this.enableDomainsForTarget(session, type, isExtensionTarget);
        attachCDPEvents(session, this.logger);

        if (isExtensionTarget) {
          await attachExtensionEvents(target, this.logger, INTERNAL_EXTENSIONS, this.appLogger);
        } else {
          await attachWorkerEvents(target, this.logger, type);
        }
        break;
      }

      case TargetType.WEBVIEW: {
        const session = await target.createCDPSession();
        await this.enableDomainsForTarget(session, type, isExtensionTarget);
        attachCDPEvents(session, this.logger);

        if (isExtensionTarget) {
          await attachExtensionEvents(target, this.logger, INTERNAL_EXTENSIONS, this.appLogger);
        } else {
          await attachWorkerEvents(target, this.logger, type);
        }
        break;
      }

      case TargetType.BROWSER:
      case TargetType.OTHER:
      default: {
        const session = await target.createCDPSession();
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
  }

  private async enableDomainsForTarget(
    session: CDPSession,
    type: TargetType,
    isExtension: boolean,
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
        await enable("Log");
        if (isExtension) {
          await enable("Network");
        }
        break;

      case TargetType.SERVICE_WORKER:
      case TargetType.SHARED_WORKER:
        await enable("Runtime");
        await enable("Log");
        if (isExtension) {
          await enable("Network");
        }
        break;

      case TargetType.WEBVIEW:
      case TargetType.OTHER:
        if (isExtension) {
          await enable("Runtime");
          await enable("Log");
          await enable("Network");
        }
        break;

      default:
        break;
    }
  }
}
