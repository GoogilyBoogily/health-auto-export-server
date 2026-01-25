import { promises as fs } from 'node:fs';
import path from 'node:path';

import { mapRoute, mapWorkoutData } from '../mappers';
import { logger } from '../utils/logger';
import {
  atomicWrite,
  ensureDirectory,
  getDateKey,
  getFilePath,
  readJsonFile,
  readJsonFileOptional,
  withLock,
} from './fileHelpers';

import type {
  Metric,
  MetricCommon,
  MetricDailyFile,
  MetricName,
  SaveResult,
  StoredRoute,
  StoredWorkout,
  WorkoutDailyFile,
  WorkoutData,
} from '../types';

const DEFAULT_RETENTION_DAYS = 7;
const MAX_CLEANUP_FAILURES = 5;

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
    this.dataDirectory = dataDirectory ?? process.env.DATA_DIR ?? './data';
    this.retentionDays = retentionDays ?? DEFAULT_RETENTION_DAYS;
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

    await ensureDirectory(path.join(this.dataDirectory, 'metrics'));
    await ensureDirectory(path.join(this.dataDirectory, 'workouts'));

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
    for (const subDirectory of ['metrics', 'workouts']) {
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

      if (this.cleanupConsecutiveFailures >= MAX_CLEANUP_FAILURES) {
        const errorMessage = `Cache cleanup failed ${String(this.cleanupConsecutiveFailures)} consecutive times - disk may fill up`;
        logger.error(errorMessage, undefined, {
          consecutiveFailures: this.cleanupConsecutiveFailures,
          maxFailures: MAX_CLEANUP_FAILURES,
        });
        throw new Error(errorMessage);
      }

      logger.warn('Cache cleanup partially failed', {
        consecutiveFailures: this.cleanupConsecutiveFailures,
        deletedFiles,
        maxFailures: MAX_CLEANUP_FAILURES,
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
        if (!/^\d{4}$/.test(year)) continue;

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
          if (!/^\d{2}$/.test(month)) continue;

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
            const match = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(file);
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

  // === PATH HELPERS ===

  /**
   * Save all metrics to storage (batch operation).
   * Groups all metrics by date first, then writes each date file once to avoid race conditions.
   */
  async saveAllMetrics(metricsByType: Record<string, Metric[]>): Promise<SaveResult> {
    // Group all metrics by date, then by type
    const byDate = new Map<string, Record<string, Metric[]>>();

    for (const [metricType, metrics] of Object.entries(metricsByType)) {
      for (const metric of metrics) {
        const dateKey = getDateKey((metric as MetricCommon).date);
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
    let totalUpdated = 0;
    const errors: string[] = [];

    // Process each date file sequentially to avoid race conditions
    for (const [dateKey, typeMetrics] of byDate) {
      const date = new Date(dateKey + 'T00:00:00.000Z');
      const filePath = this.getMetricsFilePath(date);

      try {
        const result = await this.saveAllMetricsToFile(typeMetrics, filePath, dateKey);
        totalSaved += result.saved;
        totalUpdated += result.updated;
      } catch (error) {
        logger.error('Failed to save metrics to file', error, { dateKey });
        errors.push(`${dateKey}: ${(error as Error).message}`);
      }
    }

    logger.debug('All metrics saved to storage', {
      filesWritten: byDate.size,
      metricTypes: Object.keys(metricsByType).length,
      saved: totalSaved,
      updated: totalUpdated,
    });

    return {
      errors: errors.length > 0 ? errors : undefined,
      saved: totalSaved,
      success: errors.length === 0,
      updated: totalUpdated,
    };
  }

  /**
   * Save metrics to storage (single type).
   * Groups metrics by date and performs read-merge-write for each day.
   * NOTE: Use saveAllMetrics() when saving multiple types to avoid race conditions.
   */
  async saveMetrics(metricType: MetricName, metrics: Metric[]): Promise<SaveResult> {
    if (metrics.length === 0) {
      return { saved: 0, success: true, updated: 0 };
    }

    logger.debug('Saving metrics to storage', {
      count: metrics.length,
      metricType,
    });

    // Group metrics by date
    const byDate = new Map<string, Metric[]>();

    for (const metric of metrics) {
      const dateKey = getDateKey((metric as MetricCommon).date);
      let dateMetrics = byDate.get(dateKey);
      if (!dateMetrics) {
        dateMetrics = [];
        byDate.set(dateKey, dateMetrics);
      }
      dateMetrics.push(metric);
    }

    let totalSaved = 0;
    let totalUpdated = 0;
    const errors: string[] = [];

    // Process each date file
    for (const [dateKey, dateMetrics] of byDate) {
      const date = new Date(dateKey + 'T00:00:00.000Z');
      const filePath = this.getMetricsFilePath(date);

      try {
        const result = await this.saveMetricsToFile(metricType, dateMetrics, filePath, dateKey);
        totalSaved += result.saved;
        totalUpdated += result.updated;
      } catch (error) {
        logger.error('Failed to save metrics to file', error, { dateKey, metricType });
        errors.push(`${dateKey}: ${(error as Error).message}`);
      }
    }

    logger.debug('Metrics saved to storage', {
      filesWritten: byDate.size,
      hasErrors: errors.length > 0,
      metricType,
      saved: totalSaved,
      updated: totalUpdated,
    });

    return {
      errors: errors.length > 0 ? errors : undefined,
      saved: totalSaved,
      success: errors.length === 0,
      updated: totalUpdated,
    };
  }

  // === DIRECT SAVE METHODS (for pre-deduplicated data) ===

  /**
   * Save metrics that have already been deduplicated upstream.
   * Appends metrics without checking for duplicates (since caller guarantees uniqueness).
   * Still uses file locking for concurrency safety.
   * Use this after filterDuplicateMetrics() has already removed duplicates.
   */
  async saveMetricsDirectly(metricsByType: Record<string, Metric[]>): Promise<SaveResult> {
    // Group all metrics by date, then by type
    const byDate = new Map<string, Record<string, Metric[]>>();

    for (const [metricType, metrics] of Object.entries(metricsByType)) {
      for (const metric of metrics) {
        const dateKey = getDateKey((metric as MetricCommon).date);
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

    logger.debug('Metrics saved directly to storage (pre-deduplicated)', {
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
   * Save workouts that have already been deduplicated upstream.
   * Appends workouts without checking for duplicates (since caller guarantees uniqueness).
   * Still uses file locking for concurrency safety.
   * Use this after filterDuplicateWorkouts() has already removed duplicates.
   */
  async saveWorkoutsDirectly(workouts: WorkoutData[]): Promise<SaveResult> {
    if (workouts.length === 0) {
      return { saved: 0, success: true, updated: 0 };
    }

    logger.debug('Saving workouts directly to storage (pre-deduplicated)', {
      count: workouts.length,
    });

    // Group workouts by start date
    const byDate = new Map<string, WorkoutData[]>();

    for (const workout of workouts) {
      const dateKey = getDateKey(workout.start);
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

    logger.debug('Workouts saved directly to storage (pre-deduplicated)', {
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

  // === METRICS ===

  /**
   * Save workouts to storage.
   * Groups workouts by start date and performs read-merge-write for each day.
   */
  async saveWorkouts(workouts: WorkoutData[]): Promise<SaveResult> {
    if (workouts.length === 0) {
      return { saved: 0, success: true, updated: 0 };
    }

    logger.debug('Saving workouts to storage', { count: workouts.length });

    // Group workouts by start date
    const byDate = new Map<string, WorkoutData[]>();

    for (const workout of workouts) {
      const dateKey = getDateKey(workout.start);
      let dateWorkouts = byDate.get(dateKey);
      if (!dateWorkouts) {
        dateWorkouts = [];
        byDate.set(dateKey, dateWorkouts);
      }
      dateWorkouts.push(workout);
    }

    let totalSaved = 0;
    let totalUpdated = 0;
    const errors: string[] = [];

    // Process each date file
    for (const [dateKey, dateWorkouts] of byDate) {
      const date = new Date(dateKey + 'T00:00:00.000Z');
      const filePath = this.getWorkoutsFilePath(date);

      try {
        const result = await this.saveWorkoutsToFile(dateWorkouts, filePath, dateKey);
        totalSaved += result.saved;
        totalUpdated += result.updated;
      } catch (error) {
        logger.error('Failed to save workouts to file', error, { dateKey });
        errors.push(`${dateKey}: ${(error as Error).message}`);
      }
    }

    logger.debug('Workouts saved to storage', {
      filesWritten: byDate.size,
      hasErrors: errors.length > 0,
      saved: totalSaved,
      updated: totalUpdated,
    });

    return {
      errors: errors.length > 0 ? errors : undefined,
      saved: totalSaved,
      success: errors.length === 0,
      updated: totalUpdated,
    };
  }

  /**
   * Create a deduplication key for a metric.
   * Uses date ISO string + source to match MongoDB's unique index.
   */
  private getMetricKey(metric: Metric & MetricCommon): string {
    const date = new Date(metric.date).toISOString();
    const source = metric.source ?? '';
    return `${date}|${source}`;
  }

  private getMetricsFilePath(date: Date): string {
    return getFilePath(path.join(this.dataDirectory, 'metrics'), date);
  }

  private getWorkoutsFilePath(date: Date): string {
    return getFilePath(path.join(this.dataDirectory, 'workouts'), date);
  }

  private async saveAllMetricsToFile(
    typeMetrics: Record<string, Metric[]>,
    filePath: string,
    dateKey: string,
  ): Promise<{ saved: number; updated: number }> {
    // Use file locking to prevent race conditions on concurrent writes
    return withLock(filePath, async () => {
      const content = await readJsonFile<MetricDailyFile>(filePath, {
        date: dateKey,
        metrics: {},
        version: 1,
      });

      let saved = 0;
      let updated = 0;

      for (const [metricType, metrics] of Object.entries(typeMetrics)) {
        content.metrics[metricType] ??= [];

        // Build lookup map for O(1) deduplication
        const existingMap = new Map<string, number>();
        for (const [index, m] of content.metrics[metricType].entries()) {
          existingMap.set(this.getMetricKey(m), index);
        }

        for (const metric of metrics) {
          const key = this.getMetricKey(metric);
          const existingIndex = existingMap.get(key);

          if (existingIndex === undefined) {
            content.metrics[metricType].push(metric);
            existingMap.set(key, content.metrics[metricType].length - 1);
            saved++;
          } else {
            content.metrics[metricType][existingIndex] = metric;
            updated++;
          }
        }
      }

      await atomicWrite(filePath, content);
      return { saved, updated };
    });
  }

  // === WORKOUTS ===

  private async saveMetricsToFile(
    metricType: MetricName,
    metrics: Metric[],
    filePath: string,
    dateKey: string,
  ): Promise<{ saved: number; updated: number }> {
    // Use file locking to prevent race conditions on concurrent writes
    return withLock(filePath, async () => {
      const content = await readJsonFile<MetricDailyFile>(filePath, {
        date: dateKey,
        metrics: {},
        version: 1,
      });

      content.metrics[metricType] ??= [];

      // Build lookup map for O(1) deduplication
      const existingMap = new Map<string, number>();
      for (const [index, m] of content.metrics[metricType].entries()) {
        existingMap.set(this.getMetricKey(m), index);
      }

      let saved = 0;
      let updated = 0;

      for (const metric of metrics) {
        const key = this.getMetricKey(metric);
        const existingIndex = existingMap.get(key);

        if (existingIndex === undefined) {
          content.metrics[metricType].push(metric);
          existingMap.set(key, content.metrics[metricType].length - 1);
          saved++;
        } else {
          content.metrics[metricType][existingIndex] = metric;
          updated++;
        }
      }

      await atomicWrite(filePath, content);
      return { saved, updated };
    });
  }

  private async saveWorkoutsToFile(
    workouts: WorkoutData[],
    filePath: string,
    dateKey: string,
  ): Promise<{ saved: number; updated: number }> {
    // Use file locking to prevent race conditions on concurrent writes
    return withLock(filePath, async () => {
      const content = await readJsonFile<WorkoutDailyFile>(filePath, {
        date: dateKey,
        routes: {},
        version: 1,
        workouts: {},
      });

      let saved = 0;
      let updated = 0;

      for (const workout of workouts) {
        // Check if updating or inserting
        if (workout.id in content.workouts) {
          updated++;
        } else {
          saved++;
        }

        // Upsert workout
        const mappedWorkout = mapWorkoutData(workout);
        content.workouts[workout.id] = mappedWorkout as StoredWorkout;

        // Upsert route if present
        if (workout.route && workout.route.length > 0) {
          const mappedRoute = mapRoute(workout);
          content.routes[workout.id] = mappedRoute as StoredRoute;
        }
      }

      await atomicWrite(filePath, content);
      return { saved, updated };
    });
  }

  // === DIRECT APPEND HELPERS (for pre-deduplicated data) ===

  /**
   * Append metrics to file with re-deduplication inside the lock.
   * Called by saveMetricsDirectly() after upstream deduplication.
   *
   * Re-checks for duplicates inside the lock to handle race conditions
   * where two concurrent requests both pass upstream dedup but one
   * writes before the other acquires the lock.
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

        // Build lookup map for O(1) deduplication (re-check inside lock)
        const existingMap = new Map<string, number>();
        for (const [index, m] of content.metrics[metricType].entries()) {
          existingMap.set(this.getMetricKey(m), index);
        }

        // Only append metrics that don't already exist
        for (const metric of metrics) {
          const key = this.getMetricKey(metric);
          if (!existingMap.has(key)) {
            content.metrics[metricType].push(metric);
            existingMap.set(key, content.metrics[metricType].length - 1);
            saved++;
          }
          // Skip duplicates silently (race condition from concurrent requests)
        }
      }

      await atomicWrite(filePath, content);
      return saved;
    });
  }

  /**
   * Append workouts directly to file without deduplication checks.
   * Called by saveWorkoutsDirectly() after upstream deduplication.
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
