import vm from "node:vm";
import { describe, expect, it } from "vitest";
import {
  FINGERPRINT_CONFIG_PLACEHOLDER,
  buildFingerprintConfig,
  loadFingerprintScript,
  loadScript,
  loadWorkerFingerprintScript,
  type FingerprintScriptParams,
} from "./index.js";

const params: FingerprintScriptParams = {
  fixedVendor: "Google Inc. (Intel)",
  fixedRenderer: "ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)",
  fixedDeviceMemory: 8,
  fixedHardwareConcurrency: 4,
};

const embeddedConfig = (script: string): unknown => {
  const match = script.match(/\}\)\((\{.*\})\);\s*$/s);
  expect(match).not.toBeNull();
  return JSON.parse(match![1]);
};

describe("fingerprint.js source", () => {
  it("is one strict IIFE with a single config placeholder", () => {
    const source = loadScript("fingerprint.js");
    expect(source.split(FINGERPRINT_CONFIG_PLACEHOLDER)).toHaveLength(2);
    const code = source.replace(/^\s*\/\/.*$/gm, "").trim();
    expect(code.startsWith("(function (config) {")).toBe(true);
    expect(code.endsWith(`})(${FINGERPRINT_CONFIG_PLACEHOLDER});`)).toBe(true);
    expect(code).toContain('"use strict";');
  });
});

describe("loadFingerprintScript", () => {
  it("embeds only the values CDP cannot set", () => {
    const script = loadFingerprintScript({
      ...params,
      fixedPlatform: "Linux x86_64",
      fixedUaPlatform: "Linux",
      fixedMobile: false,
      fixedBrands: [{ brand: "Chromium", version: "156" }],
      fixedUaFullVersion: "156.0.0.0",
    });
    expect(script).not.toContain(FINGERPRINT_CONFIG_PLACEHOLDER);
    expect(embeddedConfig(script)).toEqual({
      deviceMemory: 8,
      webglVendor: "Google Inc. (Intel)",
      webglRenderer: "ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)",
    });
    expect(script).not.toMatch(/FIXED_[A-Z]+/);
  });

  it("escapes values so the script stays valid JavaScript", () => {
    const vendor = `Ven"dor\\ $& $' $\` </script>    ${"\n"}`;
    const script = loadFingerprintScript({ ...params, fixedVendor: vendor });
    expect(() => new Function(script)).not.toThrow();
    expect(embeddedConfig(script)).toMatchObject({ webglVendor: vendor });
  });

  it("drops an invalid deviceMemory instead of patching it", () => {
    for (const fixedDeviceMemory of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(buildFingerprintConfig({ ...params, fixedDeviceMemory }).deviceMemory).toBeUndefined();
    }
  });

  it("falls back to a GPU that matches the platform", () => {
    const desktop = buildFingerprintConfig({
      ...params,
      fixedVendor: undefined,
      fixedRenderer: undefined,
    });
    expect(desktop.webglVendor).toBe("Google Inc. (Intel)");
    expect(desktop.webglRenderer).toMatch(/^ANGLE \(Intel, /);

    const mobile = buildFingerprintConfig({
      ...params,
      fixedVendor: undefined,
      fixedRenderer: undefined,
      fixedMobile: true,
    });
    expect(mobile.webglVendor).toBe("Qualcomm");
    expect(mobile.webglRenderer).toMatch(/^Adreno/);
  });

  it.each([
    [true, "Linux armv81"],
    [false, undefined],
  ])("patches navigator.platform only for mobile=%s", (fixedMobile, platform) => {
    const config = buildFingerprintConfig({
      ...params,
      fixedMobile,
      fixedPlatform: "Linux armv81",
    });
    expect(config.platform).toBe(platform);
  });
});

describe("loadWorkerFingerprintScript", () => {
  it("uses the same values as the page script", () => {
    expect(embeddedConfig(loadWorkerFingerprintScript(params))).toEqual(
      embeddedConfig(loadFingerprintScript(params)),
    );
  });
});

describe("injected script", () => {
  const run = (setup: string, script: string, check: string): unknown => {
    const context = vm.createContext({});
    vm.runInContext(setup, context);
    const globalsBefore = vm.runInContext("Object.getOwnPropertyNames(globalThis).join()", context);
    vm.runInContext(script, context);
    expect(vm.runInContext("Object.getOwnPropertyNames(globalThis).join()", context)).toBe(
      globalsBefore,
    );
    return JSON.parse(vm.runInContext(`JSON.stringify(${check})`, context));
  };

  it("runs where navigator and WebGL do not exist", () => {
    expect(run("", loadWorkerFingerprintScript(params), "typeof Function.prototype.toString")).toBe(
      "function",
    );
  });

  it("patches prototypes and hides the patch from toString", () => {
    const setup = `
      globalThis.Navigator = class Navigator { get deviceMemory() { return 32; } };
      globalThis.navigator = new Navigator();
      globalThis.WebGLRenderingContext = class WebGLRenderingContext {
        getParameter(pname) { return pname >>> 0 > 37444 ? "native" : null; }
      };
    `;
    const check = `(() => {
      const getter = Object.getOwnPropertyDescriptor(Navigator.prototype, "deviceMemory").get;
      const { getParameter } = WebGLRenderingContext.prototype;
      const gl = new WebGLRenderingContext();
      return {
        deviceMemory: navigator.deviceMemory,
        ownKeys: Reflect.ownKeys(navigator),
        getterName: getter.name,
        getterSource: Function.prototype.toString.call(getter),
        getParameterName: getParameter.name,
        getParameterLength: getParameter.length,
        getParameterSource: getParameter.toString(),
        toStringSource: Function.prototype.toString.toString(),
        vendor: gl.getParameter(37445),
        renderer: gl.getParameter("37446"),
        other: gl.getParameter(7936),
      };
    })()`;
    expect(run(setup, loadFingerprintScript(params), check)).toEqual({
      deviceMemory: 8,
      ownKeys: [],
      getterName: "get deviceMemory",
      getterSource: "get deviceMemory() { return 32; }",
      getParameterName: "getParameter",
      getParameterLength: 1,
      getParameterSource: 'getParameter(pname) { return pname >>> 0 > 37444 ? "native" : null; }',
      toStringSource: "function toString() { [native code] }",
      vendor: "Google Inc. (Intel)",
      renderer: "ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)",
      other: null,
    });
  });
});
