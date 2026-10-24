import type { Browser } from "puppeteer-core";
import { BasePlugin, ShutdownReason } from "../cdp/plugins/core/base-plugin.js";
import type { CommandEngine } from "./engine.js";

export interface SessionSource {
  id(): string;
}

export class CommandsPlugin extends BasePlugin {
  constructor(
    private readonly engine: CommandEngine,
    private readonly sessions: SessionSource,
  ) {
    super({ name: "commands" });
  }

  onSessionStart() {
    this.engine.prepare(this.sessions.id());
  }

  async onBrowserLaunch(browser: Browser) {
    this.engine.browserLaunched(browser);
  }

  onBrowserReady() {
    this.engine.browserReady();
  }

  async onBrowserClose(browser: Browser) {
    this.engine.browserClosed(browser);
  }

  async onBeforeSessionEnd() {
    this.engine.sessionEnded();
  }

  async onShutdown(reason: ShutdownReason) {
    if (reason === ShutdownReason.MODE_SWITCH) {
      this.engine.sessionEnded();
    }
  }
}
