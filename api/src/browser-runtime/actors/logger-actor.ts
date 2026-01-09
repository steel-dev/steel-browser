import { BrowserRef, ResolvedConfig, SupervisorEvent } from "../types.js";
import { BrowserLogger } from "../../services/cdp/instrumentation/browser-logger.js";
import { FastifyBaseLogger } from "fastify";
import { TargetInstrumentationManager } from "../../services/cdp/instrumentation/target-manager.js";
import { injectFingerprint } from "../services/fingerprint.service.js";
import { Target } from "puppeteer-core";
import { groupSessionStorageByOrigin, handleFrameNavigated } from "../../utils/context.js";

export interface LoggerInput {
  browser: BrowserRef;
  config: ResolvedConfig;
  instrumentationLogger?: BrowserLogger;
  appLogger?: FastifyBaseLogger;
}

export function startLogger(
  input: LoggerInput,
  sendBack: (event: SupervisorEvent) => void,
): () => void {
  const { browser, config, instrumentationLogger, appLogger } = input;

  if (!instrumentationLogger || !appLogger) {
    console.log(`[LoggerActor] Missing logger for session: ${config.sessionId}`);
    return () => {};
  }

  console.log(`[LoggerActor] Starting for session: ${config.sessionId}`);

  const targetManager = new TargetInstrumentationManager(instrumentationLogger, appLogger);

  const storageByOrigin = groupSessionStorageByOrigin(config.sessionContext || undefined);

  const targetCreatedHandler = (target: Target) => {
    targetManager.attach(target, target.type() as any).catch((err) => {
      appLogger.error({ err }, "[LoggerActor] Failed to attach to target");
    });

    if (target.type() === "page") {
      target
        .page()
        .then((page) => {
          if (!page) return;

          // Inject fingerprint
          if (config.fingerprint) {
            injectFingerprint(page, config.fingerprint, appLogger).catch((err) => {
              appLogger.error({ err }, "[LoggerActor] Failed to inject fingerprint into new page");
            });
          }

          // Inject storage on navigation
          if (storageByOrigin.size > 0) {
            page.on("framenavigated", (frame) =>
              handleFrameNavigated(frame, storageByOrigin, appLogger),
            );
          }
        })
        .catch((err) => {
          appLogger.error({ err }, "[LoggerActor] Failed to get page from target");
        });
    }
  };

  browser.instance.on("targetcreated", targetCreatedHandler);

  // Attach to existing targets
  browser.instance.targets().forEach((target) => {
    targetCreatedHandler(target);
  });

  return () => {
    console.log("[LoggerActor] Shutting down");
    browser.instance.off("targetcreated", targetCreatedHandler);
  };
}
