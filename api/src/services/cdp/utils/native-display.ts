/** X11 reports logical screen coordinates at the real native device scale. */
export function nativeDeviceScaleFactor(
  profile: { fingerprint?: { screen?: { devicePixelRatio?: unknown } } } | null | undefined,
): number {
  const value = profile?.fingerprint?.screen?.devicePixelRatio;
  if (value === undefined) return 1;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0.5 || value > 4) {
    throw new Error("Invalid native profile device scale factor");
  }
  return value;
}
