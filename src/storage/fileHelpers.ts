import { constants, promises as fs } from 'node:fs';
import path from 'node:path';

// Lock configuration
const LOCK_RETRY_DELAY_MS = 50;
const LOCK_MAX_RETRIES = 100; // 5 seconds max wait
const LOCK_STALE_MS = 30_000; // Consider lock stale after 30 seconds

/**
 * Acquire an exclusive lock on a file.
 * Uses a .lock file with O_EXCL for atomic creation.
 */
export async function acquireLock(filePath: string): Promise<void> {
  const lockPath = `${filePath}.lock`;
  await ensureDirectory(path.dirname(filePath));

  for (let attempt = 0; attempt < LOCK_MAX_RETRIES; attempt++) {
    try {
      // Try to create lock file exclusively (fails if exists)
      const fd = await fs.open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
      await fd.write(JSON.stringify({ pid: process.pid, timestamp: Date.now() }));
      await fd.close();
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        // Lock exists, check if stale
        try {
          const stat = await fs.stat(lockPath);
          const age = Date.now() - stat.mtimeMs;
          if (age > LOCK_STALE_MS) {
            // Stale lock, remove and retry
            // eslint-disable-next-line @typescript-eslint/no-empty-function -- Ignore unlink errors for stale locks
            await fs.unlink(lockPath).catch(() => {});
            continue;
          }
        } catch {
          // Lock file disappeared, retry
          continue;
        }
        // Wait and retry
        await sleep(LOCK_RETRY_DELAY_MS);
        continue;
      }
      throw error;
    }
  }

  throw new Error(
    `Failed to acquire lock for ${filePath} after ${String(LOCK_MAX_RETRIES)} attempts`,
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
 * Format a date as YYYY-MM-DD string (UTC).
 * Uses UTC methods to ensure consistent file naming regardless of server timezone.
 */
export function getDateKey(date: Date | string): string {
  const d = new Date(date);
  const year = String(d.getUTCFullYear());
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Build file path in YYYY/MM/YYYY-MM-DD.json format (UTC).
 * Uses UTC methods to ensure consistent file paths regardless of server timezone.
 */
export function getFilePath(baseDirectory: string, date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return path.join(baseDirectory, String(year), month, `${String(year)}-${month}-${day}.json`);
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
 */
export async function releaseLock(filePath: string): Promise<void> {
  const lockPath = `${filePath}.lock`;
  try {
    await fs.unlink(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
