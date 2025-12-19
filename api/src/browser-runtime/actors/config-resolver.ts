import { mkdir } from "fs/promises";
import os from "os";
import path from "path";
import { ResolvedConfig, RuntimeConfig } from "../types.js";
import { fetchTimezone } from "./timezone.js";
import { deepMerge } from "../utils.js";

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

  return {
    ...rawConfig,
    timezone,
    userDataDir,
    headless: rawConfig.headless ?? true,
    userPreferences: mergedUserPreferences,
  };
}
