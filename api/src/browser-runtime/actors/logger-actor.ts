import { EventEmitter } from "events";
import { BrowserRef, ResolvedConfig, SupervisorEvent } from "../types.js";

export interface LoggerInput {
  browser: BrowserRef;
  config: ResolvedConfig;
}

export function startLogger(
  input: LoggerInput,
  sendBack: (event: SupervisorEvent) => void,
): () => void {
  const { browser, config } = input;
  console.log(`[LoggerActor] Starting for session: ${config.sessionId}`);

  // STUB: In a real implementation, we would:
  // 1. Initialize LogStorage (DuckDB or InMemory)
  // 2. Subscribe to browser/page events
  // 3. Record events to storage

  // For now, let's just log target events as a proof of concept
  const targetCreatedHandler = (target: any) => {
    console.log(`[LoggerActor] Target created: ${target.type()} ${target.url()}`);
  };

  browser.instance.on("targetcreated", targetCreatedHandler);

  return () => {
    console.log("[LoggerActor] Shutting down");
    browser.instance.off("targetcreated", targetCreatedHandler);
  };
}
