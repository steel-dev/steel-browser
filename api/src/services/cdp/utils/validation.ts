import { FastifyBaseLogger } from "fastify";
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
  if (!current || !next) {
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

  const currentUserAgent = current.userAgent || "";
  const nextUserAgent = next.userAgent || "";

  const currentUserDataDir = current.userDataDir || "";
  const nextUserDataDir = next.userDataDir || "";

  const currentTimezone = current.timezone || "";
  const nextTimezone = next.timezone || "";

  const currentSkipFingerprint = current.skipFingerprintInjection ?? false;
  const nextSkipFingerprint = next.skipFingerprintInjection ?? false;

  const currentWidth = current.dimensions?.width ?? 1920;
  const nextWidth = next.dimensions?.width ?? 1920;

  const currentHeight = current.dimensions?.height ?? 1080;
  const nextHeight = next.dimensions?.height ?? 1080;

  const {
    session: _s1,
    streaming: _w1,
    ...currentExtra
  } = (current.extra ?? {}) as Record<string, unknown>;
  const {
    session: _s2,
    streaming: _w2,
    ...nextExtra
  } = (next.extra ?? {}) as Record<string, unknown>;

  console.log("currentUserAgent", currentUserAgent, "////", nextUserAgent);
  console.log("currentUserDataDir", currentUserDataDir, "////", nextUserDataDir);
  console.log("currentSkipFingerprint", currentSkipFingerprint, "////", nextSkipFingerprint);
  console.log("currentWidth", currentWidth, "////", nextWidth);
  console.log("currentHeight", currentHeight, "////", nextHeight);
  console.log("currentBlockAds", currentBlockAds, "////", nextBlockAds);
  console.log(
    "currentTimezone",
    JSON.stringify(currentTimezone),
    "////",
    JSON.stringify(nextTimezone),
  );
  console.log("currentArgs", JSON.stringify(currentArgs), "////", JSON.stringify(nextArgs));
  console.log("currentExt", JSON.stringify(currentExt), "////", JSON.stringify(nextExt));
  console.log("currentExtra", JSON.stringify(currentExtra), "////", JSON.stringify(nextExtra));
  console.log(
    "current.userPreferences",
    JSON.stringify(current.userPreferences),
    "////",
    JSON.stringify(next.userPreferences),
  );
  console.log(
    "current.deviceConfig",
    JSON.stringify(current.deviceConfig),
    "////",
    JSON.stringify(next.deviceConfig),
  );
  console.log(
    "### SIMILAR?",
    currentHeadless === nextHeadless &&
      currentProxy === nextProxy &&
      currentUserAgent === nextUserAgent &&
      currentUserDataDir === nextUserDataDir &&
      currentSkipFingerprint === nextSkipFingerprint &&
      currentWidth === nextWidth &&
      currentHeight === nextHeight &&
      currentBlockAds === nextBlockAds &&
      JSON.stringify(currentTimezone) === JSON.stringify(nextTimezone) &&
      JSON.stringify(currentArgs) === JSON.stringify(nextArgs) &&
      JSON.stringify(currentExt) === JSON.stringify(nextExt) &&
      JSON.stringify(currentExtra) === JSON.stringify(nextExtra) &&
      JSON.stringify(current.userPreferences) === JSON.stringify(next.userPreferences) &&
      JSON.stringify(current.deviceConfig) === JSON.stringify(next.deviceConfig),
  );

  return (
    currentHeadless === nextHeadless &&
    currentProxy === nextProxy &&
    currentUserAgent === nextUserAgent &&
    currentUserDataDir === nextUserDataDir &&
    currentSkipFingerprint === nextSkipFingerprint &&
    currentWidth === nextWidth &&
    currentHeight === nextHeight &&
    currentBlockAds === nextBlockAds &&
    JSON.stringify(currentTimezone) === JSON.stringify(nextTimezone) &&
    JSON.stringify(currentArgs) === JSON.stringify(nextArgs) &&
    JSON.stringify(currentExt) === JSON.stringify(nextExt) &&
    JSON.stringify(currentExtra) === JSON.stringify(nextExtra) &&
    JSON.stringify(current.userPreferences) === JSON.stringify(next.userPreferences) &&
    JSON.stringify(current.deviceConfig) === JSON.stringify(next.deviceConfig)
  );
}
