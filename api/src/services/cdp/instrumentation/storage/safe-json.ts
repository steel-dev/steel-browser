export function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  return JSON.stringify(value, function (_key, currentValue) {
    if (typeof currentValue === "object" && currentValue !== null) {
      if (seen.has(currentValue)) {
        return "[Circular]";
      }

      seen.add(currentValue);
    }

    return currentValue;
  });
}
