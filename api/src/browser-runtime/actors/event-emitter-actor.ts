import { EventEmitter } from "events";
import { BrowserRef, BrowserLauncher, SupervisorEvent } from "../types.js";

export interface EventEmitterInput {
  browser: BrowserRef;
  launcher: BrowserLauncher;
  emitter: EventEmitter;
}

export function startEventEmitter(
  input: EventEmitterInput,
  _sendBack: (event: SupervisorEvent) => void,
): () => void {
  const { browser, launcher, emitter } = input;

  const targetCreatedHandler = (target: any) => {
    emitter.emit("targetCreated", {
      type: "targetCreated",
      data: { target },
      timestamp: Date.now(),
    });
  };

  const targetDestroyedHandler = (targetId: string) => {
    emitter.emit("targetDestroyed", {
      type: "targetDestroyed",
      data: { targetId },
      timestamp: Date.now(),
    });
  };

  const removeCreated = launcher.onTargetCreated(browser, targetCreatedHandler);
  const removeDestroyed = launcher.onTargetDestroyed(browser, targetDestroyedHandler);

  return () => {
    removeCreated();
    removeDestroyed();
  };
}
