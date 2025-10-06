/**
 * Worker Fingerprinting Script
 *
 * Intercepts Web Worker creation to inject complete fingerprint into Worker context.
 * This prevents CreepJS "2 devices" detection by ensuring Workers have same fingerprint as main page.
 *
 * Critical: Workers don't inherit evaluateOnNewDocument scripts, so we must intercept
 * Worker constructor and inject fingerprint code into the Worker via Blob.
 */

export interface WorkerFingerprintOptions {
  userAgent: string;
  platform: string;
  gpuVendor: string;
  gpuRenderer: string;
  hardwareConcurrency: number;
  deviceMemory: number;
}

export function createWorkerFingerprintScript(options: WorkerFingerprintOptions): string {
  const { userAgent, platform, gpuVendor, gpuRenderer, hardwareConcurrency, deviceMemory } =
    options;

  // Escape strings for safe injection
  const escapeStr = (str: string) => JSON.stringify(str);

  return `
(function() {
  'use strict';

  // Save original Worker constructor
  const OriginalWorker = window.Worker;

  // Override Worker constructor using FUNCTION pattern (not class)
  // This pattern is proven to work in fingerprint.js
  window.Worker = function(scriptURL, options) {
    // Fingerprint injection code for Worker context
    const fingerprintCode = \`
        'use strict';

        // =====================================================
        // NAVIGATOR OVERRIDES (Critical for Worker context)
        // =====================================================

        // Override Navigator prototype
        try {
          Object.defineProperty(Navigator.prototype, 'userAgent', {
            get: () => ${escapeStr(userAgent)},
            configurable: true,
            enumerable: true
          });
        } catch (e) {}

        try {
          Object.defineProperty(Navigator.prototype, 'platform', {
            get: () => ${escapeStr(platform)},
            configurable: true,
            enumerable: true
          });
        } catch (e) {}

        try {
          Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
            get: () => ${hardwareConcurrency},
            configurable: true,
            enumerable: true
          });
        } catch (e) {}

        try {
          Object.defineProperty(Navigator.prototype, 'deviceMemory', {
            get: () => ${deviceMemory},
            configurable: true,
            enumerable: true
          });
        } catch (e) {}

        // Override self.navigator instance (Worker global navigator)
        try {
          Object.defineProperty(self.navigator, 'userAgent', {
            get: () => ${escapeStr(userAgent)},
            configurable: true
          });
        } catch (e) {}

        try {
          Object.defineProperty(self.navigator, 'platform', {
            get: () => ${escapeStr(platform)},
            configurable: true
          });
        } catch (e) {}

        // =====================================================
        // WEBGL GPU OVERRIDE (OffscreenCanvas for Workers)
        // =====================================================

        if (typeof OffscreenCanvas !== 'undefined') {
          try {
            const _origGetContext = OffscreenCanvas.prototype.getContext;

            OffscreenCanvas.prototype.getContext = function(type, attrs) {
              const ctx = _origGetContext.call(this, type, attrs);

              if (ctx && /webgl/i.test(type)) {
                const _origGetParameter = ctx.getParameter.bind(ctx);

                ctx.getParameter = function(param) {
                  // UNMASKED_VENDOR_WEBGL = 37445 (0x9245)
                  if (param === 37445 || param === 0x9245) {
                    return ${escapeStr(gpuVendor)};
                  }
                  // UNMASKED_RENDERER_WEBGL = 37446 (0x9246)
                  if (param === 37446 || param === 0x9246) {
                    return ${escapeStr(gpuRenderer)};
                  }

                  return _origGetParameter(param);
                };
              }

              return ctx;
            };
          } catch (e) {
            // Silently fail if OffscreenCanvas override fails
          }
        }

        // Marker for debugging
        self.__workerFingerprintApplied = true;
      \`;

    // Create blob with fingerprint code, then import original script
    const blob = new Blob([
      fingerprintCode,
      \`\\nimportScripts('\${scriptURL}');\\n\`
    ], { type: 'application/javascript' });

    // Create blob URL and construct Worker with it
    const blobURL = URL.createObjectURL(blob);

    // Create Worker with blob URL using original constructor
    const worker = new OriginalWorker(blobURL, options);

    // Clean up blob URL (Worker has already started)
    URL.revokeObjectURL(blobURL);

    return worker;
  };

  // Override toString to appear native
  try {
    Object.defineProperty(window.Worker, 'toString', {
      value: function() { return 'function Worker() { [native code] }'; },
      writable: false,
      configurable: true
    });
  } catch (e) {}

  // Marker to verify Worker interceptor is installed
  window.__workerInterceptorInstalled = true;
})();
`;
}
