import { EventEmitter } from "events";
import { ChildProcess, spawn } from "child_process";
import { BrowserLauncherOptions, BrowserEvent, BrowserEventType } from "../types/index.js";
import path, { dirname } from "path";
import { FastifyBaseLogger } from "fastify";
import { fileURLToPath } from "url";

export class SeleniumService extends EventEmitter {
  private seleniumProcess: ChildProcess | null = null;
  private seleniumServerUrl: string;
  private port: number;
  private launchOptions?: BrowserLauncherOptions;
  private logger: FastifyBaseLogger;

  constructor(logger: FastifyBaseLogger, port = 4444) {
    super();
    this.logger = logger;
    this.port = port;
    this.seleniumServerUrl = `http://localhost:${port}`;
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

    const seleniumArgs = ["-jar", seleniumServerPath, "standalone", "--port", String(this.port)];

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
        cleanup();
        reject(new Error("Selenium server failed to start within the timeout period"));
      }, 15000); // 15 seconds timeout

      const onOutput = (data: Buffer | string) => {
        if (data.toString().includes("Started Selenium Standalone")) {
          cleanup();
          resolve();
        }
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        clearTimeout(timeout);
        this.seleniumProcess?.stdout?.off("data", onOutput);
        this.seleniumProcess?.off("error", onError);
      };

      this.seleniumProcess!.stdout?.on("data", onOutput);
      this.seleniumProcess!.once("error", onError);
    });
  }

  public async close(): Promise<void> {
    const process = this.seleniumProcess;
    if (!process) return;

    const waitForClose = (timeoutMs: number) =>
      new Promise<boolean>((resolve) => {
        if (process.exitCode !== null || process.signalCode !== null) {
          resolve(true);
          return;
        }
        const timer = setTimeout(() => resolve(false), timeoutMs);
        process.once("close", () => {
          clearTimeout(timer);
          resolve(true);
        });
      });

    if (process.exitCode === null && process.signalCode === null) {
      process.kill("SIGINT");
    }
    if (await waitForClose(3000)) return;
    process.kill("SIGKILL");
    if (!(await waitForClose(2000))) {
      throw new Error(`Selenium server on port ${this.port} did not stop`);
    }
  }

  public isRunning(): boolean {
    return Boolean(
      this.seleniumProcess &&
        this.seleniumProcess.exitCode === null &&
        this.seleniumProcess.signalCode === null,
    );
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
