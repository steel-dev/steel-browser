import fs from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import { generateEnhancedEvasions } from "./enhanced-evasions.js";
import { createPermissionsAndExtensionsScript } from "./permissions-and-extensions.js";
import { createPlatformGPUOverride } from "./platform-gpu-override.js";

const SCRIPTS_DIR = path.join(dirname(fileURLToPath(import.meta.url)));

export const loadScript = (scriptName: string): string => {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName);
  return fs.readFileSync(scriptPath, "utf-8");
};

const FIXED_VERSION = "WebGL 1.0 (OpenGL ES 2.0 Chromium)";
const FIXED_SHADING_LANGUAGE_VERSION = "WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)";

export const loadFingerprintScript = ({
  fixedVendor,
  fixedRenderer,
  fixedHardwareConcurrency,
  fixedDeviceMemory,
  fixedPlatform,
  fixedVersion = FIXED_VERSION,
  fixedShadingLanguageVersion = FIXED_SHADING_LANGUAGE_VERSION,
  fixedArchitecture,
  fixedBitness,
  fixedModel,
  fixedPlatformVersion,
  fixedUaFullVersion,
  fixedBrands,
  enableEnhancedEvasions = true,
}: {
  fixedVendor: string | undefined;
  fixedRenderer: string | undefined;
  fixedHardwareConcurrency: number;
  fixedDeviceMemory: number;
  fixedVersion?: string;
  fixedShadingLanguageVersion?: string;
  fixedPlatform?: string;
  fixedArchitecture?: string;
  fixedBitness?: string;
  fixedModel?: string;
  fixedPlatformVersion?: string;
  fixedUaFullVersion?: string;
  fixedBrands: Array<{ brand: string; version: string }>;
  enableEnhancedEvasions?: boolean;
}): string => {
  const fingerprintScript = loadScript("fingerprint.js");

  const safeStringValue = (value: string | undefined, fallback: string): string => {
    return JSON.stringify(value || fallback);
  };

  // CRITICAL: Platform/GPU override MUST execute FIRST
  // This ensures navigator.platform and WebGL GPU are overridden before
  // any detection scripts run
  const platformGPUOverride = createPlatformGPUOverride({
    platform: fixedPlatform || "Linux x86_64",
    gpuVendor: fixedVendor || "Google Inc.",
    gpuRenderer:
      fixedRenderer || "ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)",
  });

  const enhancedEvasions = enableEnhancedEvasions
    ? generateEnhancedEvasions({
        platform: fixedPlatform || "Linux x86_64",
        userAgentData: {
          brands: fixedBrands,
          mobile: false,
          platform: fixedPlatform || "Linux",
        },
      })
    : "";

  // Permissions API and Extensions mock
  const permissionsAndExtensions = createPermissionsAndExtensionsScript();

  return `
    // ====================================================================
    // PLATFORM AND GPU OVERRIDE - MUST RUN FIRST
    // ====================================================================
    ${platformGPUOverride};

    // ====================================================================
    // LEGACY FINGERPRINT SCRIPT (obfuscated)
    // ====================================================================
    (function() {
      const FIXED_VENDOR = ${safeStringValue(fixedVendor, "Google Inc.")};
      const FIXED_RENDERER = ${safeStringValue(
        fixedRenderer,
        "ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)",
      )};
      const FIXED_VERSION = ${safeStringValue(fixedVersion, "WebGL 1.0 (OpenGL ES 2.0 Chromium)")};
      const FIXED_SHADING_LANGUAGE_VERSION = ${safeStringValue(
        fixedShadingLanguageVersion,
        "WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)",
      )};
      const FIXED_HARDWARE_CONCURRENCY = ${fixedHardwareConcurrency};
      const FIXED_DEVICE_MEMORY = ${fixedDeviceMemory};
      const FIXED_PLATFORM = ${safeStringValue(fixedPlatform, "Linux x86_64")};
      const FIXED_ARCHITECTURE = ${safeStringValue(fixedArchitecture, "x86")};
      const FIXED_BITNESS = ${safeStringValue(fixedBitness, "64")};
      const FIXED_MODEL = ${safeStringValue(fixedModel, "")};
      const FIXED_PLATFORM_VERSION = ${safeStringValue(fixedPlatformVersion, "15.0.0")};
      const FIXED_UA_FULL_VERSION = ${safeStringValue(fixedUaFullVersion, "131.0.6778.86")};
      const FIXED_BRANDS = ${JSON.stringify(fixedBrands)};
      ${fingerprintScript}
    })();

    // ====================================================================
    // ENHANCED EVASIONS
    // ====================================================================
    ${enhancedEvasions};

    // ====================================================================
    // PERMISSIONS AND EXTENSIONS
    // ====================================================================
    ${permissionsAndExtensions};
  `;
};
