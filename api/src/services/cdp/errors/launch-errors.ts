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

export enum BrowserProcessState {
  PAGE_REFRESH = "page_refresh",
  LAUNCH_FAILED = "launch_failed",
  PAGE_ACCESS = "page_access",
  TARGET_SETUP = "target_setup",
  UNKNOWN = "unknown",
}

export enum PluginName {
  LAUNCH_MUTATOR = "launch_mutator",
  PLUGIN_MANAGER = "plugin_manager",
  UNKNOWN = "unknown",
}

export enum PluginOperation {
  PRE_LAUNCH_HOOK = "pre-launch hook",
  BROWSER_LAUNCH_NOTIFICATION = "browser launch notification",
  LAUNCH = "launch",
}

export enum CleanupType {
  PRE_LAUNCH_FILE_CLEANUP = "pre-launch file cleanup",
  GENERAL = "general",
}

export enum SessionContextType {
  CONTEXT_INJECTION = "context injection",
}

export enum FingerprintStage {
  GENERATION = "generation",
  INJECTION = "injection",
}

export enum ResourceType {
  EXTENSIONS = "extensions",
  FILE = "file",
}

export enum NetworkOperation {
  WEBSOCKET_SETUP = "websocket setup",
  PORT_BINDING = "port binding",
  NETWORK_SETUP = "network setup",
}

export enum SystemOperation {
  FILE_ACCESS = "file access",
  UNKNOWN_OPERATION = "unknown operation",
}

export enum ConfigurationField {
  DIMENSIONS = "dimensions",
  TIMEZONE = "timezone",
  PROXY_URL = "proxyUrl",
}

export enum ErrorCategories {}

export abstract class BaseLaunchError extends Error {
  public readonly type: LaunchErrorType;
  public readonly isRetryable: boolean;
  public readonly context?: Record<string, any>;

  constructor(
    type: LaunchErrorType,
    message: string,
    isRetryable: boolean = false,
    context?: Record<string, any>,
  ) {
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
    super(LaunchErrorType.TIMEOUT, `Browser launch timeout after ${timeoutMs}ms`, true, {
      timeoutMs,
    });
  }
}

/**
 * Thrown when configuration parameters are invalid or incompatible
 * These are typically not retryable without fixing the configuration
 */
export class ConfigurationError extends BaseLaunchError {
  constructor(message: string, configField?: ConfigurationField, configValue?: any) {
    super(LaunchErrorType.CONFIGURATION, `Configuration error: ${message}`, false, {
      configField,
      configValue,
    });
  }
}

/**
 * Thrown when required system resources are unavailable
 * Some may be retryable (temporary disk space), others not (missing Chrome binary)
 */
export class ResourceError extends BaseLaunchError {
  constructor(message: string, resourceType: ResourceType, isRetryable: boolean = false) {
    super(LaunchErrorType.RESOURCE, `Resource error: ${message}`, isRetryable, { resourceType });
  }
}

/**
 * Thrown when system-level operations fail
 * Usually retryable as they may be temporary system issues
 */
export class SystemError extends BaseLaunchError {
  constructor(message: string, operation: SystemOperation, originalError?: Error) {
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
  constructor(message: string, networkOperation: NetworkOperation) {
    super(LaunchErrorType.NETWORK, `Network error during ${networkOperation}: ${message}`, true, {
      networkOperation,
    });
  }
}

/**
 * Thrown when fingerprint generation or injection fails
 * Usually retryable, can fall back to no fingerprint
 */
export class FingerprintError extends BaseLaunchError {
  constructor(message: string, stage: FingerprintStage) {
    super(LaunchErrorType.FINGERPRINT, `Fingerprint error during ${stage}: ${message}`, true, {
      stage,
    });
  }
}

/**
 * Thrown when plugin operations fail during launch
 * May or may not be retryable depending on the plugin
 */
export class PluginError extends BaseLaunchError {
  constructor(
    message: string,
    pluginName: PluginName,
    operation: PluginOperation,
    isRetryable: boolean = true,
  ) {
    super(
      LaunchErrorType.PLUGIN,
      `Plugin error in ${pluginName} during ${operation}: ${message}`,
      isRetryable,
      {
        pluginName,
        operation,
      },
    );
  }
}

/**
 * Thrown when file cleanup operations fail
 * Usually retryable and non-critical to browser launch
 */
export class CleanupError extends BaseLaunchError {
  constructor(message: string, cleanupType: CleanupType) {
    super(LaunchErrorType.CLEANUP, `Cleanup error during ${cleanupType}: ${message}`, true, {
      cleanupType,
    });
  }
}

/**
 * Thrown when the browser process fails to start or crashes immediately
 * Usually retryable as it may be a temporary issue
 */
export class BrowserProcessError extends BaseLaunchError {
  constructor(message: string, processState: BrowserProcessState, exitCode?: number) {
    super(
      LaunchErrorType.BROWSER_PROCESS,
      `Browser process error (${processState}): ${JSON.stringify(message, null, 2)}`,
      true,
      {
        processState,
        exitCode,
      },
    );
  }
}

/**
 * Thrown when session context injection fails
 * Usually retryable, can fall back to launching without context
 */
export class SessionContextError extends BaseLaunchError {
  constructor(message: string, contextType: SessionContextType) {
    super(
      LaunchErrorType.SESSION_CONTEXT,
      `Session context error with ${contextType}: ${message}`,
      true,
      {
        contextType,
      },
    );
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

  if (
    lowerMessage.includes("enoent") ||
    lowerMessage.includes("not found") ||
    lowerMessage.includes("no such file")
  ) {
    return new ResourceError(errorMessage, ResourceType.FILE, false);
  }

  if (lowerMessage.includes("eacces") || lowerMessage.includes("permission denied")) {
    return new SystemError(
      errorMessage,
      context ? SystemOperation.UNKNOWN_OPERATION : SystemOperation.FILE_ACCESS,
    );
  }

  if (lowerMessage.includes("eaddrinuse") || lowerMessage.includes("address already in use")) {
    return new NetworkError(errorMessage, NetworkOperation.PORT_BINDING);
  }

  if (lowerMessage.includes("proxy") || lowerMessage.includes("websocket")) {
    return new NetworkError(
      errorMessage,
      context ? NetworkOperation.NETWORK_SETUP : NetworkOperation.NETWORK_SETUP,
    );
  }

  if (lowerMessage.includes("fingerprint")) {
    return new FingerprintError(errorMessage, FingerprintStage.GENERATION);
  }

  if (lowerMessage.includes("plugin")) {
    return new PluginError(
      errorMessage,
      PluginName.UNKNOWN,
      context ? PluginOperation.LAUNCH : PluginOperation.LAUNCH,
    );
  }

  if (lowerMessage.includes("cleanup") || lowerMessage.includes("clean")) {
    return new CleanupError(errorMessage, context ? CleanupType.GENERAL : CleanupType.GENERAL);
  }

  if (
    lowerMessage.includes("chrome") ||
    lowerMessage.includes("browser") ||
    lowerMessage.includes("process")
  ) {
    return new BrowserProcessError(errorMessage, BrowserProcessState.UNKNOWN);
  }

  // Default to system error for unrecognized errors
  return new SystemError(
    errorMessage,
    context ? SystemOperation.UNKNOWN_OPERATION : SystemOperation.UNKNOWN_OPERATION,
    error instanceof Error ? error : undefined,
  );
}
