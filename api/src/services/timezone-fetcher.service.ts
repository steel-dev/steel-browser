import { FastifyBaseLogger } from "fastify";
import axios, { AxiosError } from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

export interface TimezoneFetchResult {
  timezone: string | null;
  error?: string;
}

export class TimezoneFetcher {
  private logger: FastifyBaseLogger;
  private fetchPromises: Map<string, Promise<TimezoneFetchResult>> = new Map();
  private readonly FETCH_TIMEOUT = 5000;

  constructor(logger: FastifyBaseLogger) {
    this.logger = logger;
  }

  private startFetch(proxyUrl: string): Promise<TimezoneFetchResult> {
    const existing = this.fetchPromises.get(proxyUrl);
    if (existing) {
      this.logger.debug(`[TimezoneFetcher] Reusing existing fetch for ${proxyUrl}`);
      return existing;
    }

    const fetchPromise = this.fetchTimezoneInternal(proxyUrl);

    this.fetchPromises.set(proxyUrl, fetchPromise);

    fetchPromise.finally(() => {
      this.fetchPromises.delete(proxyUrl);
    });

    return fetchPromise;
  }

  public async getTimezone(proxyUrl: string, fallback?: string): Promise<string> {
    try {
      const result = await this.startFetch(proxyUrl);
      if (result.timezone) {
        return result.timezone;
      }
    } catch (error) {
      this.logger.warn(`[TimezoneFetcher] Failed to fetch timezone: ${error}`);
    }

    return fallback || Intl.DateTimeFormat().resolvedOptions().timeZone;
  }

  private async fetchTimezoneInternal(proxyUrl: string): Promise<TimezoneFetchResult> {
    try {
      const isSocks = proxyUrl.startsWith("socks");
      const agent = isSocks ? new SocksProxyAgent(proxyUrl) : new HttpsProxyAgent(proxyUrl);

      this.logger.debug(`[TimezoneFetcher] Fetching timezone information for ${proxyUrl}`);

      const response = await axios.get("http://ip-api.com/json", {
        httpAgent: agent,
        httpsAgent: agent,
        timeout: this.FETCH_TIMEOUT,
      });

      if (response.data && response.data.status === "success" && response.data.timezone) {
        const result: TimezoneFetchResult = {
          timezone: response.data.timezone,
        };

        return result;
      } else {
        throw new Error(`Invalid response: ${response.data?.status || "unknown"}`);
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof AxiosError ? error.message : String(error);
      this.logger.warn(
        `[TimezoneFetcher] Failed to fetch timezone for ${proxyUrl}: ${errorMessage}`,
      );

      const result: TimezoneFetchResult = {
        timezone: null,
        error: errorMessage,
      };

      return result;
    }
  }
}
