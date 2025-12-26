import path from 'node:path';

import { Metric, MetricCommon } from '../models/Metric';
import { MetricName } from '../models/MetricName';
import { mapRoute, mapWorkoutData, WorkoutData } from '../models/Workout';
import { logger } from '../utils/logger';
import {
  atomicWrite,
  ensureDirectory,
  getDateKey,
  getFilePath,
  readJsonFile,
  withLock,
} from './fileHelpers';
import { MetricDailyFile, SaveResult, StoredRoute, StoredWorkout, WorkoutDailyFile } from './types';

export class FileStorage {
  private dataDirectory: string;

  constructor(dataDirectory?: string) {
    this.dataDirectoryectory = dataDirectory ?? process.env.DATA_DIR ?? './data';
  }

  /**
   * Initialize storage directories.
   */
  async init(): Promise<void> {
    const resolvedPath = path.resolve(this.dataDirectory);
    logger.info('Initializing file storage', { dataDirectory: resolvedPath });

    await ensureDirectory(path.join(this.dataDirectory, 'metrics'));
    await ensureDirectory(path.join(this.dataDirectory, 'workouts'));

    logger.info('File storage initialized', { dataDirectory: resolvedPath });
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
}
