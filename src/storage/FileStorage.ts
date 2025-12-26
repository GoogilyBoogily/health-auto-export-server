import * as path from 'path';

import {
  ensureDir,
  atomicWrite,
  readJsonFile,
  getDateKey,
  getFilePath,
  withLock,
} from './fileHelpers';
import { MetricDailyFile, WorkoutDailyFile, SaveResult, StoredWorkout, StoredRoute } from './types';
import { Metric, MetricCommon } from '../models/Metric';
import { MetricName } from '../models/MetricName';
import { WorkoutData, mapWorkoutData, mapRoute } from '../models/Workout';
import { logger } from '../utils/logger';

export class FileStorage {
  private dataDir: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir || process.env.DATA_DIR || './data';
  }

  /**
   * Initialize storage directories.
   */
  async init(): Promise<void> {
    const resolvedPath = path.resolve(this.dataDir);
    logger.info('Initializing file storage', { dataDir: resolvedPath });

    await ensureDir(path.join(this.dataDir, 'metrics'));
    await ensureDir(path.join(this.dataDir, 'workouts'));

    logger.info('File storage initialized', { dataDir: resolvedPath });
  }

  // === PATH HELPERS ===

  private getMetricsFilePath(date: Date): string {
    return getFilePath(path.join(this.dataDir, 'metrics'), date);
  }

  private getWorkoutsFilePath(date: Date): string {
    return getFilePath(path.join(this.dataDir, 'workouts'), date);
  }

  // === METRICS ===

  /**
   * Create a deduplication key for a metric.
   * Uses date ISO string + source to match MongoDB's unique index.
   */
  private getMetricKey(metric: Metric & MetricCommon): string {
    const date = new Date(metric.date).toISOString();
    const source = metric.source || '';
    return `${date}|${source}`;
  }

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
        if (!byDate.has(dateKey)) {
          byDate.set(dateKey, {});
        }
        const dateMetrics = byDate.get(dateKey)!;
        if (!dateMetrics[metricType]) {
          dateMetrics[metricType] = [];
        }
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
      } catch (err) {
        logger.error('Failed to save metrics to file', err, { dateKey });
        errors.push(`${dateKey}: ${(err as Error).message}`);
      }
    }

    logger.debug('All metrics saved to storage', {
      saved: totalSaved,
      updated: totalUpdated,
      filesWritten: byDate.size,
      metricTypes: Object.keys(metricsByType).length,
    });

    return {
      success: errors.length === 0,
      saved: totalSaved,
      updated: totalUpdated,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  private async saveAllMetricsToFile(
    typeMetrics: Record<string, Metric[]>,
    filePath: string,
    dateKey: string,
  ): Promise<{ saved: number; updated: number }> {
    // Use file locking to prevent race conditions on concurrent writes
    return withLock(filePath, async () => {
      const content = await readJsonFile<MetricDailyFile>(filePath, {
        version: 1,
        date: dateKey,
        metrics: {},
      });

      let saved = 0;
      let updated = 0;

      for (const [metricType, metrics] of Object.entries(typeMetrics)) {
        content.metrics[metricType] = content.metrics[metricType] || [];

        // Build lookup map for O(1) deduplication
        const existingMap = new Map<string, number>();
        content.metrics[metricType]!.forEach((m: Metric, i: number) => {
          existingMap.set(this.getMetricKey(m), i);
        });

        for (const metric of metrics) {
          const key = this.getMetricKey(metric);
          const existingIndex = existingMap.get(key);

          if (existingIndex !== undefined) {
            content.metrics[metricType]![existingIndex] = metric;
            updated++;
          } else {
            content.metrics[metricType]!.push(metric);
            existingMap.set(key, content.metrics[metricType]!.length - 1);
            saved++;
          }
        }
      }

      await atomicWrite(filePath, content);
      return { saved, updated };
    });
  }

  /**
   * Save metrics to storage (single type).
   * Groups metrics by date and performs read-merge-write for each day.
   * NOTE: Use saveAllMetrics() when saving multiple types to avoid race conditions.
   */
  async saveMetrics(metricType: MetricName, metrics: Metric[]): Promise<SaveResult> {
    if (!metrics || metrics.length === 0) {
      return { success: true, saved: 0, updated: 0 };
    }

    logger.debug('Saving metrics to storage', {
      metricType,
      count: metrics.length,
    });

    // Group metrics by date
    const byDate = new Map<string, Metric[]>();

    for (const metric of metrics) {
      const dateKey = getDateKey((metric as MetricCommon).date);
      if (!byDate.has(dateKey)) {
        byDate.set(dateKey, []);
      }
      byDate.get(dateKey)!.push(metric);
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
      } catch (err) {
        logger.error('Failed to save metrics to file', err, { dateKey, metricType });
        errors.push(`${dateKey}: ${(err as Error).message}`);
      }
    }

    logger.debug('Metrics saved to storage', {
      metricType,
      saved: totalSaved,
      updated: totalUpdated,
      filesWritten: byDate.size,
      hasErrors: errors.length > 0,
    });

    return {
      success: errors.length === 0,
      saved: totalSaved,
      updated: totalUpdated,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  private async saveMetricsToFile(
    metricType: MetricName,
    metrics: Metric[],
    filePath: string,
    dateKey: string,
  ): Promise<{ saved: number; updated: number }> {
    // Use file locking to prevent race conditions on concurrent writes
    return withLock(filePath, async () => {
      const content = await readJsonFile<MetricDailyFile>(filePath, {
        version: 1,
        date: dateKey,
        metrics: {},
      });

      content.metrics[metricType] = content.metrics[metricType] || [];

      // Build lookup map for O(1) deduplication
      const existingMap = new Map<string, number>();
      content.metrics[metricType]!.forEach((m: Metric, i: number) => {
        existingMap.set(this.getMetricKey(m), i);
      });

      let saved = 0;
      let updated = 0;

      for (const metric of metrics) {
        const key = this.getMetricKey(metric);
        const existingIndex = existingMap.get(key);

        if (existingIndex !== undefined) {
          content.metrics[metricType]![existingIndex] = metric;
          updated++;
        } else {
          content.metrics[metricType]!.push(metric);
          existingMap.set(key, content.metrics[metricType]!.length - 1);
          saved++;
        }
      }

      await atomicWrite(filePath, content);
      return { saved, updated };
    });
  }

  // === WORKOUTS ===

  /**
   * Save workouts to storage.
   * Groups workouts by start date and performs read-merge-write for each day.
   */
  async saveWorkouts(workouts: WorkoutData[]): Promise<SaveResult> {
    if (!workouts || workouts.length === 0) {
      return { success: true, saved: 0, updated: 0 };
    }

    logger.debug('Saving workouts to storage', { count: workouts.length });

    // Group workouts by start date
    const byDate = new Map<string, WorkoutData[]>();

    for (const workout of workouts) {
      const dateKey = getDateKey(workout.start);
      if (!byDate.has(dateKey)) {
        byDate.set(dateKey, []);
      }
      byDate.get(dateKey)!.push(workout);
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
      } catch (err) {
        logger.error('Failed to save workouts to file', err, { dateKey });
        errors.push(`${dateKey}: ${(err as Error).message}`);
      }
    }

    logger.debug('Workouts saved to storage', {
      saved: totalSaved,
      updated: totalUpdated,
      filesWritten: byDate.size,
      hasErrors: errors.length > 0,
    });

    return {
      success: errors.length === 0,
      saved: totalSaved,
      updated: totalUpdated,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  private async saveWorkoutsToFile(
    workouts: WorkoutData[],
    filePath: string,
    dateKey: string,
  ): Promise<{ saved: number; updated: number }> {
    // Use file locking to prevent race conditions on concurrent writes
    return withLock(filePath, async () => {
      const content = await readJsonFile<WorkoutDailyFile>(filePath, {
        version: 1,
        date: dateKey,
        workouts: {},
        routes: {},
      });

      let saved = 0;
      let updated = 0;

      for (const workout of workouts) {
        // Check if updating or inserting
        if (content.workouts[workout.id]) {
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
}
