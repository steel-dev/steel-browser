export function getErrors(e: unknown) {
  let error: string;
  if (typeof e === "string") {
    error = e;
  } else if (e instanceof Error) {
    error = e.message;
  } else {
    error = "Unknown error";
  }

  return error;
}

export class InvalidBrowserTypeError extends Error {
  constructor(browserType: string) {
    super(`Unsupported browser type: ${browserType}`);
    this.name = "InvalidBrowserTypeError";
  }
}

export class UnsupportedPlatformError extends Error {
  constructor(platform: string) {
    super(`Unsupported platform: ${platform}`);
    this.name = "UnsupportedPlatformError";
  }
}

export class ExecutableNotFoundError extends Error {
  constructor(paths: string[]) {
    super(`No valid executable found at: ${paths.join(", ")}`);
    this.name = "ExecutableNotFoundError";
  }
}