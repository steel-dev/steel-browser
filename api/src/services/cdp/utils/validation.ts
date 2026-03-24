import { FastifyBaseLogger } from "fastify";
import { BrowserLauncherOptions } from "../../../types/index.js";
import { ConfigurationError, ConfigurationField } from "../errors/launch-errors.js";

/**
 * Compares two Promise values by resolving them and checking if their serialized
 * representations are equal.
 * @param current - Current value or Promise<value>
 * @param next - Next value or Promise<value>
 * @returns Promise<boolean> - True if serialized values are equal
 */
export async function comparePromiseValues<T>(
  current: T | Promise<T>,
  next: T | Promise<T>,
): Promise<boolean> {
  try {
    const [currentValue, nextValue] = await Promise.all([
      Promise.resolve(current),
      Promise.resolve(next),
    ]);
    return JSON.stringify(currentValue) === JSON.stringify(nextValue);
  } catch (error) {
    // If either promise rejects, consider them not equal
    return false;
  }
}

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

/**
 * Validates and resolves the timezone configuration
 * @param logger - Fastify logger instance for warning messages
 * @param timezonePromise - Promise resolving to the timezone string
 * @param timeoutMs - Maximum time to wait for timezone resolution (default: 10000ms)
 * @returns Resolved and validated timezone string
 * @throws ConfigurationError if the timezone is invalid or cannot be resolved
 */
export async function validateTimezone(
  logger: FastifyBaseLogger,
  timezonePromise: Promise<string>,
  timeoutMs: number = 10000,
): Promise<string> {
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Timezone validation timeout after ${timeoutMs}ms`));
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

export async function isSimilarConfig(
  logger: FastifyBaseLogger,
  current?: BrowserLauncherOptions,
  next?: BrowserLauncherOptions,
): Promise<boolean> {
  if (!current || !next) {
    logger.info({ current, next }, "[isSimilarConfig] early exit");
    return false;
  }

  // Start timezone comparison immediately (don't await yet)
  // This allows the Promise to resolve in parallel with our synchronous checks
  const timezoneComparisonPromise = comparePromiseValues(
    current.timezone || Promise.resolve(""),
    next.timezone || Promise.resolve(""),
  );

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

  const timezoneMatch = await timezoneComparisonPromise;

  const checks: Record<string, boolean> = {
    headless: currentHeadless === nextHeadless,
    proxy: currentProxy === nextProxy,
    userAgent: currentUserAgent === nextUserAgent,
    userDataDir: currentUserDataDir === nextUserDataDir,
    skipFingerprint: currentSkipFingerprint === nextSkipFingerprint,
    width: currentWidth === nextWidth,
    height: currentHeight === nextHeight,
    blockAds: currentBlockAds === nextBlockAds,
    args: JSON.stringify(currentArgs) === JSON.stringify(nextArgs),
    extensions: JSON.stringify(currentExt) === JSON.stringify(nextExt),
    extra: JSON.stringify(currentExtra) === JSON.stringify(nextExtra),
    userPreferences:
      JSON.stringify(current.userPreferences) === JSON.stringify(next.userPreferences),
    deviceConfig: JSON.stringify(current.deviceConfig) === JSON.stringify(next.deviceConfig),
    timezone: timezoneMatch,
  };

  const mismatches = Object.entries(checks)
    .filter(([, match]) => !match)
    .map(([field]) => field);

  if (mismatches.length > 0) {
    const details: Record<string, { current: unknown; next: unknown }> = {};
    for (const field of mismatches) {
      switch (field) {
        case "headless":
          details[field] = { current: currentHeadless, next: nextHeadless };
          break;
        case "proxy":
          details[field] = { current: currentProxy, next: nextProxy };
          break;
        case "userAgent":
          details[field] = { current: currentUserAgent, next: nextUserAgent };
          break;
        case "userDataDir":
          details[field] = { current: currentUserDataDir, next: nextUserDataDir };
          break;
        case "skipFingerprint":
          details[field] = { current: currentSkipFingerprint, next: nextSkipFingerprint };
          break;
        case "width":
          details[field] = { current: currentWidth, next: nextWidth };
          break;
        case "height":
          details[field] = { current: currentHeight, next: nextHeight };
          break;
        case "blockAds":
          details[field] = { current: currentBlockAds, next: nextBlockAds };
          break;
        case "args":
          details[field] = { current: currentArgs, next: nextArgs };
          break;
        case "extensions":
          details[field] = { current: currentExt, next: nextExt };
          break;
        case "extra":
          details[field] = { current: currentExtra, next: nextExtra };
          break;
        case "userPreferences":
          details[field] = { current: current.userPreferences, next: next.userPreferences };
          break;
        case "deviceConfig":
          details[field] = { current: current.deviceConfig, next: next.deviceConfig };
          break;
        case "timezone":
          details[field] = { current: "current.timezone", next: "next.timezone" };
          break;
      }
    }
    logger.info({ mismatches, details }, "[isSimilarConfig] Mismatch detected");
  }

  return mismatches.length === 0;
}
