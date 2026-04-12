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
 * Ensure a directory exists, creating it recursively if needed.
 */
export async function ensureDirectory(directoryPath: string): Promise<void> {
  await fs.mkdir(directoryPath, { recursive: true });
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
