import { promises as fs } from 'node:fs';
import path from 'node:path';

import { CacheConfig, StorageConfig } from '../config';
import { mapRoute, mapWorkoutData } from '../mappers';
import { buildMetricIdentityMap, createMetricIdentityKey } from '../utils/deduplication';
import { logger } from '../utils/logger';
import {
  atomicWrite,
  ensureDirectory,
  getFilePath,
  readJsonFile,
  readJsonFileOptional,
  withLock,
} from './fileHelpers';

import type {
  Metric,
  MetricCommon,
  MetricDailyFile,
  SaveResult,
  StoredRoute,
  StoredWorkout,
  WorkoutDailyFile,
  WorkoutData,
} from '../types';

/**
 * Rolling cache storage for health data deduplication.
 * Stores data for the last N days (configurable) to enable
 * duplicate detection before writing to Obsidian.
 */
export class CacheStorage {
  private cleanupConsecutiveFailures = 0;
  private dataDirectory: string;
  private retentionDays: number;

  constructor(dataDirectory?: string, retentionDays?: number) {
    this.dataDirectory = dataDirectory ?? StorageConfig.dataDir;
    this.retentionDays = retentionDays ?? CacheConfig.retentionDays;
  }

  /**
   * Initialize storage directories.
   */
  async init(): Promise<void> {
    const resolvedPath = path.resolve(this.dataDirectory);
    logger.info('Initializing cache storage', {
      dataDirectory: resolvedPath,
      retentionDays: this.retentionDays,
    });

    await ensureDirectory(path.join(this.dataDirectory, StorageConfig.metricsDir));
    await ensureDirectory(path.join(this.dataDirectory, StorageConfig.workoutsDir));

    logger.info('Cache storage initialized', { dataDirectory: resolvedPath });
  }

  // === CACHE READING ===

  /**
   * Read cached metrics for specific dates.
   * Used for deduplication before writing to Obsidian.
   */
  async getMetricsForDates(dateKeys: string[]): Promise<Map<string, MetricDailyFile>> {
    const result = new Map<string, MetricDailyFile>();

    for (const dateKey of dateKeys) {
      const date = new Date(dateKey + 'T00:00:00.000Z');
      const filePath = this.getMetricsFilePath(date);

      try {
        const content = await readJsonFileOptional<MetricDailyFile>(filePath);
        if (content) {
          result.set(dateKey, content);
        }
      } catch (error) {
        const errorCode = (error as NodeJS.ErrnoException).code;
        // ENOENT is expected (cache miss), log at debug level
        if (errorCode === 'ENOENT') {
          logger.debug('Cache miss for metrics', { dateKey });
        } else {
          // JSON parse errors, permission issues, corruption - log as warning
          logger.warn('Failed to read metrics cache file', {
            code: errorCode,
            dateKey,
            error: error instanceof Error ? error.message : 'Unknown error',
            filePath,
          });
        }
      }
    }

    return result;
  }

  /**
   * Read cached workouts for specific dates.
   * Used for deduplication before writing to Obsidian.
   */
  async getWorkoutsForDates(dateKeys: string[]): Promise<Map<string, WorkoutDailyFile>> {
    const result = new Map<string, WorkoutDailyFile>();

    for (const dateKey of dateKeys) {
      const date = new Date(dateKey + 'T00:00:00.000Z');
      const filePath = this.getWorkoutsFilePath(date);

      try {
        const content = await readJsonFileOptional<WorkoutDailyFile>(filePath);
        if (content) {
          result.set(dateKey, content);
        }
      } catch (error) {
        const errorCode = (error as NodeJS.ErrnoException).code;
        // ENOENT is expected (cache miss), log at debug level
        if (errorCode === 'ENOENT') {
          logger.debug('Cache miss for workouts', { dateKey });
        } else {
          // JSON parse errors, permission issues, corruption - log as warning
          logger.warn('Failed to read workouts cache file', {
            code: errorCode,
            dateKey,
            error: error instanceof Error ? error.message : 'Unknown error',
            filePath,
          });
        }
      }
    }

    return result;
  }

  // === CACHE CLEANUP ===

  /**
   * Remove cache files older than retentionDays.
   * Called after each successful data ingestion.
   * Tracks consecutive failures and throws after MAX_CLEANUP_FAILURES to prevent disk from filling up.
   */
  async cleanupExpiredCache(): Promise<{ deletedFiles: number }> {
    if (this.retentionDays <= 0) {
      logger.debug('Cache cleanup disabled (retentionDays <= 0)');
      return { deletedFiles: 0 };
    }

    const cutoffDate = new Date();
    cutoffDate.setUTCDate(cutoffDate.getUTCDate() - this.retentionDays);
    cutoffDate.setUTCHours(0, 0, 0, 0);

    let deletedFiles = 0;
    let cleanupSucceeded = true;

    // Cleanup both metrics and workouts directories
    for (const subDirectory of [StorageConfig.metricsDir, StorageConfig.workoutsDir]) {
      const baseDirectory = path.join(this.dataDirectory, subDirectory);
      try {
        deletedFiles += await this.cleanupDirectory(baseDirectory, cutoffDate);
      } catch (error) {
        cleanupSucceeded = false;
        logger.error('Cache cleanup failed for directory', error, {
          baseDirectory,
          consecutiveFailures: this.cleanupConsecutiveFailures + 1,
        });
      }
    }

    if (cleanupSucceeded) {
      // Reset failure counter on success
      this.cleanupConsecutiveFailures = 0;

      if (deletedFiles > 0) {
        logger.info('Cache cleanup completed', {
          cutoffDate: cutoffDate.toISOString(),
          deletedFiles,
          retentionDays: this.retentionDays,
        });
      }
    } else {
      this.cleanupConsecutiveFailures++;

      if (this.cleanupConsecutiveFailures >= CacheConfig.maxCleanupFailures) {
        const errorMessage = `Cache cleanup failed ${String(this.cleanupConsecutiveFailures)} consecutive times - disk may fill up`;
        logger.error(errorMessage, undefined, {
          consecutiveFailures: this.cleanupConsecutiveFailures,
          maxFailures: CacheConfig.maxCleanupFailures,
        });
        throw new Error(errorMessage);
      }

      logger.warn('Cache cleanup partially failed', {
        consecutiveFailures: this.cleanupConsecutiveFailures,
        deletedFiles,
        maxFailures: CacheConfig.maxCleanupFailures,
      });
    }

    return { deletedFiles };
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity -- Nested directory traversal requires this structure
  private async cleanupDirectory(baseDirectory: string, cutoffDate: Date): Promise<number> {
    let deletedCount = 0;

    // Calculate cutoff year/month for early termination optimization
    const cutoffYear = cutoffDate.getUTCFullYear();
    const cutoffMonth = cutoffDate.getUTCMonth() + 1; // 1-indexed

    try {
      // List year directories
      const years = await fs.readdir(baseDirectory);

      for (const year of years) {
        if (!CacheConfig.patterns.yearRegex.test(year)) continue;

        const yearNumber = Number.parseInt(year, 10);

        // OPTIMIZATION: Skip entire years newer than cutoff year
        // (all files in these years are within retention)
        if (yearNumber > cutoffYear) {
          continue;
        }

        const yearDirectory = path.join(baseDirectory, year);
        const yearStats = await fs.stat(yearDirectory);
        if (!yearStats.isDirectory()) continue;

        // List month directories
        const months = await fs.readdir(yearDirectory);

        for (const month of months) {
          if (!CacheConfig.patterns.monthRegex.test(month)) continue;

          const monthNumber = Number.parseInt(month, 10);

          // OPTIMIZATION: Skip months in cutoff year that are >= cutoff month
          // (all files in these months are within retention)
          if (yearNumber === cutoffYear && monthNumber >= cutoffMonth) {
            continue;
          }

          const monthDirectory = path.join(yearDirectory, month);
          const monthStats = await fs.stat(monthDirectory);
          if (!monthStats.isDirectory()) continue;

          // List day files
          const files = await fs.readdir(monthDirectory);

          for (const file of files) {
            const match = CacheConfig.patterns.dateFileRegex.exec(file);
            if (!match) continue;

            const fileDate = new Date(match[1] + 'T00:00:00.000Z');
            if (fileDate < cutoffDate) {
              const filePath = path.join(monthDirectory, file);
              try {
                await fs.unlink(filePath);
                deletedCount++;
                logger.debug('Deleted expired cache file', { filePath });
              } catch (error) {
                logger.warn('Failed to delete cache file', { error, filePath });
              }
            }
          }

          // Try to remove empty month directory
          try {
            await fs.rmdir(monthDirectory);
            logger.debug('Removed empty month directory', { monthDirectory });
          } catch {
            // Directory not empty, ignore
          }
        }

        // Try to remove empty year directory
        try {
          await fs.rmdir(yearDirectory);
          logger.debug('Removed empty year directory', { yearDirectory });
        } catch {
          // Directory not empty, ignore
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error('Cache cleanup error', error);
      }
    }

    return deletedCount;
  }

  // === SAVE METHODS ===

  /**
   * Save pre-deduplicated metrics to cache storage.
   * Uses identity-based upsert (date+source+type) within each file for concurrency safety.
   */
  async saveMetrics(metricsByType: Record<string, Metric[]>): Promise<SaveResult> {
    // Group all metrics by date, then by type
    const byDate = new Map<string, Record<string, Metric[]>>();

    for (const [metricType, metrics] of Object.entries(metricsByType)) {
      for (const metric of metrics) {
        const dateKey = (metric as MetricCommon).sourceDate;
        let dateMetrics = byDate.get(dateKey);
        if (!dateMetrics) {
          dateMetrics = {};
          byDate.set(dateKey, dateMetrics);
        }
        dateMetrics[metricType] ??= [];
        dateMetrics[metricType].push(metric);
      }
    }

    let totalSaved = 0;
    const errors: string[] = [];

    // Process each date file sequentially to avoid race conditions
    for (const [dateKey, typeMetrics] of byDate) {
      const date = new Date(dateKey + 'T00:00:00.000Z');
      const filePath = this.getMetricsFilePath(date);

      try {
        const saved = await this.appendMetricsToFile(typeMetrics, filePath, dateKey);
        totalSaved += saved;
      } catch (error) {
        logger.error('Failed to save metrics to file', error, { dateKey });
        errors.push(`${dateKey}: ${(error as Error).message}`);
      }
    }

    logger.debug('Metrics saved to cache storage', {
      filesWritten: byDate.size,
      metricTypes: Object.keys(metricsByType).length,
      saved: totalSaved,
    });

    return {
      errors: errors.length > 0 ? errors : undefined,
      saved: totalSaved,
      success: errors.length === 0,
      updated: 0, // Direct append mode, no updates
    };
  }

  /**
   * Save pre-deduplicated workouts to cache storage.
   * Uses workout ID as key for upsert within each file for concurrency safety.
   */
  async saveWorkouts(workouts: WorkoutData[]): Promise<SaveResult> {
    if (workouts.length === 0) {
      return { saved: 0, success: true, updated: 0 };
    }

    logger.debug('Saving workouts directly to storage (pre-deduplicated)', {
      count: workouts.length,
    });

    // Group workouts by start date
    const byDate = new Map<string, WorkoutData[]>();

    for (const workout of workouts) {
      const dateKey = workout.sourceDate;
      let dateWorkouts = byDate.get(dateKey);
      if (!dateWorkouts) {
        dateWorkouts = [];
        byDate.set(dateKey, dateWorkouts);
      }
      dateWorkouts.push(workout);
    }

    let totalSaved = 0;
    const errors: string[] = [];

    // Process each date file
    for (const [dateKey, dateWorkouts] of byDate) {
      const date = new Date(dateKey + 'T00:00:00.000Z');
      const filePath = this.getWorkoutsFilePath(date);

      try {
        const saved = await this.appendWorkoutsToFile(dateWorkouts, filePath, dateKey);
        totalSaved += saved;
      } catch (error) {
        logger.error('Failed to save workouts to file', error, { dateKey });
        errors.push(`${dateKey}: ${(error as Error).message}`);
      }
    }

    logger.debug('Workouts saved to cache storage', {
      filesWritten: byDate.size,
      saved: totalSaved,
    });

    return {
      errors: errors.length > 0 ? errors : undefined,
      saved: totalSaved,
      success: errors.length === 0,
      updated: 0, // Direct append mode, no updates
    };
  }

  // === PATH HELPERS ===

  private getMetricsFilePath(date: Date): string {
    return getFilePath(path.join(this.dataDirectory, StorageConfig.metricsDir), date);
  }

  private getWorkoutsFilePath(date: Date): string {
    return getFilePath(path.join(this.dataDirectory, StorageConfig.workoutsDir), date);
  }

  // === SAVE HELPERS ===

  /**
   * Upsert metrics to file using identity-based deduplication.
   * Uses identity key (date+source+type) to find existing metrics for update.
   */
  private async appendMetricsToFile(
    typeMetrics: Record<string, Metric[]>,
    filePath: string,
    dateKey: string,
  ): Promise<number> {
    // Use file locking to prevent race conditions on concurrent writes
    return withLock(filePath, async () => {
      const content = await readJsonFile<MetricDailyFile>(filePath, {
        date: dateKey,
        metrics: {},
        version: 1,
      });

      let saved = 0;

      for (const [metricType, metrics] of Object.entries(typeMetrics)) {
        content.metrics[metricType] ??= [];

        // Build identity map for O(1) upsert lookup (date+source+type, no value)
        const identityMap = buildMetricIdentityMap(content.metrics[metricType], metricType);

        for (const metric of metrics) {
          const identityKey = createMetricIdentityKey(metric, metricType);
          const existingIndex = identityMap.get(identityKey);

          if (existingIndex === undefined) {
            // New metric - append
            content.metrics[metricType].push(metric);
            identityMap.set(identityKey, content.metrics[metricType].length - 1);
            saved++;
          } else {
            // Existing metric - update with latest value (upsert)
            content.metrics[metricType][existingIndex] = metric;
            // Note: Not counting as "saved" since it's an update
          }
        }
      }

      await atomicWrite(filePath, content);
      return saved;
    });
  }

  /**
   * Append workouts to file using workout ID as upsert key.
   */
  private async appendWorkoutsToFile(
    workouts: WorkoutData[],
    filePath: string,
    dateKey: string,
  ): Promise<number> {
    // Use file locking to prevent race conditions on concurrent writes
    return withLock(filePath, async () => {
      const content = await readJsonFile<WorkoutDailyFile>(filePath, {
        date: dateKey,
        routes: {},
        version: 1,
        workouts: {},
      });

      for (const workout of workouts) {
        // Upsert workout (use ID as key for storage structure compatibility)
        const mappedWorkout = mapWorkoutData(workout);
        content.workouts[workout.id] = mappedWorkout as StoredWorkout;

        // Upsert route if present
        if (workout.route && workout.route.length > 0) {
          const mappedRoute = mapRoute(workout);
          content.routes[workout.id] = mappedRoute as StoredRoute;
        }
      }

      await atomicWrite(filePath, content);
      return workouts.length;
    });
  }
}
