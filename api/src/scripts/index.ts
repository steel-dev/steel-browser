import fs from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";

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
}): string => {
  const fingerprintScript = loadScript("fingerprint.js");

  const safeStringValue = (value: string | undefined, fallback: string): string => {
    return JSON.stringify(value || fallback);
  };

  return `
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
  `;
};
