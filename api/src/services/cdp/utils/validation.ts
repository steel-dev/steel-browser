import { BrowserLauncherOptions } from "../../../types";
import { ConfigurationError, ResourceError } from "../errors/launch-errors";

/**
 * Validates a givenlaunch configuration (not conclusive)
 */
export function validateLaunchConfig(config: BrowserLauncherOptions): void {
  // Validate dimensions
  if (config.dimensions) {
    if (config.dimensions.width <= 0 || config.dimensions.height <= 0) {
      throw new ConfigurationError("Dimensions must be positive numbers", "dimensions", config.dimensions);
    }
    if (config.dimensions.width > 7680 || config.dimensions.height > 4320) {
      throw new ConfigurationError(
        "Dimensions are unreasonably large (max 7680x4320)",
        "dimensions",
        config.dimensions,
      );
    }
  }

  // Validates timezone
  if (config.timezone) {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: config.timezone });
    } catch {
      throw new ConfigurationError(`Invalid timezone: ${config.timezone}`, "timezone", config.timezone);
    }
  }

  // Validates proxy URL format
  if (config.options.proxyUrl) {
    try {
      new URL(config.options.proxyUrl);
    } catch {
      throw new ConfigurationError(
        `Invalid proxy URL format: ${config.options.proxyUrl}`,
        "proxyUrl",
        config.options.proxyUrl,
      );
    }
  }
}
