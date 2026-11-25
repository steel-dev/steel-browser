// Fingerprint values that Chromium cannot set natively over CDP.
//
// ./index.ts loads this file as text, replaces the config placeholder at the end
// with a JSON object and returns one IIFE. The caller injects it before any page or
// worker script runs: Page.addScriptToEvaluateOnNewDocument for frames,
// Runtime.evaluate on a worker target that still waits for the debugger. The same
// source runs in Window and WorkerGlobalScope.
//
// User agent, client hints, languages, timezone, locale, hardware concurrency,
// screen metrics and the desktop platform are CDP overrides and are not patched
// here: a JavaScript patch is observable, a native override is not.
//
// Rules for every patch:
// - patch prototypes, never instances, so prototype and instance calls agree;
// - keep the name, length, descriptor and non-constructability of the original;
// - Function.prototype.toString returns the source of the original;
// - errors thrown by the original keep the native stack (no frame of this script);
// - no globals, and no built-in that page code can replace is looked up after
//   injection.
(function (config) {
  "use strict";

  const UNMASKED_VENDOR_WEBGL = 0x9245;
  const UNMASKED_RENDERER_WEBGL = 0x9246;

  const { apply, getPrototypeOf } = Reflect;
  const { defineProperty, getOwnPropertyDescriptor, hasOwn } = Object;
  const ErrorConstructor = Error;
  const { captureStackTrace } = Error;
  const nativeToString = Function.prototype.toString;
  const weakMapGet = WeakMap.prototype.get;
  const mapGet = Map.prototype.get;
  const indexOf = String.prototype.indexOf;
  const slice = String.prototype.slice;

  // Patched function -> source of the original.
  const nativeSources = new WeakMap();
  // Source text of a patched function -> source of the original. Every frame runs
  // this script, so a function patched in another realm (an iframe) has the same
  // source text as the one patched here.
  const nativeSourcesByText = new Map();

  function register(patched, original) {
    const source = apply(nativeToString, original, []);
    nativeSources.set(patched, source);
    nativeSourcesByText.set(apply(nativeToString, patched, []), source);
  }

  function replace(target, property, key, patched) {
    const descriptor = getOwnPropertyDescriptor(target, property);
    const original = descriptor[key];
    descriptor[key] = patched;
    defineProperty(target, property, descriptor);
    register(patched, original);
  }

  // Blink bindings throw "Illegal invocation" and argument errors without a stack
  // frame of their own: the native stack starts at the caller.
  function callNative(original, patched, thisArg, args) {
    try {
      return apply(original, thisArg, args);
    } catch (error) {
      captureStackTrace(error, patched);
      throw error;
    }
  }

  // Give a throwing builtin room for the one extra frame of its patched caller.
  function raiseStackTraceLimit() {
    const limit = getOwnPropertyDescriptor(ErrorConstructor, "stackTraceLimit");
    if (limit === undefined || !hasOwn(limit, "value") || !limit.writable) return undefined;
    if (typeof limit.value !== "number" || !(limit.value >= 1)) return undefined;
    ErrorConstructor.stackTraceLimit = limit.value + 1;
    return limit.value;
  }

  function restoreStackTraceLimit(value) {
    if (value !== undefined) ErrorConstructor.stackTraceLimit = value;
  }

  // V8 builtins add a frame of their own, so the native stack is
  //   TypeError: Function.prototype.toString requires that 'this' be a Function
  //       at Object.toString (<anonymous>)
  //       at <caller>
  // Keep that frame and remove the frame of the patched function right below it.
  function removePatchedFrame(error, patched) {
    if (getOwnPropertyDescriptor(ErrorConstructor, "prepareStackTrace")) {
      captureStackTrace(error, patched);
      return;
    }
    const stack = error.stack;
    if (typeof stack !== "string") return;
    const builtinFrame = apply(indexOf, stack, ["\n    at "]);
    if (builtinFrame === -1) return;
    const patchedFrame = apply(indexOf, stack, ["\n    at ", builtinFrame + 1]);
    if (patchedFrame === -1) return;
    const callerFrame = apply(indexOf, stack, ["\n    at ", patchedFrame + 1]);
    error.stack =
      apply(slice, stack, [0, patchedFrame]) +
      (callerFrame === -1 ? "" : apply(slice, stack, [callerFrame]));
  }

  const { toString } = {
    toString() {
      const source = apply(weakMapGet, nativeSources, [this]);
      if (source !== undefined) return source;
      if (typeof this === "function") {
        const text = apply(nativeToString, this, arguments);
        const foreignSource = apply(mapGet, nativeSourcesByText, [text]);
        return foreignSource === undefined ? text : foreignSource;
      }
      // Throws, except for callable objects such as document.all.
      const raisedLimit = raiseStackTraceLimit();
      try {
        const text = apply(nativeToString, this, arguments);
        restoreStackTraceLimit(raisedLimit);
        return text;
      } catch (error) {
        restoreStackTraceLimit(raisedLimit);
        removePatchedFrame(error, toString);
        throw error;
      }
    },
  };
  replace(Function.prototype, "toString", "value", toString);

  // Navigator.prototype in a window, WorkerNavigator.prototype in a worker.
  function patchDeviceMemory() {
    const { deviceMemory } = config;
    if (typeof deviceMemory !== "number" || typeof navigator !== "object") return;
    const prototype = getPrototypeOf(navigator);
    // Secure contexts only: an insecure page has no deviceMemory at all.
    const descriptor = getOwnPropertyDescriptor(prototype, "deviceMemory");
    if (!descriptor) return;
    const original = descriptor.get;
    const { get } = getOwnPropertyDescriptor(
      {
        get deviceMemory() {
          callNative(original, get, this, []);
          return deviceMemory;
        },
      },
      "deviceMemory",
    );
    replace(prototype, "deviceMemory", "get", get);
  }

  // Mobile profiles only (see index.ts): the native platform override does not survive a
  // navigation while a second CDP client is attached.
  function patchPlatform() {
    const { platform } = config;
    if (typeof platform !== "string" || typeof navigator !== "object") return;
    const prototype = getPrototypeOf(navigator);
    const descriptor = getOwnPropertyDescriptor(prototype, "platform");
    if (!descriptor) return;
    const original = descriptor.get;
    const { get } = getOwnPropertyDescriptor(
      {
        get platform() {
          callNative(original, get, this, []);
          return platform;
        },
      },
      "platform",
    );
    replace(prototype, "platform", "get", get);
  }

  // getParameter(UNMASKED_*_WEBGL) returns a string only after the page enabled
  // WEBGL_debug_renderer_info on that context, otherwise null with INVALID_ENUM.
  // Replacing only string results keeps the extension state native.
  function patchGetParameter(prototype) {
    const { webglVendor, webglRenderer } = config;
    const original = getOwnPropertyDescriptor(prototype, "getParameter").value;
    const { getParameter } = {
      getParameter(pname) {
        const value = callNative(original, getParameter, this, arguments);
        if (typeof value !== "string" || typeof pname === "object" || typeof pname === "function") {
          return value;
        }
        // WebIDL unsigned long conversion; no side effects for primitives.
        const code = pname >>> 0;
        if (code === UNMASKED_VENDOR_WEBGL && typeof webglVendor === "string") return webglVendor;
        if (code === UNMASKED_RENDERER_WEBGL && typeof webglRenderer === "string") {
          return webglRenderer;
        }
        return value;
      },
    };
    replace(prototype, "getParameter", "value", getParameter);
  }

  patchDeviceMemory();
  patchPlatform();
  if (typeof config.webglVendor === "string" || typeof config.webglRenderer === "string") {
    // OffscreenCanvas contexts share these prototypes, in windows and in workers.
    if (typeof WebGLRenderingContext === "function") {
      patchGetParameter(WebGLRenderingContext.prototype);
    }
    if (typeof WebGL2RenderingContext === "function") {
      patchGetParameter(WebGL2RenderingContext.prototype);
    }
  }
})(STEEL_FINGERPRINT_CONFIG);
