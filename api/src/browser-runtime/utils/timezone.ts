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

const FETCH_TIMEOUT = 2000;

export async function fetchTimezone(proxyUrl?: string, serviceUrl?: string): Promise<string> {
  const url = serviceUrl || "https://ipinfo.io/json";
  const services: TimezoneService[] = [
    {
      name: new URL(url).hostname,
      url: url,
      parseTimezone: (data) => data?.timezone || null,
    },
  ];

  const agent = proxyUrl
    ? proxyUrl.startsWith("socks")
      ? new SocksProxyAgent(proxyUrl)
      : new HttpsProxyAgent(proxyUrl)
    : undefined;

  const servicePromises = services.map(async (service) => {
    try {
      const response = await axios.get(service.url, {
        httpAgent: agent,
        httpsAgent: agent,
        timeout: FETCH_TIMEOUT,
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
      throw new Error(`${service.name}: ${errorMessage}`);
    }
  });

  try {
    const result = await Promise.any(servicePromises);
    return result.timezone!;
  } catch (error: unknown) {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  }
}
