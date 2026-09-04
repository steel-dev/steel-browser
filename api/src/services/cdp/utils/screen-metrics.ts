export interface ScreenMetrics {
  width: number;
  height: number;
  availWidth: number;
  availHeight: number;
  devicePixelRatio: number;
}

export interface ScreenMetricsSources {
  /** Dimensions explicitly requested for the session, if any. */
  dimensions?: { width: number; height: number } | null;
  /** `screen` block of the generated fingerprint, if a fingerprint was generated. */
  fingerprintScreen?: Partial<ScreenMetrics> | null;
}

const isPositive = (value: number | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/**
 * Resolves the screen metrics a page should report.
 *
 * Explicitly requested dimensions win, since they are what the API reports back
 * and what the browser window is sized to — the generated fingerprint is only
 * used to fill in the values the request does not pin down (`avail*`,
 * `devicePixelRatio`). When no dimensions were requested the fingerprint screen
 * is used as-is, and when neither is available there is nothing coherent to
 * override with, so `null` is returned.
 */
export function resolveScreenMetrics({
  dimensions,
  fingerprintScreen,
}: ScreenMetricsSources): ScreenMetrics | null {
  const devicePixelRatio = isPositive(fingerprintScreen?.devicePixelRatio)
    ? fingerprintScreen!.devicePixelRatio!
    : 1;

  if (isPositive(dimensions?.width) && isPositive(dimensions?.height)) {
    const { width, height } = dimensions!;
    return {
      width,
      height,
      // The available area can never exceed the screen it sits on.
      availWidth: isPositive(fingerprintScreen?.availWidth)
        ? Math.min(fingerprintScreen!.availWidth!, width)
        : width,
      availHeight: isPositive(fingerprintScreen?.availHeight)
        ? Math.min(fingerprintScreen!.availHeight!, height)
        : height,
      devicePixelRatio,
    };
  }

  if (isPositive(fingerprintScreen?.width) && isPositive(fingerprintScreen?.height)) {
    const { width, height } = fingerprintScreen as ScreenMetrics;
    return {
      width,
      height,
      availWidth: isPositive(fingerprintScreen?.availWidth)
        ? fingerprintScreen!.availWidth!
        : width,
      availHeight: isPositive(fingerprintScreen?.availHeight)
        ? fingerprintScreen!.availHeight!
        : height,
      devicePixelRatio,
    };
  }

  return null;
}
