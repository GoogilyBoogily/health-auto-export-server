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

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');

      if (attempt < maxRetries - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        log?.warn(`${operationName ?? 'Operation'} failed, retrying in ${String(delay)}ms`, {
          attempt: attempt + 1,
          error: lastError.message,
          maxRetries,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}
