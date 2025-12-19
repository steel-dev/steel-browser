export async function validateTimezone(
  timezonePromise: string | Promise<string>,
  timeoutMs: number = 10000,
): Promise<string> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Timezone validation timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const timezone = await Promise.race([Promise.resolve(timezonePromise), timeoutPromise]);
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return timezone;
  } catch (timezoneError) {
    throw new Error(`Invalid timezone resolved: ${timezone}`);
  }
}
