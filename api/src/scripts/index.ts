import fs from "fs";
import path, { dirname } from "path";
import { fileURLToPath } from "url";

const SCRIPTS_DIR = path.join(dirname(fileURLToPath(import.meta.url)));

/** Token in fingerprint.js that is replaced with the JSON config. */
export const FINGERPRINT_CONFIG_PLACEHOLDER = "STEEL_FINGERPRINT_CONFIG";

// Used when the generated fingerprint has no videoCard. Chrome with ANGLE reports
// "Google Inc. (<GPU vendor>)" as the unmasked vendor on desktop.
const DEFAULT_DESKTOP_WEBGL_VENDOR = "Google Inc. (Intel)";
const DEFAULT_DESKTOP_WEBGL_RENDERER =
  "ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)";
const DEFAULT_MOBILE_WEBGL_VENDOR = "Qualcomm";
const DEFAULT_MOBILE_WEBGL_RENDERER = "Adreno (TM) 640";

export const loadScript = (scriptName: string): string => {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName);
  return fs.readFileSync(scriptPath, "utf-8");
};

export interface FingerprintScriptParams {
  /** WebGL UNMASKED_VENDOR_WEBGL. */
  fixedVendor: string | undefined;
  /** WebGL UNMASKED_RENDERER_WEBGL. */
  fixedRenderer: string | undefined;
  /** navigator.deviceMemory (secure contexts only, like Chrome). */
  fixedDeviceMemory: number;
  /**
   * Ignored: set natively with Emulation.setHardwareConcurrencyOverride on page and worker
   * targets (dedicated, shared and service workers accept it before they resume).
   */
  fixedHardwareConcurrency?: number;
  /** Picks the default GPU when the fingerprint has no videoCard. */
  fixedMobile?: boolean;
  /**
   * navigator.platform, patched for mobile profiles only. The native override from
   * Emulation.setUserAgentOverride is dropped on the next navigation while a second CDP
   * client is attached; on desktop the reduced value equals the native one.
   */
  fixedPlatform?: string;
  /** @deprecated Set natively with Emulation.setUserAgentOverride; ignored. */
  fixedUaPlatform?: string;
  /** @deprecated Native WebGL value; ignored. */
  fixedVersion?: string;
  /** @deprecated Native WebGL value; ignored. */
  fixedShadingLanguageVersion?: string;
  /** @deprecated Set natively with Emulation.setUserAgentOverride; ignored. */
  fixedArchitecture?: string;
  /** @deprecated Set natively with Emulation.setUserAgentOverride; ignored. */
  fixedBitness?: string;
  /** @deprecated Set natively with Emulation.setUserAgentOverride; ignored. */
  fixedModel?: string;
  /** @deprecated Set natively with Emulation.setUserAgentOverride; ignored. */
  fixedPlatformVersion?: string;
  /** @deprecated Set natively with Emulation.setUserAgentOverride; ignored. */
  fixedUaFullVersion?: string;
  /** @deprecated Set natively with Emulation.setUserAgentOverride; ignored. */
  fixedBrands?: Array<{ brand: string; version: string }>;
}

/** Values read by fingerprint.js; an absent value is not patched. */
export interface FingerprintScriptConfig {
  deviceMemory?: number;
  platform?: string;
  webglVendor?: string;
  webglRenderer?: string;
}

export const buildFingerprintConfig = (
  params: FingerprintScriptParams,
): FingerprintScriptConfig => {
  const mobile = params.fixedMobile === true;
  const deviceMemory = params.fixedDeviceMemory;
  return {
    deviceMemory: Number.isFinite(deviceMemory) && deviceMemory > 0 ? deviceMemory : undefined,
    platform: mobile && params.fixedPlatform ? params.fixedPlatform : undefined,
    webglVendor:
      params.fixedVendor || (mobile ? DEFAULT_MOBILE_WEBGL_VENDOR : DEFAULT_DESKTOP_WEBGL_VENDOR),
    webglRenderer:
      params.fixedRenderer ||
      (mobile ? DEFAULT_MOBILE_WEBGL_RENDERER : DEFAULT_DESKTOP_WEBGL_RENDERER),
  };
};

const renderFingerprintScript = (config: FingerprintScriptConfig): string => {
  const source = loadScript("fingerprint.js");
  if (!source.includes(FINGERPRINT_CONFIG_PLACEHOLDER)) {
    throw new Error(`fingerprint.js has no ${FINGERPRINT_CONFIG_PLACEHOLDER} placeholder`);
  }
  // A replacer function keeps "$&"-like sequences in the values literal.
  return source.replace(FINGERPRINT_CONFIG_PLACEHOLDER, () => JSON.stringify(config));
};

/**
 * Script for Page.addScriptToEvaluateOnNewDocument (the session needs Page.enable).
 * Patches only what CDP cannot set: navigator.deviceMemory and the WebGL unmasked
 * vendor/renderer.
 */
export const loadFingerprintScript = (params: FingerprintScriptParams): string =>
  renderFingerprintScript(buildFingerprintConfig(params));

/**
 * Script for dedicated, shared and service workers, with the same values as the page
 * (WorkerNavigator.deviceMemory, OffscreenCanvas WebGL). Send it with Runtime.evaluate
 * (no Runtime.enable needed) on the worker target while it waits for the debugger, then
 * Runtime.runIfWaitingForDebugger. A service worker target answers only after it
 * resumes: send both without awaiting the first.
 */
export const loadWorkerFingerprintScript = (params: FingerprintScriptParams): string =>
  renderFingerprintScript(buildFingerprintConfig(params));
