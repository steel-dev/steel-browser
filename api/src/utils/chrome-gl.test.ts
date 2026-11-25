import { describe, expect, test } from "vitest";
import { chromeGlLaunchArgs, parseChromeDisableGpu, parseChromeUseGl } from "./chrome-gl.js";

describe("parseChromeUseGl", () => {
  test("treats unset and blank as the built-in default", () => {
    expect(parseChromeUseGl(undefined)).toBeUndefined();
    expect(parseChromeUseGl("")).toBeUndefined();
    expect(parseChromeUseGl("  ")).toBeUndefined();
  });

  test("accepts a Chrome --use-gl name", () => {
    expect(parseChromeUseGl("angle")).toBe("angle");
    expect(parseChromeUseGl(" egl ")).toBe("egl");
    expect(parseChromeUseGl("desktop")).toBe("desktop");
    expect(parseChromeUseGl("swiftshader")).toBe("swiftshader");
  });

  test("rejects values that are not a single flag name", () => {
    expect(() => parseChromeUseGl("--use-gl=angle")).toThrow(/CHROME_USE_GL/);
    expect(() => parseChromeUseGl("angle egl")).toThrow(/CHROME_USE_GL/);
    expect(() => parseChromeUseGl("angle;--no-sandbox")).toThrow(/CHROME_USE_GL/);
  });
});

describe("parseChromeDisableGpu", () => {
  test("forces --disable-gpu unless the operator opts out", () => {
    expect(parseChromeDisableGpu(undefined)).toBe(true);
    expect(parseChromeDisableGpu("")).toBe(true);
    expect(parseChromeDisableGpu("true")).toBe(true);
    expect(parseChromeDisableGpu("1")).toBe(true);
    expect(parseChromeDisableGpu("false")).toBe(false);
    expect(parseChromeDisableGpu("0")).toBe(false);
    expect(parseChromeDisableGpu(" false ")).toBe(false);
  });
});

describe("chromeGlLaunchArgs", () => {
  test("keeps the software-GL default for headless and headed sessions", () => {
    expect(chromeGlLaunchArgs({ headless: true, useGl: undefined, disableGpu: true })).toEqual({
      disableGpu: ["--disable-gpu"],
      useGl: [],
    });
    expect(chromeGlLaunchArgs({ headless: false, useGl: undefined, disableGpu: true })).toEqual({
      disableGpu: ["--disable-gpu"],
      useGl: ["--use-gl=swiftshader"],
    });
  });

  test("lets a self-hosted GPU host select a GL backend and drop --disable-gpu", () => {
    expect(chromeGlLaunchArgs({ headless: true, useGl: "angle", disableGpu: false })).toEqual({
      disableGpu: [],
      useGl: ["--use-gl=angle"],
    });
    expect(chromeGlLaunchArgs({ headless: false, useGl: "egl", disableGpu: false })).toEqual({
      disableGpu: [],
      useGl: ["--use-gl=egl"],
    });
  });

  test("can change --use-gl while still forcing --disable-gpu", () => {
    expect(chromeGlLaunchArgs({ headless: false, useGl: "angle", disableGpu: true }).useGl).toEqual(
      ["--use-gl=angle"],
    );
  });
});
