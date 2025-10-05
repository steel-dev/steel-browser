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

/**
 * Checks if two launch configurations are reusable
 * @param current - The current launch configuration
 * @param next - The next launch configuration
 * @returns True if the configurations are reusable, false otherwise
 */

export function isSimilarConfig(
  current?: BrowserLauncherOptions,
  next?: BrowserLauncherOptions,
): boolean {
  if (!current || !next) return false;

  // If next config has a persisted fingerprint, force browser restart
  // This ensures sticky sessions always get the correct fingerprint
  if (next.fingerprint) {
    return false;
  }

  // If userId changed, force browser restart to generate new fingerprint
  // Different users should get different fingerprints for variety
  const currentUserId = current.userId;
  const nextUserId = next.userId;
  if (currentUserId !== nextUserId) {
    return false;
  }

  const normalizeArgs = (args?: string[]) => (args || []).filter(Boolean).slice().sort();
  const normalizeExt = (ext?: string[]) => (ext || []).slice().sort();

  const currentHeadless = current.options?.headless ?? true;
  const nextHeadless = next.options?.headless ?? true;

  const currentProxy = current.options?.proxyUrl || "";
  const nextProxy = next.options?.proxyUrl || "";

  const currentArgs = normalizeArgs(current.options?.args);
  const nextArgs = normalizeArgs(next.options?.args);

  const currentExt = normalizeExt(current.extensions);
  const nextExt = normalizeExt(next.extensions);

  const currentBlockAds = current.blockAds ?? true;
  const nextBlockAds = next.blockAds ?? true;

  return (
    currentHeadless === nextHeadless &&
    currentProxy === nextProxy &&
    JSON.stringify(currentArgs) === JSON.stringify(nextArgs) &&
    JSON.stringify(currentExt) === JSON.stringify(nextExt) &&
    currentBlockAds === nextBlockAds
  );
}
