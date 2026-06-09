import { describe, expect, it } from "vitest";
import { buildFingerprintOptions } from "./cdp.service.js";

describe("buildFingerprintOptions", () => {
  it("uses a range for the default desktop fingerprint screen", () => {
    const options = buildFingerprintOptions({
      dimensions: { width: 1920, height: 1080 },
    } as any);

    expect(options.screen).toEqual({
      minWidth: 1280,
      minHeight: 720,
      maxWidth: 2560,
      maxHeight: 1440,
    });
  });

  it("keeps non-default custom desktop dimensions exact", () => {
    const options = buildFingerprintOptions({
      dimensions: { width: 1440, height: 900 },
    } as any);

    expect(options.screen).toEqual({
      minWidth: 1440,
      minHeight: 900,
      maxWidth: 1440,
      maxHeight: 900,
    });
  });

  it("keeps mobile fingerprint generation unconstrained by desktop screen", () => {
    const options = buildFingerprintOptions({
      deviceConfig: { device: "mobile" },
      dimensions: { width: 1920, height: 1080 },
    } as any);

    expect(options).toEqual({
      devices: ["mobile"],
      locales: ["en-US", "en"],
    });
  });
});
