/**
 * Utility for executing operations with exponential backoff retry logic.
 */

import type { Logger } from './logger';

export interface RetryOptions<T = unknown> {
  baseDelayMs: number;
  maxRetries: number;
  log?: Logger;
  operationName?: string;
  /**
   * Treat a resolved value as a failure worth retrying.
   *
   * Without this, an operation that reports failure by returning a result rather than throwing
   * is never retried — which made the retry config inert for the storage writes it was written
   * for, since `saveDailyData` catches per-date errors and returns `{ success: false }`.
   */
  shouldRetry?: (result: T) => boolean;
}

/**
 * Execute a function with exponential backoff retry logic.
 *
 * @param operation - The async function to execute
 * @param options - Retry configuration options
 * @returns The result of the operation
 * @throws The last error if all retries fail
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions<T>,
): Promise<T> {
  const { baseDelayMs, log, maxRetries, operationName, shouldRetry } = options;
  let lastError: Error = new Error('Operation failed with no error details');
  let lastResult: T | undefined;
  let sawResult = false;

  // Log operation start with retry config
  log?.debugRetry('Operation start', {
    maxRetries,
    operationName,
  });

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await operation();

      if (shouldRetry?.(result)) {
        lastResult = result;
        sawResult = true;
        lastError = new Error(`${operationName ?? 'Operation'} reported failure`);
        if (attempt < maxRetries - 1) {
          await delayBeforeRetry(attempt, baseDelayMs, maxRetries, lastError, log, operationName);
        }
        continue;
      }

      // Log successful execution
      log?.debugRetry('Operation succeeded', {
        attempt: attempt + 1,
        operationName,
        success: true,
      });

      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');
      // A throw supersedes a soft failure from an earlier attempt. Without this the returned
      // result wins at the end and the exception vanishes — a lock timeout or ENOSPC on the
      // last attempt would be reported to the client as the first attempt's saved/updated counts.
      sawResult = false;

      if (attempt < maxRetries - 1) {
        await delayBeforeRetry(attempt, baseDelayMs, maxRetries, lastError, log, operationName);
      }
    }
  }

  // Log final failure
  log?.debugRetry('All retries exhausted', {
    error: lastError.message,
    maxRetries,
    operationName,
    success: false,
  });

  // An operation that signalled failure by returning gets its result handed back, so the
  // caller can build the structured partial-failure response it already knows how to build.
  if (sawResult) return lastResult as T;

  throw lastError;
}

/**
 * Wait out the exponential backoff for one attempt, logging why.
 */
async function delayBeforeRetry(
  attempt: number,
  baseDelayMs: number,
  maxRetries: number,
  error: Error,
  log?: Logger,
  operationName?: string,
): Promise<void> {
  const delay = baseDelayMs * Math.pow(2, attempt);

  log?.debugRetry('Retry scheduled', {
    attempt: attempt + 1,
    delay,
    error: error.message,
    maxRetries,
    operationName,
  });

  log?.warn(`${operationName ?? 'Operation'} failed, retrying in ${String(delay)}ms`, {
    attempt: attempt + 1,
    error: error.message,
    maxRetries,
  });

  await new Promise((resolve) => setTimeout(resolve, delay));
}
