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
  fixedVersion = FIXED_VERSION,
  fixedShadingLanguageVersion = FIXED_SHADING_LANGUAGE_VERSION,
}: {
  fixedVendor: string;
  fixedRenderer: string;
  fixedHardwareConcurrency: number;
  fixedDeviceMemory: number;
  fixedVersion?: string;
  fixedShadingLanguageVersion?: string;
}): string => {
  const fingerprintScript = loadScript("fingerprint.js");

  return `
    const FIXED_VENDOR = "${fixedVendor}";
    const FIXED_RENDERER = "${fixedRenderer}";
    const FIXED_VERSION = "${fixedVersion}";
    const FIXED_SHADING_LANGUAGE_VERSION = "${fixedShadingLanguageVersion}";
    const FIXED_HARDWARE_CONCURRENCY = ${fixedHardwareConcurrency};
    const FIXED_DEVICE_MEMORY = ${fixedDeviceMemory};
    ${fingerprintScript}
  `;
};
