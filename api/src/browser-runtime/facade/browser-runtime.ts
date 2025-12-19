import { EventEmitter } from "events";
import { createActor, waitFor, Actor, Snapshot } from "xstate";
import { browserMachine } from "../machine/browser.machine.js";
import {
  RuntimeConfig,
  BrowserRef,
  MachineContext,
  SupervisorEvent,
  BrowserLauncher,
} from "../types.js";
import { BrowserPlugin } from "../plugins/base-plugin.js";
import { PuppeteerLauncher } from "../drivers/puppeteer-launcher.js";

export class BrowserRuntime extends EventEmitter {
  private actor: Actor<typeof browserMachine>;
  private plugins: BrowserPlugin[] = [];

  constructor(options?: { launcher?: BrowserLauncher }) {
    super();
    const launcher = options?.launcher ?? new PuppeteerLauncher();
    this.actor = createActor(browserMachine, {
      input: { launcher },
    });

    this.actor.subscribe((snapshot) => {
      if (snapshot.matches("ready")) {
        this.emit("ready", snapshot.context.browser);
      }
      if (snapshot.matches("failed")) {
        this.emit("error", snapshot.context.error);
      }
    });

    this.actor.start();
  }

  registerPlugin(plugin: BrowserPlugin): void {
    this.plugins.push(plugin);
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

  getState(): string {
    const value = this.actor.getSnapshot().value;
    return typeof value === "string" ? value : JSON.stringify(value);
  }
}
