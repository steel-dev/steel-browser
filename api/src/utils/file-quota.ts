export interface FileStorageQuotaConfig {
  maxTotalBytes?: number;
  maxSizePerSession?: number;
}

/** Quota alias: `maxTotalBytes ?? maxSizePerSession`; fail-closed RangeError on non-finite/negative, 0 valid; legacy-only use warns once. */
let legacyQuotaWarningEmitted = false;

function emitLegacyQuotaWarningOnce(): void {
  if (legacyQuotaWarningEmitted) return;
  legacyQuotaWarningEmitted = true;
  console.warn(
    "[deprecation] fileStorage.maxSizePerSession is deprecated, behaves as store-wide maxTotalBytes, use maxTotalBytes instead.",
  );
}

export function resolveMaxTotalBytes(fileStorage?: FileStorageQuotaConfig): number | undefined {
  const hasCanonical = fileStorage?.maxTotalBytes != null;
  const hasLegacy = fileStorage?.maxSizePerSession != null;
  const resolved = fileStorage?.maxTotalBytes ?? fileStorage?.maxSizePerSession;
  if (resolved === undefined || resolved === null) return undefined;
  if (!Number.isFinite(resolved) || (resolved as number) < 0) {
    throw new RangeError(`Invalid maxTotalBytes: ${resolved}`);
  }
  if (!hasCanonical && hasLegacy) {
    emitLegacyQuotaWarningOnce();
  }
  return resolved;
}

/** Maps legacy-only fileStorage to maxTotalBytes; preserves shape when unconfigured. */
export function normalizeSteelBrowserFileStorage<
  T extends { fileStorage?: FileStorageQuotaConfig },
>(opts: T): T & { fileStorage?: FileStorageQuotaConfig } {
  const resolved = resolveMaxTotalBytes(opts.fileStorage);
  if (resolved === undefined) return opts;
  return {
    ...opts,
    fileStorage: { ...opts.fileStorage, maxTotalBytes: resolved },
  };
}
