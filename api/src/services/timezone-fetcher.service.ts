import { FastifyBaseLogger } from "fastify";
import axios, { AxiosError } from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";

export interface TimezoneFetchResult {
  timezone: string | null;
  error?: string;
  service?: string;
}

interface TimezoneService {
  name: string;
  url: string;
  parseTimezone: (data: any) => string | null;
}

export class TimezoneFetcher {
  private logger: FastifyBaseLogger;
  private fetchPromises: Map<string, Promise<TimezoneFetchResult>> = new Map();
  private readonly FETCH_TIMEOUT = 2000;

  private readonly services: TimezoneService[] = [
    {
      name: "ip-api.com",
      url: "http://ip-api.com/json",
      parseTimezone: (data) => (data?.status === "success" ? data.timezone : null),
    },
    {
      name: "ipinfo.io",
      url: "https://ipinfo.io/json",
      parseTimezone: (data) => data?.timezone || null,
    },
  ];

  constructor(logger: FastifyBaseLogger) {
    this.logger = logger;
  }

  private startFetch(proxyUrl?: string): Promise<TimezoneFetchResult> {
    const cacheKey = proxyUrl || "direct";
    const existing = this.fetchPromises.get(cacheKey);
    if (existing) {
      return existing;
    }

    const fetchPromise = this.fetchTimezoneInternal(proxyUrl);

    this.fetchPromises.set(cacheKey, fetchPromise);

    fetchPromise.finally(() => {
      this.fetchPromises.delete(cacheKey);
    });

    return fetchPromise;
  }

  public async getTimezone(proxyUrl?: string, fallback?: string): Promise<string> {
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

  private async fetchTimezoneInternal(proxyUrl?: string): Promise<TimezoneFetchResult> {
    const agent = proxyUrl
      ? proxyUrl.startsWith("socks")
        ? new SocksProxyAgent(proxyUrl)
        : new HttpsProxyAgent(proxyUrl)
      : undefined;

    const servicePromises = this.services.map(async (service) => {
      try {
        const response = await axios.get(service.url, {
          httpAgent: agent,
          httpsAgent: agent,
          timeout: this.FETCH_TIMEOUT,
        });
        // log the response data
        this.logger.info(
          `[TimezoneFetcher] ${service.name} response: ${JSON.stringify(response.data)}`,
        );

        const timezone = service.parseTimezone(response.data);

        if (timezone) {
          return {
            timezone,
            service: service.name,
          };
        } else {
          throw new Error(`No timezone found in response from ${service.name}`);
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof AxiosError ? error.message : String(error);
        this.logger.warn(`[TimezoneFetcher] ${service.name} failed: ${errorMessage}`);
        throw new Error(`${service.name}: ${errorMessage}`);
      }
    });

    try {
      const result = await Promise.any(servicePromises);
      return result;
    } catch (error: unknown) {
      const errorMessage =
        error instanceof AggregateError
          ? `All services failed: ${error.errors.map((e) => e.message).join(", ")}`
          : error instanceof Error
          ? error.message
          : String(error);

      const context = proxyUrl ? `with proxy ${proxyUrl}` : "with direct connection";
      this.logger.warn(`[TimezoneFetcher] All services failed ${context}: ${errorMessage}`);

      return {
        timezone: null,
        error: errorMessage,
      };
    }
  }
}
