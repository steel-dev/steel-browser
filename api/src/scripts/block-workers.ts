/**
 * Worker Blocking Script
 *
 * Prevents Web Worker creation to avoid Worker fingerprint leaks.
 * This eliminates "2 devices" detection by preventing CreepJS from testing Workers.
 *
 * Tradeoff: Some sites may require Workers. Blocking them might:
 * 1. Break site functionality
 * 2. Be detectable as a bot signal (most browsers support Workers)
 *
 * However, blocking is less suspicious than having inconsistent fingerprints.
 */

export function createWorkerBlockingScript(): string {
  return `
(function() {
  'use strict';

  // Save original Worker for potential future use
  const OriginalWorker = window.Worker;

  // Block Worker creation with realistic error
  window.Worker = function(scriptURL, options) {
    // Throw same error as browsers without Worker support
    throw new Error('Worker is not defined');
  };

  // Make it appear as if Worker API doesn't exist (more realistic)
  // Some old browsers or restricted environments don't have Workers
  try {
    Object.defineProperty(window, 'Worker', {
      get: () => undefined,
      set: () => {},
      configurable: false,
      enumerable: true
    });
  } catch (e) {
    // If we can't make it undefined, at least throw errors
    window.Worker = function() {
      throw new TypeError('Worker is not a constructor');
    };
  }

  // Also block SharedWorker and ServiceWorker if present
  if (typeof SharedWorker !== 'undefined') {
    try {
      Object.defineProperty(window, 'SharedWorker', {
        get: () => undefined,
        configurable: false
      });
    } catch (e) {}
  }

  // ServiceWorker is part of navigator, different pattern
  if (navigator.serviceWorker) {
    try {
      Object.defineProperty(navigator, 'serviceWorker', {
        get: () => undefined,
        configurable: false
      });
    } catch (e) {}
  }

  window.__workersBlocked = true;
})();
`;
}
