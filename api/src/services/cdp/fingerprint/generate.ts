import {
  BrowserFingerprintWithHeaders,
  FingerprintGenerator,
  FingerprintGeneratorOptions,
} from "fingerprint-generator";
import { alignFingerprintWithBrowser, fitScreenToWindow } from "./align.js";
import { ChromeVersion, parseChromeVersion } from "./chrome-version.js";

type GeneratorOptions = Partial<FingerprintGeneratorOptions>;

export interface FingerprintGeneratorLike {
  getFingerprint(): BrowserFingerprintWithHeaders;
}

export interface GenerateFingerprintOptions {
  device: "desktop" | "mobile";
  /** Browser window size; the desktop screen is generated to fit it. */
  dimensions?: { width: number; height: number };
  /** Version of the Chrome binary, see readChromeVersion(). */
  browserVersion: ChromeVersion | null;
  locales?: string[];
  hostArch?: string;
  /**
   * Pixel ratio the browser really renders at, when it cannot be emulated for every
   * target. Headful windows run with --force-device-scale-factor=1, and Chromium refuses
   * Emulation.setDeviceMetricsOverride on out-of-process iframes ("Command can only be
   * executed on top-level targets"), so a different ratio would differ between frames.
   */
  devicePixelRatio?: number;
  logger?: { warn: (obj: object, msg: string) => void };
  createGenerator?: (options: GeneratorOptions) => FingerprintGeneratorLike;
}

const DEFAULT_LOCALES: readonly string[] = ["en-US", "en"];
const DEFAULT_DIMENSIONS = { width: 1920, height: 1080 };
/**
 * Samples older than this many majors before the binary are a last resort:
 * other fingerprint attributes (codecs, WebGL, plugins) follow the version
 * they were recorded with.
 */
const VERSION_WINDOW = 12;
const ATTEMPTS_PER_OPTION_SET = 5;

/**
 * Old dataset samples (pre UA-CH Chrome, WebViews, LarkUrl-style embedders)
 * carry an empty userAgentData; the CDP UA metadata cannot be built from them.
 */
export function hasUserAgentData(fingerprintData: BrowserFingerprintWithHeaders): boolean {
  const data = fingerprintData.fingerprint.navigator.userAgentData;
  return Boolean(data && typeof data.platform === "string" && data.platform !== "");
}

/** Version the sample claims, used when the binary cannot report its own. */
function sampleVersion(fingerprintData: BrowserFingerprintWithHeaders): ChromeVersion | null {
  const { userAgent, userAgentData } = fingerprintData.fingerprint.navigator;
  const major = Number(/Chrome\/(\d+)/.exec(userAgent)?.[1]);
  if (!Number.isInteger(major)) return null;
  const full = parseChromeVersion(userAgentData?.uaFullVersion ?? "");
  return full?.major === major ? full : { major, full: `${major}.0.0.0` };
}

/**
 * Option sets from strict to relaxed. The screen constraint relaxes first to
 * "at least the window" and then to none; the version window is dropped
 * independently, so a dataset older than the binary never costs the screen.
 */
export function buildOptionSets(options: GenerateFingerprintOptions): GeneratorOptions[] {
  // header-generator reorders the locales array it is given in place.
  const locales = () => [...(options.locales ?? DEFAULT_LOCALES)];
  const minVersion = options.browserVersion
    ? options.browserVersion.major - VERSION_WINDOW
    : undefined;
  const browsers: Array<GeneratorOptions["browsers"]> = [
    ...(minVersion ? [[{ name: "chrome" as const, minVersion }]] : []),
    [{ name: "chrome" as const }],
  ];

  if (options.device === "mobile") {
    return browsers.map((browserSpec) => ({
      devices: ["mobile"],
      operatingSystems: ["android"],
      browsers: browserSpec,
      locales: locales(),
      strict: true,
    }));
  }

  const { width, height } = options.dimensions ?? DEFAULT_DIMENSIONS;
  const screens: Array<GeneratorOptions["screen"] | undefined> = [
    { minWidth: width, maxWidth: width, minHeight: height, maxHeight: height },
    { minWidth: width, minHeight: height },
    undefined,
  ];
  return screens.flatMap((screen) =>
    browsers.map((browserSpec) => ({
      devices: ["desktop"],
      operatingSystems: ["linux"],
      browsers: browserSpec,
      locales: locales(),
      strict: true,
      ...(screen ? { screen } : {}),
    })),
  );
}

/**
 * Generates a Chrome fingerprint for the device and aligns its browser
 * identity with the binary. Throws when no sample with UA client hints
 * matches, instead of handing an unusable fingerprint to the injector.
 */
export function generateFingerprint(
  options: GenerateFingerprintOptions,
): BrowserFingerprintWithHeaders {
  const createGenerator =
    options.createGenerator ??
    ((generatorOptions: GeneratorOptions) => new FingerprintGenerator(generatorOptions));
  const optionSets = buildOptionSets(options);
  const errors: string[] = [];

  for (const [index, generatorOptions] of optionSets.entries()) {
    let generator: FingerprintGeneratorLike;
    try {
      generator = createGenerator(generatorOptions);
    } catch (error) {
      errors.push(String(error));
      continue;
    }

    for (let attempt = 0; attempt < ATTEMPTS_PER_OPTION_SET; attempt++) {
      let sample: BrowserFingerprintWithHeaders;
      try {
        sample = generator.getFingerprint();
      } catch (error) {
        errors.push(String(error));
        break;
      }
      if (!hasUserAgentData(sample)) continue;

      if (index > 0) {
        options.logger?.warn(
          { requested: optionSets[0], used: generatorOptions },
          "[Fingerprint] Strict fingerprint constraints unsatisfiable in the bundled dataset; generated with relaxed constraints",
        );
      }
      const version = options.browserVersion ?? sampleVersion(sample);
      if (!options.browserVersion) {
        options.logger?.warn(
          { sampleVersion: version?.full },
          "[Fingerprint] Could not read the Chrome binary version; the fingerprint keeps the dataset version and will not match the binary",
        );
      }
      const aligned = version
        ? alignFingerprintWithBrowser(sample, version, options.hostArch)
        : sample;
      if (options.device === "desktop") {
        aligned.fingerprint.screen = fitScreenToWindow(
          aligned.fingerprint.screen,
          options.dimensions ?? DEFAULT_DIMENSIONS,
        );
      }
      if (options.devicePixelRatio !== undefined) {
        aligned.fingerprint.screen = {
          ...aligned.fingerprint.screen,
          devicePixelRatio: options.devicePixelRatio,
        };
      }
      return aligned;
    }
  }

  throw new Error(
    `Could not generate a ${options.device} Chrome fingerprint with navigator.userAgentData ` +
      `from the bundled dataset${errors.length ? ` (${errors.at(-1)})` : ""}`,
  );
}
