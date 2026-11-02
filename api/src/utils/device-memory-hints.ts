function memoryValue(deviceMemory: number): string {
  if (!Number.isFinite(deviceMemory) || deviceMemory <= 0) {
    throw new RangeError("Configured device memory must be a positive finite number");
  }
  return String(deviceMemory);
}

/**
 * Set the profile before ServiceWorker dispatch, not only at network interception.
 * Chromium exposes its native hints to FetchEvent.request before Fetch interception.
 * This intentionally advertises the configured hints even before Accept-CH.
 */
export function withDeviceMemoryHints(
  headers: Record<string, string>,
  deviceMemory: number,
): Record<string, string> {
  const value = memoryValue(deviceMemory);
  const result = Object.fromEntries(
    Object.entries(headers).filter(([name]) => !/^(?:sec-ch-)?device-memory$/i.test(name)),
  );
  return { ...result, "device-memory": value, "sec-ch-device-memory": value };
}

/** Reconcile hints at the existing request interceptor as well. */
export function overrideDeviceMemoryHints(
  headers: Record<string, string>,
  deviceMemory: number,
): Record<string, string> | undefined {
  const names = Object.keys(headers).filter((name) => {
    const lower = name.toLowerCase();
    return lower === "device-memory" || lower === "sec-ch-device-memory";
  });
  if (!names.length) return undefined;
  const value = memoryValue(deviceMemory);
  const overridden = { ...headers };
  for (const name of names) overridden[name] = value;
  return overridden;
}
