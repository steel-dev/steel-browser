/**
 * Custom error classes for categorizing CDPService launch failures
 * These allow for slightly more intelligent error handling and recovery strategies
 */

export enum LaunchErrorType {
  TIMEOUT = "TIMEOUT",
  CONFIGURATION = "CONFIGURATION",
  RESOURCE = "RESOURCE",
  SYSTEM = "SYSTEM",
  NETWORK = "NETWORK",
  FINGERPRINT = "FINGERPRINT",
  PLUGIN = "PLUGIN",
  CLEANUP = "CLEANUP",
  BROWSER_PROCESS = "BROWSER_PROCESS",
  SESSION_CONTEXT = "SESSION_CONTEXT",
}

export abstract class BaseLaunchError extends Error {
  public readonly type: LaunchErrorType;
  public readonly isRetryable: boolean;
  public readonly context?: Record<string, any>;

  constructor(type: LaunchErrorType, message: string, isRetryable: boolean = false, context?: Record<string, any>) {
    super(message);
    this.name = this.constructor.name;
    this.type = type;
    this.isRetryable = isRetryable;
    this.context = context;

    // Maintains proper stack trace for where error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Thrown when browser launch times out after 30 seconds
 * This is typically retryable as it may be a temporary resource issue
 */
export class LaunchTimeoutError extends BaseLaunchError {
  constructor(timeoutMs: number = 30000) {
    super(LaunchErrorType.TIMEOUT, `Browser launch timeout after ${timeoutMs}ms`, true, { timeoutMs });
  }
}

/**
 * Thrown when configuration parameters are invalid or incompatible
 * These are typically not retryable without fixing the configuration
 */
export class ConfigurationError extends BaseLaunchError {
  constructor(message: string, configField?: string, configValue?: any) {
    super(LaunchErrorType.CONFIGURATION, `Configuration error: ${message}`, false, { configField, configValue });
  }
}

/**
 * Thrown when required system resources are unavailable
 * Some may be retryable (temporary disk space), others not (missing Chrome binary)
 */
export class ResourceError extends BaseLaunchError {
  constructor(message: string, resourceType: string, isRetryable: boolean = false) {
    super(LaunchErrorType.RESOURCE, `Resource error: ${message}`, isRetryable, { resourceType });
  }
}

/**
 * Thrown when system-level operations fail
 * Usually retryable as they may be temporary system issues
 */
export class SystemError extends BaseLaunchError {
  constructor(message: string, operation: string, originalError?: Error) {
    super(LaunchErrorType.SYSTEM, `System error during ${operation}: ${message}`, true, {
      operation,
      originalError: originalError?.message,
    });
  }
}

/**
 * Thrown when network-related operations fail (proxy, WebSocket setup)
 * Usually retryable as network issues are often temporary
 */
export class NetworkError extends BaseLaunchError {
  constructor(message: string, networkOperation: string) {
    super(LaunchErrorType.NETWORK, `Network error during ${networkOperation}: ${message}`, true, { networkOperation });
  }
}

/**
 * Thrown when fingerprint generation or injection fails
 * Usually retryable, can fall back to no fingerprint
 */
export class FingerprintError extends BaseLaunchError {
  constructor(message: string, stage: "generation" | "injection") {
    super(LaunchErrorType.FINGERPRINT, `Fingerprint error during ${stage}: ${message}`, true, { stage });
  }
}

/**
 * Thrown when plugin operations fail during launch
 * May or may not be retryable depending on the plugin
 */
export class PluginError extends BaseLaunchError {
  constructor(message: string, pluginName: string, operation: string, isRetryable: boolean = true) {
    super(LaunchErrorType.PLUGIN, `Plugin error in ${pluginName} during ${operation}: ${message}`, isRetryable, {
      pluginName,
      operation,
    });
  }
}

/**
 * Thrown when file cleanup operations fail
 * Usually retryable and non-critical to browser launch
 */
export class CleanupError extends BaseLaunchError {
  constructor(message: string, cleanupType: string) {
    super(LaunchErrorType.CLEANUP, `Cleanup error during ${cleanupType}: ${message}`, true, { cleanupType });
  }
}

/**
 * Thrown when the browser process fails to start or crashes immediately
 * Usually retryable as it may be a temporary issue
 */
export class BrowserProcessError extends BaseLaunchError {
  constructor(message: string, processState: string, exitCode?: number) {
    super(LaunchErrorType.BROWSER_PROCESS, `Browser process error (${processState}): ${message}`, true, {
      processState,
      exitCode,
    });
  }
}

/**
 * Thrown when session context injection fails
 * Usually retryable, can fall back to launching without context
 */
export class SessionContextError extends BaseLaunchError {
  constructor(message: string, contextType: string) {
    super(LaunchErrorType.SESSION_CONTEXT, `Session context error with ${contextType}: ${message}`, true, {
      contextType,
    });
  }
}

/**
 * Utility function to categorize unknown errors
 */
export function categorizeError(error: unknown, context?: string): BaseLaunchError {
  if (error instanceof BaseLaunchError) {
    return error;
  }

  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorStack = error instanceof Error ? error.stack : undefined;

  // Analyze error message patterns to categorize
  const lowerMessage = errorMessage.toLowerCase();

  if (lowerMessage.includes("timeout") || lowerMessage.includes("timed out")) {
    return new LaunchTimeoutError();
  }

  if (lowerMessage.includes("enoent") || lowerMessage.includes("not found") || lowerMessage.includes("no such file")) {
    return new ResourceError(errorMessage, "file", false);
  }

  if (lowerMessage.includes("eacces") || lowerMessage.includes("permission denied")) {
    return new SystemError(errorMessage, context || "file access");
  }

  if (lowerMessage.includes("eaddrinuse") || lowerMessage.includes("address already in use")) {
    return new NetworkError(errorMessage, "port binding");
  }

  if (lowerMessage.includes("proxy") || lowerMessage.includes("websocket")) {
    return new NetworkError(errorMessage, context || "network setup");
  }

  if (lowerMessage.includes("fingerprint")) {
    return new FingerprintError(errorMessage, "generation");
  }

  if (lowerMessage.includes("plugin")) {
    return new PluginError(errorMessage, "unknown", context || "launch");
  }

  if (lowerMessage.includes("cleanup") || lowerMessage.includes("clean")) {
    return new CleanupError(errorMessage, context || "general");
  }

  if (lowerMessage.includes("chrome") || lowerMessage.includes("browser") || lowerMessage.includes("process")) {
    return new BrowserProcessError(errorMessage, "unknown");
  }

  // Default to system error for unrecognized errors
  return new SystemError(errorMessage, context || "unknown operation", error instanceof Error ? error : undefined);
}
