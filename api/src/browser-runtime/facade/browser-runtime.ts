import { EventEmitter } from "events";
import { createActor, waitFor, Actor, Snapshot } from "xstate";
import { Page } from "puppeteer-core";
import { browserMachine } from "../machine/browser.machine.js";
import { RuntimeConfig, BrowserRef, SupervisorEvent, BrowserLauncher } from "../types.js";
import { BrowserPlugin } from "../plugins/base-plugin.js";
import { PuppeteerLauncher } from "../drivers/puppeteer-launcher.js";
import { BrowserFingerprintWithHeaders } from "fingerprint-generator";
import { StateTransitionLogger } from "../logging/state-transition-logger.js";

import { BrowserLogger } from "../../services/cdp/instrumentation/browser-logger.js";
import { FastifyBaseLogger } from "fastify";
import { pino } from "pino";

export class BrowserRuntime extends EventEmitter {
  private actor: Actor<typeof browserMachine>;
  private plugins: BrowserPlugin[] = [];
  private logger: FastifyBaseLogger;
  private stateTransitionLogger?: StateTransitionLogger;

  constructor(options?: {
    launcher?: BrowserLauncher;
    instrumentationLogger?: BrowserLogger;
    appLogger?: FastifyBaseLogger;
    stateTransitionLogger?: StateTransitionLogger;
  }) {
    super();
    const launcher = options?.launcher ?? new PuppeteerLauncher();
    const appLogger = options?.appLogger ?? pino();
    this.logger = appLogger;
    this.stateTransitionLogger = options?.stateTransitionLogger;

    this.actor = createActor(browserMachine, {
      input: {
        launcher,
        instrumentationLogger: options?.instrumentationLogger,
        appLogger,
      },
    });

    let previousState: string | null = null;
    this.actor.subscribe((snapshot) => {
      const currentState =
        typeof snapshot.value === "string" ? snapshot.value : JSON.stringify(snapshot.value);

      if (previousState !== currentState) {
        if (this.stateTransitionLogger) {
          this.stateTransitionLogger.recordTransition({
            fromState: previousState,
            toState: currentState,
            event: snapshot._nodes?.[0]?.key || "unknown",
            context: { browser: !!snapshot.context.browser },
          });
        } else {
          this.logger.info(
            { from: previousState, to: currentState, event: snapshot._nodes?.[0]?.key },
            "[StateMachine] State transition",
          );
        }
        previousState = currentState;
      }

      if (snapshot.matches("ready")) {
        this.emit("ready", snapshot.context.browser);
      }
      if (snapshot.matches("failed")) {
        const err = snapshot.context.error;
        if (this.listenerCount("error") > 0) {
          this.emit("error", err);
        }
      }
    });

    this.actor.start();
  }

  getStateTransitionLogger(): StateTransitionLogger | undefined {
    return this.stateTransitionLogger;
  }

  registerPlugin(plugin: BrowserPlugin): void {
    this.plugins.push(plugin);
  }

  unregisterPlugin(pluginName: string): boolean {
    const index = this.plugins.findIndex((p) => p.name === pluginName);
    if (index !== -1) {
      this.plugins.splice(index, 1);
      return true;
    }
    return false;
  }

  getPlugin(pluginName: string): BrowserPlugin | undefined {
    return this.plugins.find((p) => p.name === pluginName);
  }

  async start(config: RuntimeConfig): Promise<BrowserRef> {
    const currentSnapshot = this.actor.getSnapshot();
    if (!currentSnapshot.matches("idle")) {
      throw new Error(`Cannot start: machine is in state ${JSON.stringify(currentSnapshot.value)}`);
    }

    this.actor.send({ type: "START", config, plugins: this.plugins });

    const snapshot = await waitFor(this.actor, (s) => s.matches("ready") || s.matches("failed"));

    if (snapshot.matches("failed")) {
      throw snapshot.context.error || new Error("Failed to start browser");
    }

    return snapshot.context.browser!;
  }

  async stop(): Promise<void> {
    this.actor.send({ type: "STOP" });
    await waitFor(this.actor, (s) => s.matches("idle"));
  }

  isRunning(): boolean {
    return this.actor.getSnapshot().matches("ready");
  }

  getBrowser(): BrowserRef | null {
    return this.actor.getSnapshot().context.browser;
  }

  getFingerprint(): BrowserFingerprintWithHeaders | null {
    return this.actor.getSnapshot().context.fingerprint;
  }

  updatePrimaryPage(page: Page): void {
    const context = this.actor.getSnapshot().context;
    if (context.browser) {
      context.browser.primaryPage = page;
    }
  }

  getState(): string {
    const value = this.actor.getSnapshot().value;
    return typeof value === "string" ? value : JSON.stringify(value);
  }
}
