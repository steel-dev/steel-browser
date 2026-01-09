import { mkdir } from "fs/promises";
import os from "os";
import path from "path";
import { ResolvedConfig, RuntimeConfig } from "../types.js";
import { fetchTimezone } from "../utils/timezone.js";
import { deepMerge } from "../utils.js";
import { env } from "../../env.js";
import { generateFingerprint } from "../services/fingerprint.service.js";

export async function resolveConfig(rawConfig: RuntimeConfig): Promise<ResolvedConfig> {
  const timezone =
    typeof rawConfig.timezone === "string"
      ? rawConfig.timezone
      : rawConfig.timezone
      ? await rawConfig.timezone
      : await fetchTimezone(rawConfig.proxyUrl);

  const userDataDir =
    rawConfig.userDataDir || path.join(os.tmpdir(), "steel-chrome", rawConfig.sessionId);
  await mkdir(userDataDir, { recursive: true });

  const defaultUserPreferences = {
    plugins: {
      always_open_pdf_externally: true,
      plugins_disabled: ["Chrome PDF Viewer"],
    },
  };

  const mergedUserPreferences = rawConfig.userPreferences
    ? deepMerge(defaultUserPreferences, rawConfig.userPreferences)
    : defaultUserPreferences;

  let fingerprint = rawConfig.fingerprint ?? null;

  if (
    !env.SKIP_FINGERPRINT_INJECTION &&
    !rawConfig.userAgent &&
    !rawConfig.skipFingerprintInjection &&
    !fingerprint
  ) {
    fingerprint = generateFingerprint(rawConfig);
  }

  const resolvedDimensions = rawConfig.dimensions || fingerprint?.fingerprint.screen || null;
  const resolvedUserAgent = rawConfig.userAgent || fingerprint?.fingerprint.navigator.userAgent;

  return {
    ...rawConfig,
    timezone,
    userDataDir,
    headless: rawConfig.headless ?? true,
    userPreferences: mergedUserPreferences,
    fingerprint,
    dimensions: resolvedDimensions,
    userAgent: resolvedUserAgent,
    sessionContext: rawConfig.sessionContext ?? null,
  };
}
