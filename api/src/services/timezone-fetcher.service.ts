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

  private startFetch(proxyUrl: string): Promise<TimezoneFetchResult> {
    const existing = this.fetchPromises.get(proxyUrl);
    if (existing) {
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
    const isSocks = proxyUrl.startsWith("socks");
    const agent = isSocks ? new SocksProxyAgent(proxyUrl) : new HttpsProxyAgent(proxyUrl);

    const servicePromises = this.services.map(async (service) => {
      try {
        const response = await axios.get(service.url, {
          httpAgent: agent,
          httpsAgent: agent,
          timeout: this.FETCH_TIMEOUT,
        });

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
        this.logger.debug(`[TimezoneFetcher] ${service.name} failed: ${errorMessage}`);
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

      this.logger.warn(`[TimezoneFetcher] All services failed for ${proxyUrl}: ${errorMessage}`);

      return {
        timezone: null,
        error: errorMessage,
      };
    }
  }
}
