import { constants, promises as fs } from 'node:fs';
import path from 'node:path';

import { FileLockConfig } from '../config';
import { logger } from '../utils/logger';

interface LockContent {
  pid: number;
  timestamp: number;
}

/**
 * Result of checking whether to remove a stale lock.
 */
type StaleLockAction = 'process_alive' | 'remove' | 'retry';

/**
 * Acquire an exclusive lock on a file.
 * Uses a .lock file with O_EXCL for atomic creation.
 * Safely handles stale locks by verifying owning process before deletion.
 */
export async function acquireLock(filePath: string): Promise<void> {
  const lockPath = `${filePath}.lock`;
  await ensureDirectory(path.dirname(filePath));

  for (let attempt = 0; attempt < FileLockConfig.maxRetries; attempt++) {
    try {
      // Try to create lock file exclusively (fails if exists)
      const fd = await fs.open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
      await fd.write(JSON.stringify({ pid: process.pid, timestamp: Date.now() }));
      await fd.close();
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        await handleExistingLock(lockPath);
        continue;
      }
      throw error;
    }
  }

  throw new Error(
    `Failed to acquire lock for ${filePath} after ${String(FileLockConfig.maxRetries)} attempts`,
  );
}

/**
 * Write data atomically using temp file + rename pattern.
 * This ensures readers never see partial writes.
 */
export async function atomicWrite(filePath: string, data: object): Promise<void> {
  // eslint-disable-next-line sonarjs/pseudo-random -- Not security-critical, just for unique temp file name
  const temporaryPath = `${filePath}.tmp.${String(Date.now())}.${Math.random().toString(36).slice(2)}`;

  await ensureDirectory(path.dirname(filePath));
  await fs.writeFile(temporaryPath, JSON.stringify(data, undefined, 2), 'utf8');
  await fs.rename(temporaryPath, filePath);
}

/**
 * Ensure a directory exists, creating it recursively if needed.
 */
export async function ensureDirectory(directoryPath: string): Promise<void> {
  await fs.mkdir(directoryPath, { recursive: true });
}

/**
 * Extract the date as YYYY-MM-DD string from a date string or Date object.
 *
 * For strings (e.g., "2026-02-02 08:00:00 -0600"), extracts the date portion directly,
 * preserving the user's intended local date without timezone conversion.
 *
 * For Date objects, falls back to server local timezone extraction.
 */
export function getDateKey(date: Date | string): string {
  if (typeof date === 'string') {
    // Extract date portion directly from the string to preserve user's local date
    // Format: "YYYY-MM-DD HH:MM:SS ±HHMM" or ISO format "YYYY-MM-DDTHH:MM:SS..."
    const dateMatch = /^(\d{4}-\d{2}-\d{2})/.exec(date);
    if (dateMatch) {
      return dateMatch[1];
    }
  }

  // Fallback for Date objects or non-standard string formats
  const d = new Date(date);
  const year = String(d.getFullYear());
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Build file path in YYYY/MM/YYYY-MM-DD.json format.
 * Uses getDateKey internally to ensure consistent date handling across all storage backends.
 */
export function getFilePath(baseDirectory: string, date: Date | string): string {
  const dateKey = getDateKey(date);
  const [year, month] = dateKey.split('-');
  return path.join(baseDirectory, year, month, `${dateKey}.json`);
}

/**
 * Read JSON file with fallback to default value if file doesn't exist.
 */
export async function readJsonFile<T>(filePath: string, defaultValue: T): Promise<T> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return defaultValue;
    }
    throw error;
  }
}

/**
 * Read JSON file, returning undefined if file doesn't exist.
 * Useful when you need to distinguish between "file doesn't exist" and "file exists but is empty".
 */
export async function readJsonFileOptional<T>(filePath: string): Promise<T | undefined> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

/**
 * Release a lock on a file.
 * Never throws - logs warnings for non-ENOENT errors to prevent deadlocks
 * when called from finally blocks.
 */
export async function releaseLock(filePath: string): Promise<void> {
  const lockPath = `${filePath}.lock`;
  try {
    await fs.unlink(lockPath);
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code;
    if (errorCode !== 'ENOENT') {
      // Log warning but don't throw - prevents deadlocks from finally blocks
      logger.warn('Failed to release lock', {
        errorCode,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        lockPath,
      });
    }
    // ENOENT is fine - lock was already released
  }
}

/**
 * Execute a function while holding a lock on a file.
 */
export async function withLock<T>(filePath: string, function_: () => Promise<T>): Promise<T> {
  await acquireLock(filePath);
  try {
    return await function_();
  } finally {
    await releaseLock(filePath);
  }
}

/**
 * Check if a stale lock should be removed.
 * Verifies the owning process is dead before recommending removal.
 */
async function checkStaleLock(lockPath: string, age: number): Promise<StaleLockAction> {
  try {
    const content = await fs.readFile(lockPath, 'utf8');
    const lockData = JSON.parse(content) as LockContent;

    if (isProcessRunning(lockData.pid)) {
      // Process is still alive - lock is not truly stale, just slow
      logger.warn('Lock appears stale but owning process is alive', {
        age,
        lockPath,
        ownerPid: lockData.pid,
      });
      return 'process_alive';
    }

    // Process is dead, safe to remove the lock
    logger.debug('Removing stale lock from dead process', {
      lockPath,
      ownerPid: lockData.pid,
    });
    return 'remove';
  } catch {
    // Failed to read/parse lock content, try to remove anyway
    // (malformed lock file or concurrent deletion)
    return 'remove';
  }
}

/**
 * Handle an existing lock file - check if stale and take appropriate action.
 * Always returns after handling, allowing the caller to continue retrying.
 */
async function handleExistingLock(lockPath: string): Promise<void> {
  try {
    const stat = await fs.stat(lockPath);
    const age = Date.now() - stat.mtimeMs;

    if (age > FileLockConfig.staleTimeoutMs) {
      const action = await checkStaleLock(lockPath, age);

      if (action === 'process_alive') {
        await sleep(FileLockConfig.retryDelayMs);
        return;
      }

      // Remove stale lock (ignore errors - file may have been deleted concurrently)
      await fs.unlink(lockPath).catch(noop);
      return;
    }
  } catch {
    // Lock file disappeared during check, retry immediately
    return;
  }

  // Lock is fresh, wait and retry
  await sleep(FileLockConfig.retryDelayMs);
}

/**
 * Check if a process with the given PID is still running.
 * Uses process.kill with signal 0 to check without actually sending a signal.
 */
function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * No-operation function for use with .catch() to silence promise rejections.
 */
function noop(): void {
  // Intentionally empty - used to silence promise rejections
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
