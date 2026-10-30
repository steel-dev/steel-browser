import { EventEmitter } from "events";
import { ChildProcess, spawn } from "child_process";
import { BrowserLauncherOptions, BrowserEvent, BrowserEventType } from "../types/index.js";
import path, { dirname } from "path";
import { FastifyBaseLogger } from "fastify";
import { fileURLToPath } from "url";

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

    const projectRoot = path.resolve(dirname(fileURLToPath(import.meta.url)), "../../");
    const seleniumServerPath = path.join(projectRoot, "selenium", "server", "selenium-server.jar");

    const seleniumArgs = ["-jar", seleniumServerPath, "standalone"];

    const proc = spawn("java", seleniumArgs);
    this.seleniumProcess = proc;
    this.seleniumServerUrl = `http://localhost:${this.port}`;

    proc.on("error", (err) => {
      this.logger.error(`Selenium process error: ${err}`);
      this.postLog({
        type: BrowserEventType.Error,
        text: JSON.stringify({ type: BrowserEventType.Error, error: `${err}` }),
        timestamp: new Date(),
      }).catch(() => {});
    });

    proc.stdout?.on("data", (data) => {
      this.logger.info(`Selenium stdout: ${data}`);
      this.postLog({
        type: BrowserEventType.Console,
        text: JSON.stringify({ type: BrowserEventType.Console, message: `${data}` }),
        timestamp: new Date(),
      });
    });

    proc.stderr?.on("data", (data) => {
      this.logger.error(`Selenium stderr: ${data}`);
      this.postLog({
        type: BrowserEventType.Error,
        text: JSON.stringify({ type: BrowserEventType.Error, error: `${data}` }),
        timestamp: new Date(),
      });
    });

    proc.on("close", (code) => {
      this.logger.info(`Selenium process exited with code ${code}`);
      if (this.seleniumProcess === proc) {
        this.seleniumProcess = null;
      }
    });
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;

        const cleanup = () => {
          clearTimeout(timeout);
          proc.stdout?.off("data", onData);
          proc.off("error", onError);
          proc.off("close", onClose);
        };

        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error("Selenium server failed to start within the timeout period"));
        }, 15000); // 15 seconds timeout

        const onData = (data: Buffer | string) => {
          if (data.toString().includes("Started Selenium Standalone")) {
            if (settled) return;
            settled = true;
            cleanup();
            resolve();
          }
        };

        const onError = (err: Error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(err);
        };

        const onClose = (code: number | null) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error(`Selenium process exited prematurely with code ${code}`));
        };

        proc.stdout?.on("data", onData);
        proc.on("error", onError);
        proc.on("close", onClose);
      });
    } catch (error) {
      if (this.seleniumProcess === proc) {
        this.close();
      }
      throw error;
    }
  }

  public close(): void {
    if (this.seleniumProcess) {
      try {
        this.seleniumProcess.kill("SIGINT");
      } catch {
        // Process might not be running or already killed
      }
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
    try {
      await fetch(this.launchOptions.logSinkUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(browserLog),
      });
    } catch (err) {
      this.logger.warn({ err }, "Failed to post log to logSinkUrl");
    }
  }
}
