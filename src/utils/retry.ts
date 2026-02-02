/**
 * Utility for executing operations with exponential backoff retry logic.
 */

import type { Logger } from './logger';

export interface RetryOptions {
  baseDelayMs: number;
  maxRetries: number;
  log?: Logger;
  operationName?: string;
}

/**
 * Execute a function with exponential backoff retry logic.
 *
 * @param operation - The async function to execute
 * @param options - Retry configuration options
 * @returns The result of the operation
 * @throws The last error if all retries fail
 */
export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions): Promise<T> {
  const { baseDelayMs, log, maxRetries, operationName } = options;
  let lastError: Error = new Error('Operation failed with no error details');

  // Log operation start with retry config
  log?.debugRetry('Operation start', {
    maxRetries,
    operationName,
  });

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await operation();

      // Log successful execution
      log?.debugRetry('Operation succeeded', {
        attempt: attempt + 1,
        operationName,
        success: true,
      });

      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');

      if (attempt < maxRetries - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt);

        // Log retry scheduled
        log?.debugRetry('Retry scheduled', {
          attempt: attempt + 1,
          delay,
          error: lastError.message,
          maxRetries,
          operationName,
        });

        log?.warn(`${operationName ?? 'Operation'} failed, retrying in ${String(delay)}ms`, {
          attempt: attempt + 1,
          error: lastError.message,
          maxRetries,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
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

  throw lastError;
}
