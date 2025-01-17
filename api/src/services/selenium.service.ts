import { EventEmitter } from "events";
import { ChildProcess, spawn } from "child_process";
import { BrowserLauncherOptions, BrowserEvent, BrowserEventType } from "../types";
import path from "path";
import { FastifyBaseLogger } from "fastify";

export class SeleniumService extends EventEmitter {
  private seleniumProcess: ChildProcess | null = null;
  private seleniumServerUrl: string = "http://localhost:4444";
  private port: number = 4444;
  private launchOptions?: BrowserLauncherOptions;
  private logger: FastifyBaseLogger;

  constructor(logger: FastifyBaseLogger) {
    super();
    this.logger = logger;
  }

  public async getChromeArgs(): Promise<string[]> {
    const { options, userAgent } = this.launchOptions ?? {};
    return [
      "disable-dev-shm-usage",
      "no-sandbox",
      "enable-javascript",
      userAgent ? `user-agent=${userAgent}` : "",
      options?.proxyUrl ? `proxy-server=${options.proxyUrl}` : "",
      ...(options?.args?.map((arg) => (arg.startsWith("--") ? arg.slice(2) : arg)) || []),
    ].filter(Boolean);
  }

  public async launch(launchOptions: BrowserLauncherOptions): Promise<void> {
    this.launchOptions = launchOptions;

    if (this.seleniumProcess) {
      await this.close();
    }

    const projectRoot = path.resolve(__dirname, "../../");
    const seleniumServerPath = path.join(projectRoot, "selenium", "server", "selenium-server.jar");

    const seleniumArgs = ["-jar", seleniumServerPath, "standalone"];

    this.seleniumProcess = spawn("java", seleniumArgs);
    this.seleniumServerUrl = `http://localhost:${this.port}`;

    this.seleniumProcess.stdout?.on("data", (data) => {
      this.logger.info(`Selenium stdout: ${data}`);
      this.postLog({
        type: BrowserEventType.Console,
        text: JSON.stringify({ type: BrowserEventType.Console, message: `${data}` }),
        timestamp: new Date(),
      });
    });

    this.seleniumProcess.stderr?.on("data", (data) => {
      this.logger.error(`Selenium stderr: ${data}`);
      this.postLog({
        type: BrowserEventType.Error,
        text: JSON.stringify({ type: BrowserEventType.Error, error: `${data}` }),
        timestamp: new Date(),
      });
    });

    this.seleniumProcess.on("close", (code) => {
      this.logger.info(`Selenium process exited with code ${code}`);
      this.seleniumProcess = null;
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Selenium server failed to start within the timeout period"));
      }, 15000); // 15 seconds timeout

      this.seleniumProcess!.stdout?.on("data", (data) => {
        if (data.toString().includes("Started Selenium Standalone")) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
  }

  public close(): void {
    if (this.seleniumProcess) {
      this.seleniumProcess.kill("SIGINT");
      this.seleniumProcess = null;
    }
  }

  public getSeleniumServerUrl(): string {
    return this.seleniumServerUrl;
  }

  private async postLog(browserLog: BrowserEvent) {
    if (!this.launchOptions?.logSinkUrl) {
      return;
    }
    await fetch(this.launchOptions.logSinkUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(browserLog),
    });
  }
}
