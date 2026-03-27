export function deepMerge<T extends Record<string, any>>(
  target: T,
  source: Record<string, any>,
): T {
  const result = { ...target };

  for (const key in source) {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      result[key as keyof T] = deepMerge(result[key] || {}, source[key]);
    } else {
      result[key as keyof T] = source[key];
    }
  }

  return result;
}
