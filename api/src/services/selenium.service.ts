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
    const logSinkUrl = launchOptions?.logSinkUrl;

    if (this.seleniumProcess) {
      this.close();
    }

    const projectRoot = path.resolve(dirname(fileURLToPath(import.meta.url)), "../../");
    const seleniumServerPath = path.join(projectRoot, "selenium", "server", "selenium-server.jar");

    const seleniumArgs = ["-jar", seleniumServerPath, "standalone"];

    const seleniumProcess = spawn("java", seleniumArgs);
    this.seleniumProcess = seleniumProcess;
    this.seleniumServerUrl = `http://localhost:${this.port}`;

    seleniumProcess.on("error", (err) => {
      this.logger.error({ err }, "Selenium process error");
      this.postLog(
        {
          type: BrowserEventType.Error,
          text: JSON.stringify({
            type: BrowserEventType.Error,
            error: `${err}`,
            code: (err as NodeJS.ErrnoException)?.code,
          }),
          timestamp: new Date(),
        },
        logSinkUrl,
      );
    });

    seleniumProcess.stdout?.on("data", (data) => {
      this.logger.info({ chunk: `${data}`.slice(0, 2000) }, "Selenium stdout");
      this.postLog(
        {
          type: BrowserEventType.Console,
          text: JSON.stringify({ type: BrowserEventType.Console, message: `${data}` }),
          timestamp: new Date(),
        },
        logSinkUrl,
      );
    });

    seleniumProcess.stderr?.on("data", (data) => {
      this.logger.error({ chunk: `${data}`.slice(0, 2000) }, "Selenium stderr");
      this.postLog(
        {
          type: BrowserEventType.Error,
          text: JSON.stringify({ type: BrowserEventType.Error, error: `${data}` }),
          timestamp: new Date(),
        },
        logSinkUrl,
      );
    });

    seleniumProcess.on("close", (code, signal) => {
      this.logger.info({ code, signal }, "Selenium process exited");
      if (this.seleniumProcess === seleniumProcess) {
        this.seleniumProcess = null;
      }
    });
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        let timeout: ReturnType<typeof setTimeout>;

        const cleanup = () => {
          clearTimeout(timeout);
          seleniumProcess.stdout?.off("data", onData);
          seleniumProcess.stderr?.off("data", onData);
          seleniumProcess.off("error", onError);
          seleniumProcess.off("close", onClose);
        };

        timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error("Selenium server failed to start within the timeout period"));
        }, 15000); // 15 seconds timeout

        let output = "";
        const onData = (data: Buffer | string) => {
          output += data.toString();
          if (output.includes("Started Selenium Standalone")) {
            if (settled) return;
            settled = true;
            cleanup();
            resolve();
          }
          if (output.length > 4096) output = output.slice(-4096);
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

        seleniumProcess.stdout?.on("data", onData);
        seleniumProcess.stderr?.on("data", onData);
        seleniumProcess.on("error", onError);
        seleniumProcess.on("close", onClose);
      });
    } catch (error) {
      if (this.seleniumProcess === seleniumProcess) {
        this.close();
      }
      throw error;
    }
  }

  public close(): void {
    const proc = this.seleniumProcess;
    if (!proc) {
      return;
    }
    try {
      proc.kill("SIGINT");
    } catch {
      // Process might not be running or already killed
    }
    this.seleniumProcess = null;
  }

  public getSeleniumServerUrl(): string {
    return this.seleniumServerUrl;
  }

  private async postLog(browserLog: BrowserEvent, logSinkUrl?: string) {
    if (!logSinkUrl) {
      return;
    }
    try {
      await fetch(logSinkUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(browserLog),
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      this.logger.warn({ err }, "Failed to post log to logSinkUrl");
    }
  }
}
