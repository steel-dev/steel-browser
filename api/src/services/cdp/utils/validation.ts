import { BrowserLauncherOptions } from "../../../types/index.js";
import { ConfigurationError, ConfigurationField } from "../errors/launch-errors.js";

/**
 * Validates a given launch configuration (not conclusive)
 */
export function validateLaunchConfig(config: BrowserLauncherOptions): void {
  // Validate dimensions
  if (config.dimensions) {
    if (config.dimensions.width <= 0 || config.dimensions.height <= 0) {
      throw new ConfigurationError(
        "Dimensions must be positive numbers",
        ConfigurationField.DIMENSIONS,
        config.dimensions,
      );
    }
    if (config.dimensions.width > 7680 || config.dimensions.height > 4320) {
      throw new ConfigurationError(
        "Dimensions are unreasonably large (max 7680x4320)",
        ConfigurationField.DIMENSIONS,
        config.dimensions,
      );
    }
  }

  // Validates proxy URL format
  if (config.options.proxyUrl) {
    try {
      new URL(config.options.proxyUrl);
    } catch {
      throw new ConfigurationError(
        `Invalid proxy URL format: ${config.options.proxyUrl}`,
        ConfigurationField.PROXY_URL,
        config.options.proxyUrl,
      );
    }
  }
}

export async function validateTimezone(
  timezonePromise: Promise<string>,
  fallbackTimezone: string,
  timeoutMs: number = 3000,
): Promise<string> {
  try {
    const timeoutPromise = new Promise<string>((resolve) => {
      setTimeout(() => {
        resolve(fallbackTimezone);
      }, timeoutMs);
    });

    const timezone = await Promise.race([timezonePromise, timeoutPromise]);

    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
      return timezone;
    } catch (timezoneError) {
      throw new ConfigurationError(
        `Invalid timezone resolved: ${timezone}`,
        ConfigurationField.TIMEZONE,
        timezone,
      );
    }
  } catch (error) {
    if (error instanceof ConfigurationError) {
      throw error;
    }
    throw new ConfigurationError(
      `Failed to resolve timezone: ${error}`,
      ConfigurationField.TIMEZONE,
      undefined,
    );
  }
}
