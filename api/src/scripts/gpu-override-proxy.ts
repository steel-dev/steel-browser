/**
 * GPU Override Script using Proxy Pattern
 *
 * Based on fingerprint-injector's proven overrideWebGl implementation.
 * Uses ES6 Proxy to intercept getParameter calls instead of replacing the function.
 *
 * This approach is more robust because:
 * 1. Preserves original function behavior
 * 2. Only modifies specific parameter returns
 * 3. Handles error stack traces properly
 * 4. Appears more native (harder to detect)
 */

export interface GPUOverrideOptions {
  vendor: string;
  renderer: string;
}

export function createGPUOverrideScript(options: GPUOverrideOptions): string {
  const { vendor, renderer } = options;

  return `
(function() {
  'use strict';

  // Cache original Reflect methods before they can be tampered with
  const cache = {
    Reflect: {
      get: Reflect.get.bind(Reflect),
      apply: Reflect.apply.bind(Reflect),
    },
  };

  const webGl = {
    vendor: ${JSON.stringify(vendor)},
    renderer: ${JSON.stringify(renderer)},
  };

  /**
   * Strip proxy-related lines from error stacks to avoid detection
   */
  const stripErrorStack = (stack) => {
    return stack
      .split('\\n')
      .filter((line) => !line.includes('at Object.apply'))
      .filter((line) => !line.includes('at Object.get'))
      .join('\\n');
  };

  /**
   * Redefine property while preserving existing descriptors
   */
  function redefineProperty(masterObject, propertyName, descriptorOverrides = {}) {
    return Object.defineProperty(masterObject, propertyName, {
      ...(Object.getOwnPropertyDescriptor(masterObject, propertyName) || {}),
      ...descriptorOverrides,
    });
  }

  /**
   * Strip proxy from errors to avoid detection
   */
  function stripProxyFromErrors(handler) {
    const newHandler = {};
    const traps = Object.getOwnPropertyNames(handler);

    traps.forEach((trap) => {
      newHandler[trap] = function() {
        try {
          return handler[trap].apply(this, arguments);
        } catch (err) {
          if (!err || !err.stack || !err.stack.includes('at ')) {
            throw err;
          }

          // Remove proxy-related lines from stack trace
          const blacklist = [
            \`at Reflect.\${trap} \`,
            \`at Object.\${trap} \`,
            \`at Object.newHandler.<computed> [as \${trap}] \`,
          ];

          err.stack = err.stack
            .split('\\n')
            .filter((line, index) => !(index === 1)) // Remove first line
            .filter((line) => !blacklist.some((bl) => line.trim().startsWith(bl)))
            .join('\\n');

          throw err;
        }
      };
    });

    return newHandler;
  }

  /**
   * Override property with ES6 Proxy
   */
  function overridePropertyWithProxy(masterObject, propertyName, proxyHandler) {
    const originalObject = masterObject[propertyName];
    const proxy = new Proxy(
      masterObject[propertyName],
      stripProxyFromErrors(proxyHandler),
    );

    redefineProperty(masterObject, propertyName, { value: proxy });

    // Make toString() appear native
    try {
      const originalToString = originalObject.toString;
      Object.defineProperty(proxy, 'toString', {
        value: originalToString.bind(originalObject),
        writable: false,
        configurable: true,
      });
    } catch (e) {}
  }

  /**
   * WebGL getParameter Proxy Handler
   * Intercepts getParameter calls and returns spoofed GPU values
   */
  const getParameterProxyHandler = {
    apply(target, ctx, args) {
      const param = (args || [])[0];

      // Get the real result first
      const result = cache.Reflect.apply(target, ctx, args);

      // Get debug info extension constants
      const debugInfo = ctx.getExtension('WEBGL_debug_renderer_info');
      const UNMASKED_VENDOR_WEBGL = (debugInfo && debugInfo.UNMASKED_VENDOR_WEBGL) || 37445;
      const UNMASKED_RENDERER_WEBGL = (debugInfo && debugInfo.UNMASKED_RENDERER_WEBGL) || 37446;

      // Intercept GPU vendor
      if (param === UNMASKED_VENDOR_WEBGL) {
        return webGl.vendor;
      }

      // Intercept GPU renderer
      if (param === UNMASKED_RENDERER_WEBGL) {
        return webGl.renderer;
      }

      // Return real result for all other parameters
      return result;
    },
    get(target, prop, receiver) {
      // Handle strict mode exceptions
      if (['caller', 'callee', 'arguments'].includes(prop)) {
        throw TypeError(
          "'caller', 'callee', and 'arguments' properties may not be accessed on strict mode functions"
        );
      }
      return Reflect.get(target, prop, receiver);
    },
  };

  /**
   * Apply GPU override to WebGL contexts
   */
  try {
    // Override WebGLRenderingContext
    if (typeof WebGLRenderingContext !== 'undefined') {
      overridePropertyWithProxy(
        WebGLRenderingContext.prototype,
        'getParameter',
        getParameterProxyHandler
      );
    }

    // Override WebGL2RenderingContext
    if (typeof WebGL2RenderingContext !== 'undefined') {
      overridePropertyWithProxy(
        WebGL2RenderingContext.prototype,
        'getParameter',
        getParameterProxyHandler
      );
    }

    window.__gpuProxyOverrideApplied = true;
  } catch (err) {
    window.__gpuProxyOverrideError = err.message;
    console.warn('[GPU Override] Failed:', err);
  }
})();
`;
}
