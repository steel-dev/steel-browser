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
import type { TargetSessionContext } from "../plugins/core/base-plugin.js";

const INTERNAL_EXTENSIONS = new Set<string>([
  // TODO: need secret manager, recorder, and capacha IDs
]);

export interface TargetInstrumentationOptions extends AttachPageEventsOptions {
  captureWorkerNetwork?: boolean;
}

export class TargetInstrumentationManager {
  private attachedSessions = new Set<string>();
  private cdpSessions = new Map<string, CDPSession>();
  private puppeteerOwnedSessions = new Set<string>();

  private instrumentationOptions: TargetInstrumentationOptions;

  constructor(
    private logger: BrowserLogger,
    private appLogger: FastifyBaseLogger,
    instrumentationOptions?: TargetInstrumentationOptions,
    private onTargetSession?: (context: TargetSessionContext) => Promise<void>,
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
        // Puppeteer pauses dedicated workers before publishing targetcreated, but resumes
        // them immediately after the event. Reuse that session so Network is enabled before
        // the worker can issue its first request instead of creating a second, late session.
        const existingSession = isDedicatedWorker ? (target as any)._session?.() : undefined;
        if (isDedicatedWorker && !existingSession) {
          this.appLogger.warn(
            "[TargetManager] Puppeteer's paused dedicated-worker session was unavailable; falling back to createCDPSession(), which may miss initial worker activity",
          );
        }
        const session = existingSession ?? (await target.createCDPSession());
        this.cdpSessions.set(sessionId, session);
        if (existingSession) this.puppeteerOwnedSessions.add(sessionId);

        if (isExtensionTarget) {
          await this.enableDomainsForTarget(session, type, isExtensionTarget, isDedicatedWorker);
          attachCDPEvents(session, this.logger);
          await attachExtensionEvents(target, this.logger, INTERNAL_EXTENSIONS, this.appLogger);
        } else if (isDedicatedWorker) {
          if (existingSession) {
            const targetSessionPromise = this.onTargetSession?.({
              target,
              type,
              session,
              isDedicatedWorker,
              isPuppeteerPaused: true,
            });
            attachCDPEvents(session, this.logger);
            attachWorkerEvents(target, session, this.logger, type, this.workerEventsOptions());

            // Queue network capture before yielding. Puppeteer's target
            // manager sends Runtime.runIfWaitingForDebugger after targetcreated returns.
            const networkEnabled =
              this.instrumentationOptions.captureWorkerNetwork === true
                ? session.send("Network.enable").catch((err) => {
                    this.appLogger.error(
                      { err },
                      `[TargetManager] Failed to enable Network for ${type}:`,
                    );
                  })
                : Promise.resolve();
            await Promise.all([
              networkEnabled,
              this.enableDomainsForTarget(
                session,
                type,
                false,
                isDedicatedWorker,
                this.instrumentationOptions.captureWorkerNetwork === true,
              ),
              targetSessionPromise,
            ]);
            break;
          }

          await this.enableDomainsForTarget(session, type, false, isDedicatedWorker);
          attachCDPEvents(session, this.logger);
          attachWorkerEvents(target, session, this.logger, type, this.workerEventsOptions());
        } else {
          await this.enableDomainsForTarget(session, type, false, isDedicatedWorker);
          attachCDPEvents(session, this.logger);
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
      if (this.puppeteerOwnedSessions.delete(targetId)) return;
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
    networkAlreadyEnabled = false,
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
        if (
          !networkAlreadyEnabled &&
          (isExtension || this.instrumentationOptions.captureWorkerNetwork === true)
        ) {
          await enable("Network");
        }
        break;

      case TargetType.WEBVIEW:
      case TargetType.OTHER:
        if (isExtension || isDedicatedWorker) {
          await enable("Runtime");
          await enable("Log");
          if (
            !networkAlreadyEnabled &&
            (isExtension || this.instrumentationOptions.captureWorkerNetwork === true)
          ) {
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
