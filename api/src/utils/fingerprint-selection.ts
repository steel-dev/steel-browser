/**
 * Utility functions for selecting OS and browser types for fingerprint generation
 * Uses deterministic selection based on userId for consistency
 */

/**
 * Select random operating system weighted by market share
 *
 * TEMPORARY FIX: Using Linux-only to avoid platform/GPU mismatches
 * Until we fix the page.evaluate() injection timing issue
 *
 * Original distribution: Windows: 70%, macOS: 20%, Linux: 10%
 */
export function selectRandomOS(seed?: string): "windows" | "macos" | "linux" {
  // Re-enabled with page.evaluate() fix
  const randomValue = seed ? hashToRandom(seed) : Math.random();
  if (randomValue < 0.7) return "windows";
  if (randomValue < 0.9) return "macos";
  return "linux";
}

/**
 * Select random browser - ONLY Chrome compatible browsers
 * IMPORTANT: We run Chromium, so we can ONLY use Chrome/Edge user agents
 * Firefox user agents will fail because Firefox-specific APIs don't exist in Chromium
 *
 * Chrome: 75%, Edge: 25%
 */
export function selectRandomBrowser(seed?: string): "chrome" | "edge" {
  const randomValue = seed ? hashToRandom(seed, 1) : Math.random();

  // Only Chrome or Edge (both Chromium-based)
  // Never Firefox/Safari as we're running Chromium browser
  if (randomValue < 0.75) return "chrome";
  return "edge";
}

/**
 * Simple hash function for deterministic randomness
 * @param seed - String to hash (like userId)
 * @param offset - Optional offset for different random values from same seed
 */
function hashToRandom(seed: string, offset: number = 0): number {
  let hash = offset;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash) / 0x7fffffff; // Normalize to 0-1
}
