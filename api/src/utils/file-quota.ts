export interface FileStorageQuotaConfig {
  maxTotalBytes?: number;
  maxSizePerSession?: number;
}

/**
 * Single source for the deprecated quota alias: `maxTotalBytes` wins when
 * both keys are set, `maxSizePerSession` is the backward-compatible fallback.
 * Returns undefined when neither key is set. Fail-closed: NaN, non-finite,
 * or negative values throw RangeError (consistent with FileService
 * normalizeQuota); 0 stays valid.
 */
export function resolveMaxTotalBytes(fileStorage?: FileStorageQuotaConfig): number | undefined {
  const resolved = fileStorage?.maxTotalBytes ?? fileStorage?.maxSizePerSession;
  if (resolved === undefined || resolved === null) return undefined;
  if (!Number.isFinite(resolved) || (resolved as number) < 0) {
    throw new RangeError(`Invalid maxTotalBytes: ${resolved}`);
  }
  return resolved;
}

/**
 * Central normalization for SteelBrowserConfig.fileStorage: maps a
 * deprecated-only config to `maxTotalBytes` while preserving the exact input
 * shape when no quota is configured (no materialized `fileStorage` object).
 */
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
