import { FastifyBaseLogger } from "fastify";
import {
  BaseLaunchError,
  ConfigurationError,
  LaunchTimeoutError,
  ResourceError,
} from "../services/cdp/errors/launch-errors.js";

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitterMs?: number;
}

export interface RetryResult<T> {
  result: T;
  attempt: number;
  totalDuration: number;
}

export class RetryError extends Error {
  public readonly attempts: number;
  public readonly lastError: Error;
  public readonly allErrors: Error[];

  constructor(attempts: number, lastError: Error, allErrors: Error[]) {
    super(`Failed after ${attempts} attempts. Last error: ${lastError.message}`);
    this.name = "RetryError";
    this.attempts = attempts;
    this.lastError = lastError;
    this.allErrors = allErrors;
  }
}

/**
 * Retry utility with exponential backoff and jitter for retryable launch errors
 */
export class RetryManager {
  private logger: FastifyBaseLogger;
  private defaultOptions: RetryOptions = {
    maxAttempts: 3,
    baseDelayMs: 500,
    maxDelayMs: 5000,
    backoffMultiplier: 2,
    jitterMs: 250,
  };

  constructor(logger: FastifyBaseLogger) {
    this.logger = logger;
  }

  /**
   * Execute a function with retry logic for retryable errors
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    options: Partial<RetryOptions> = {},
  ): Promise<RetryResult<T>> {
    const opts = { ...this.defaultOptions, ...options };
    const errors: Error[] = [];
    const startTime = Date.now();

    for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
      try {
        this.logger.info(
          `[RetryManager] ${operationName} - Attempt ${attempt}/${opts.maxAttempts}`,
        );

        const result = await operation();
        const totalDuration = Date.now() - startTime;

        if (attempt > 1) {
          this.logger.info(
            `[RetryManager] ${operationName} succeeded on attempt ${attempt}/${opts.maxAttempts} after ${totalDuration}ms`,
          );
        }

        return {
          result,
          attempt,
          totalDuration,
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        errors.push(err);

        const isRetryable = this.isErrorRetryable(err);
        const isLastAttempt = attempt === opts.maxAttempts;

        this.logger.warn(
          `[RetryManager] ${operationName} failed on attempt ${attempt}/${opts.maxAttempts}`,
          {
            error: err.message,
            isRetryable,
            isLastAttempt,
            errorType: err instanceof BaseLaunchError ? err.type : "unknown",
          } as any,
        );

        if (!isRetryable || isLastAttempt) {
          if (!isRetryable) {
            this.logger.error(
              `[RetryManager] ${operationName} failed with non-retryable error: ${err.message}`,
            );
            throw err; // Throw original error for non-retryable errors
          } else {
            this.logger.error(
              `[RetryManager] ${operationName} failed after ${opts.maxAttempts} attempts`,
            );
            throw new RetryError(attempt, err, errors);
          }
        }

        // Calculate delay with exponential backoff and jitter
        const baseDelay = opts.baseDelayMs * Math.pow(opts.backoffMultiplier, attempt - 1);
        const jitter = opts.jitterMs ? Math.random() * opts.jitterMs : 0;
        const delay = Math.min(baseDelay + jitter, opts.maxDelayMs);

        this.logger.info(
          `[RetryManager] Waiting ${Math.round(delay)}ms before retry ${attempt + 1}/${
            opts.maxAttempts
          }`,
        );
        await this.sleep(delay);
      }
    }

    // This should never be reached, but TypeScript needs it
    throw new RetryError(opts.maxAttempts, errors[errors.length - 1], errors);
  }

  private isErrorRetryable(error: Error): boolean {
    if (
      error instanceof ConfigurationError ||
      error instanceof ResourceError ||
      error instanceof LaunchTimeoutError
    ) {
      return false;
    }

    if (error instanceof BaseLaunchError) {
      return error.isRetryable;
    }

    // For non-categorized errors, we'll be conservative and not retry.
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  createRetryWrapper<T extends any[], R>(
    method: (...args: T) => Promise<R>,
    operationName: string,
    options: Partial<RetryOptions> = {},
  ): (...args: T) => Promise<R> {
    return async (...args: T): Promise<R> => {
      const result = await this.executeWithRetry(() => method(...args), operationName, options);
      return result.result;
    };
  }
}
