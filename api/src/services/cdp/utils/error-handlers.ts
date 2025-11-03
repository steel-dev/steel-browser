import { FastifyBaseLogger } from "fastify";
import { BaseLaunchError } from "../errors/launch-errors.js";

/**
 * Executes a critical operation that must succeed. Throws a categorized error on failure.
 *
 * @param operation - The async operation to execute
 * @param errorFactory - Factory function to create a categorized error from the caught error
 * @returns The result of the operation
 * @throws {BaseLaunchError} When the operation fails
 *
 * @example
 * const result = await executeCritical(
 *   async () => doSomethingCritical(),
 *   (error) => new BrowserProcessError(String(error), BrowserProcessState.LAUNCH_FAILED)
 * );
 */
export async function executeCritical<T>(
  operation: () => Promise<T>,
  errorFactory: (error: unknown) => BaseLaunchError,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw errorFactory(error);
  }
}

/**
 * Executes a non-critical operation. Logs a warning on failure but continues execution.
 *
 * @param logger - Fastify logger instance for warning messages
 * @param operation - The async operation to execute
 * @param errorFactory - Factory function to create a categorized error from the caught error
 * @param defaultValue - Optional default value to return on failure
 * @returns The result of the operation, or defaultValue/undefined on failure
 *
 * @example
 * const result = await executeOptional(
 *   logger,
 *   async () => tryOptionalOperation(),
 *   (error) => new CleanupError(String(error), CleanupType.PRE_LAUNCH_FILE_CLEANUP),
 *   defaultValue
 * );
 */
export async function executeOptional<T>(
  logger: FastifyBaseLogger,
  operation: () => Promise<T>,
  errorFactory: (error: unknown) => BaseLaunchError,
  defaultValue?: T,
): Promise<T | undefined> {
  try {
    return await operation();
  } catch (error) {
    const launchError = errorFactory(error);
    logger.warn(`[CDPService] ${launchError.message} - continuing with launch`);
    return defaultValue;
  }
}

/**
 * Executes a best-effort operation. Silently logs on failure.
 *
 * @param logger - Fastify logger instance for debug messages
 * @param operation - The async operation to execute
 * @param logMessage - Message to log on failure
 * @returns The result of the operation, or undefined on failure
 *
 * @example
 * const result = await executeBestEffort(
 *   logger,
 *   async () => tryBestEffortOperation(),
 *   "Failed to configure optional feature"
 * );
 */
export async function executeBestEffort<T>(
  logger: FastifyBaseLogger,
  operation: () => Promise<T>,
  logMessage: string,
): Promise<T | undefined> {
  try {
    return await operation();
  } catch (error) {
    logger.debug(`[CDPService] ${logMessage}: ${error}`);
    return undefined;
  }
}
