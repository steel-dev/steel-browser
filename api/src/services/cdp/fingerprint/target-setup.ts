import type { FastifyBaseLogger } from "fastify";
import type { BrowserFingerprintWithHeaders } from "fingerprint-generator";
import type { Browser, CDPSession, Protocol, Target } from "puppeteer-core";
import { loadFingerprintScript, loadWorkerFingerprintScript } from "../../../scripts/index.js";
import { isTargetClosedError } from "../../../utils/target-closed.js";
import {
  buildDeviceMetrics,
  buildScriptParams,
  buildUserAgentOverride,
  FingerprintScriptParams,
  UserAgentOverride,
} from "./overrides.js";

type Command = readonly [method: string, params: object];

export interface FingerprintTargetSetupOptions {
  fingerprintData: BrowserFingerprintWithHeaders;
  /** The screen comes from --screen-info, so pages do not override it. */
  screenFromLaunchFlags: boolean;
  logger: Pick<FastifyBaseLogger, "debug" | "warn" | "error">;
}

const INTERNAL_URL = /^(chrome|chrome-extension|chrome-untrusted|devtools):/;

/**
 * Applies the session fingerprint to every page, frame and worker before its
 * first script or request.
 *
 * Puppeteer auto-attaches to new targets with waitForDebuggerOnStart and
 * resumes them (Runtime.runIfWaitingForDebugger) inside the same task in
 * which it creates the target, before `targetcreated` is emitted. Its
 * `targetFilter` callback runs in that task with the target's session, so
 * commands sent from it are written to the socket ahead of the resume and
 * Chromium applies them before the target runs. The overrides live on
 * Puppeteer's own session, which stays attached for the target's lifetime.
 *
 * Puppeteer detaches from service workers without calling `targetFilter`, so
 * they get their own browser-level auto-attach session.
 */
export class FingerprintTargetSetup {
  private readonly logger: FingerprintTargetSetupOptions["logger"];
  private readonly userAgentOverride: UserAgentOverride;
  private readonly scriptParams: FingerprintScriptParams;
  private readonly pageCommands: Command[];
  private readonly frameCommands: Command[];
  private workerCommands: Command[] | null = null;
  private serviceWorkerSession: CDPSession | null = null;

  constructor(options: FingerprintTargetSetupOptions) {
    const { fingerprintData } = options;
    this.logger = options.logger;
    this.userAgentOverride = buildUserAgentOverride(fingerprintData);
    this.scriptParams = buildScriptParams(fingerprintData);
    const { metrics, touch } = buildDeviceMetrics(fingerprintData, {
      screenFromLaunchFlags: options.screenFromLaunchFlags,
    });
    const hardwareConcurrency = {
      hardwareConcurrency: this.scriptParams.fixedHardwareConcurrency,
    };
    const pageScript: Command = [
      "Page.addScriptToEvaluateOnNewDocument",
      { source: loadFingerprintScript(this.scriptParams) },
    ];

    this.pageCommands = [
      ["Emulation.setUserAgentOverride", this.userAgentOverride],
      ["Emulation.setHardwareConcurrencyOverride", hardwareConcurrency],
      ...(metrics ? [["Emulation.setDeviceMetricsOverride", metrics] as const] : []),
      ...(touch ? [["Emulation.setTouchEmulationEnabled", touch] as const] : []),
      pageScript,
    ];
    // Out-of-process iframes share the page's screen and viewport.
    this.frameCommands = [
      ["Emulation.setUserAgentOverride", this.userAgentOverride],
      ["Emulation.setHardwareConcurrencyOverride", hardwareConcurrency],
      pageScript,
    ];
  }

  /**
   * Puppeteer `targetFilter` callback. Never filters a target out.
   */
  public readonly targetFilter = (target: Target): boolean => {
    try {
      this.onTargetAttached(target);
    } catch (error) {
      this.logger.error({ err: error }, "[Fingerprint] Failed to set up target");
    }
    return true;
  };

  public onTargetAttached(target: Target): void {
    // Puppeteer also calls the filter for targets it has not attached to yet.
    const session = (target as any)._session?.() as CDPSession | undefined;
    if (!session) return;
    const info = (target as any)._getTargetInfo?.() as Protocol.Target.TargetInfo | undefined;
    const type = info?.type ?? target.type();
    if (INTERNAL_URL.test(info?.url ?? target.url())) return;

    switch (type) {
      case "page":
        this.send(session, type, this.pageCommands);
        break;
      case "iframe":
        this.send(session, type, this.frameCommands);
        break;
      case "worker":
      case "shared_worker":
        this.send(session, type, this.getWorkerCommands());
        break;
      default:
        break;
    }
  }

  /**
   * Auto-attaches a browser-level session to service workers. The session
   * stays attached: Chromium drops a session's overrides when it detaches.
   */
  public async attachServiceWorkers(browser: Browser): Promise<void> {
    const session = await browser.target().createCDPSession();
    const connection = session.connection();
    session.on("Target.attachedToTarget", (event: Protocol.Target.AttachedToTargetEvent) => {
      const worker = connection?.session(event.sessionId);
      if (!worker) return;
      const { type, url } = event.targetInfo;
      const isPageServiceWorker = type === "service_worker" && !INTERNAL_URL.test(url);
      if (isPageServiceWorker) {
        this.send(worker, type, this.getWorkerCommands());
      }
      worker.send("Runtime.runIfWaitingForDebugger").catch(() => {});
      if (!isPageServiceWorker) {
        session.send("Target.detachFromTarget", { sessionId: event.sessionId }).catch(() => {});
      }
    });
    await session.send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
      filter: [{ type: "service_worker", exclude: false }],
    });
    this.serviceWorkerSession = session;
  }

  public async dispose(): Promise<void> {
    await this.serviceWorkerSession?.detach().catch(() => {});
    this.serviceWorkerSession = null;
  }

  private getWorkerCommands(): Command[] {
    if (!this.workerCommands) {
      const commands: Command[] = [
        ["Network.setUserAgentOverride", this.userAgentOverride],
        [
          "Emulation.setHardwareConcurrencyOverride",
          { hardwareConcurrency: this.scriptParams.fixedHardwareConcurrency },
        ],
      ];
      try {
        commands.push([
          "Runtime.evaluate",
          { expression: loadWorkerFingerprintScript(this.scriptParams), silent: true },
        ]);
      } catch (error) {
        this.logger.error({ err: error }, "[Fingerprint] Failed to build the worker script");
      }
      this.workerCommands = commands;
    }
    return this.workerCommands;
  }

  private send(session: CDPSession, type: string, commands: Command[]): void {
    for (const [method, params] of commands) {
      session.send(method as any, params as any).catch((error: unknown) => {
        if (isTargetClosedError(error)) return;
        this.logger.warn({ err: error, method, type }, "[Fingerprint] Override was not applied");
      });
    }
  }
}
