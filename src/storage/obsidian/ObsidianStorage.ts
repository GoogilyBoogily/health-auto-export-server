/**
 * ObsidianStorage - Writes health data to Obsidian vault as Markdown with YAML frontmatter.
 */

import { promises as fs } from 'node:fs';

import { MetricName } from '../../types';
import { debugLog, debugStorage, isDebugEnabled } from '../../utils/debugLogger';
import { logger } from '../../utils/logger';
import { withLock } from '../fileHelpers';
import { createHealthFrontmatter, groupHealthMetricsByDate } from './formatters/health';
import { createSleepFrontmatter, groupSleepMetricsByDate, isSleepMetric } from './formatters/sleep';
import { createWorkoutFrontmatter, groupWorkoutsByDate } from './formatters/workout';
import {
  getDefaultBody,
  getTrackingFilePath,
  readMarkdownFile,
  writeMarkdownFile,
} from './utils/markdownUtilities';

import type {
  BaseMetric,
  HealthFrontmatter,
  Metric,
  SaveResult,
  SleepFrontmatter,
  SleepMetric,
  WorkoutData,
  WorkoutFrontmatter,
} from '../../types';

// Night boundary hour for wrist temperature date assignment
// Temperature readings before this hour belong to previous day's sleep
const NIGHT_BOUNDARY_HOUR = 6;

export class ObsidianStorage {
  private vaultPath: string;

  constructor(vaultPath: string) {
    this.vaultPath = vaultPath;
  }

  /**
   * Initialize storage - verify vault path exists and is accessible.
   */
  async init(): Promise<void> {
    logger.info('Initializing Obsidian storage', { vaultPath: this.vaultPath });

    try {
      const stats = await fs.stat(this.vaultPath);
      if (!stats.isDirectory()) {
        throw new Error(`Vault path is not a directory: ${this.vaultPath}`);
      }
      // Test write access by checking if we can access the directory
      await fs.access(this.vaultPath, fs.constants.W_OK);
      logger.info('Obsidian vault path validated successfully');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Obsidian vault path does not exist: ${this.vaultPath}`);
      }
      if ((error as NodeJS.ErrnoException).code === 'EACCES') {
        throw new Error(`No write access to Obsidian vault path: ${this.vaultPath}`);
      }
      throw error;
    }
  }

  /**
   * Save metrics to Obsidian vault.
   * Processes health metrics and sleep data, writing to appropriate tracking files.
   */
  async saveMetrics(metricsByType: Record<string, Metric[]>): Promise<SaveResult> {
    const results: SaveResult[] = [];

    // Process health metrics
    const healthResult = await this.saveHealthMetrics(metricsByType);
    results.push(healthResult);

    // Process sleep metrics separately
    const sleepResult = await this.saveSleepMetrics(metricsByType);
    results.push(sleepResult);

    // Aggregate results
    const totalSaved = results.reduce((sum, r) => sum + r.saved, 0);
    const totalUpdated = results.reduce((sum, r) => sum + r.updated, 0);
    const allErrors = results.flatMap((r) => r.errors ?? []);

    logger.debug('Obsidian metrics saved', {
      saved: totalSaved,
      updated: totalUpdated,
    });

    return {
      errors: allErrors.length > 0 ? allErrors : undefined,
      saved: totalSaved,
      success: allErrors.length === 0,
      updated: totalUpdated,
    };
  }

  /**
   * Save workouts to Obsidian vault.
   */
  async saveWorkouts(workouts: WorkoutData[]): Promise<SaveResult> {
    if (workouts.length === 0) {
      return { saved: 0, success: true, updated: 0 };
    }

    logger.debug('Saving workouts to Obsidian', { count: workouts.length });

    const byDate = groupWorkoutsByDate(workouts);
    let totalSaved = 0;
    let totalUpdated = 0;
    const errors: string[] = [];

    for (const [dateKey, dateWorkouts] of byDate) {
      try {
        const result = await this.saveWorkoutsForDate(dateKey, dateWorkouts);
        if (result.isNew) {
          totalSaved++;
        } else {
          totalUpdated++;
        }
      } catch (error) {
        logger.error('Failed to save Obsidian workout file', error, { dateKey });
        errors.push(`${dateKey}: ${(error as Error).message}`);
      }
    }

    logger.debug('Obsidian workouts saved', {
      filesWritten: byDate.size,
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

  private async saveHealthForDate(
    dateKey: string,
    metricsByType: Record<string, Metric[]>,
  ): Promise<{ isNew: boolean }> {
    const filePath = getTrackingFilePath(this.vaultPath, 'health', dateKey);

    // Debug: Log health file write attempt
    if (isDebugEnabled()) {
      debugStorage(logger, 'Writing health file', {
        data: Object.entries(metricsByType).map(([name, metrics]) => ({
          count: metrics.length,
          name,
        })),
        filePath,
        fileType: 'health',
      });
    }

    return withLock(filePath, async () => {
      const existing = await readMarkdownFile(filePath);
      const isNew = !existing?.frontmatter;

      const frontmatter = createHealthFrontmatter(
        dateKey,
        metricsByType,
        existing?.frontmatter as HealthFrontmatter | undefined,
      );
      const body = existing?.body ?? getDefaultBody('health', dateKey);

      // Debug: Log frontmatter being written
      if (isDebugEnabled()) {
        debugLog(logger, 'STORAGE', `Health frontmatter for ${dateKey}`, {
          frontmatterKeys: Object.keys(frontmatter),
          isNew,
        });
      }

      await writeMarkdownFile(filePath, frontmatter, body);

      return { isNew };
    });
  }

  private async saveHealthMetrics(metricsByType: Record<string, Metric[]>): Promise<SaveResult> {
    const byDate = groupHealthMetricsByDate(metricsByType);

    if (byDate.size === 0) {
      return { saved: 0, success: true, updated: 0 };
    }

    logger.debug('Saving health metrics to Obsidian', { dates: byDate.size });

    let totalSaved = 0;
    let totalUpdated = 0;
    const errors: string[] = [];

    for (const [dateKey, dateMetrics] of byDate) {
      try {
        const result = await this.saveHealthForDate(dateKey, dateMetrics);
        if (result.isNew) {
          totalSaved++;
        } else {
          totalUpdated++;
        }
      } catch (error) {
        logger.error('Failed to save Obsidian health file', error, { dateKey });
        errors.push(`${dateKey}: ${(error as Error).message}`);
      }
    }

    return {
      errors: errors.length > 0 ? errors : undefined,
      saved: totalSaved,
      success: errors.length === 0,
      updated: totalUpdated,
    };
  }

  private async saveSleepForDate(
    dateKey: string,
    sleepEntries: Metric[],
    wristTemporary?: number,
  ): Promise<{ isNew: boolean }> {
    const filePath = getTrackingFilePath(this.vaultPath, 'sleep', dateKey);

    // Debug: Log sleep file write attempt
    if (isDebugEnabled()) {
      debugStorage(logger, 'Writing sleep file', {
        data: {
          entriesCount: sleepEntries.length,
          hasWristTemp: wristTemporary !== undefined,
          wristTemporary,
        },
        filePath,
        fileType: 'sleep',
      });
    }

    return withLock(filePath, async () => {
      const existing = await readMarkdownFile(filePath);
      const isNew = !existing?.frontmatter;

      // Cast to SleepMetric[] - we know these are sleep metrics
      const frontmatter = createSleepFrontmatter(
        dateKey,
        sleepEntries as SleepMetric[],
        existing?.frontmatter as SleepFrontmatter | undefined,
        wristTemporary,
      );
      const body = existing?.body ?? getDefaultBody('sleep', dateKey);

      // Debug: Log sleep frontmatter being written
      if (isDebugEnabled()) {
        debugLog(logger, 'STORAGE', `Sleep frontmatter for ${dateKey}`, {
          frontmatter,
          isNew,
        });
      }

      await writeMarkdownFile(filePath, frontmatter, body);

      return { isNew };
    });
  }

  private async saveSleepMetrics(metricsByType: Record<string, Metric[]>): Promise<SaveResult> {
    // Filter for sleep metrics only
    const hasSleepData = Object.keys(metricsByType).some((key) => isSleepMetric(key));
    if (!hasSleepData) {
      return { saved: 0, success: true, updated: 0 };
    }

    const byDate = groupSleepMetricsByDate(metricsByType);

    if (byDate.size === 0) {
      return { saved: 0, success: true, updated: 0 };
    }

    logger.debug('Saving sleep metrics to Obsidian', { dates: byDate.size });

    // Extract wrist temperature by date
    const wristTemporaryByDate = this.getWristTempByDate(metricsByType);

    let totalSaved = 0;
    let totalUpdated = 0;
    const errors: string[] = [];

    for (const [dateKey, sleepEntries] of byDate) {
      try {
        const wristTemporary = wristTemporaryByDate.get(dateKey);
        const result = await this.saveSleepForDate(dateKey, sleepEntries, wristTemporary);
        if (result.isNew) {
          totalSaved++;
        } else {
          totalUpdated++;
        }
      } catch (error) {
        logger.error('Failed to save Obsidian sleep file', error, { dateKey });
        errors.push(`${dateKey}: ${(error as Error).message}`);
      }
    }

    return {
      errors: errors.length > 0 ? errors : undefined,
      saved: totalSaved,
      success: errors.length === 0,
      updated: totalUpdated,
    };
  }

  /**
   * Extract wrist temperature readings and group by sleep date.
   * Uses the same night boundary logic as sleep date assignment.
   */
  private getWristTempByDate(metricsByType: Record<string, Metric[]>): Map<string, number> {
    const wristTemporaryByDate = new Map<string, number>();

    const wristTemporaryMetrics = metricsByType[MetricName.APPLE_SLEEPING_WRIST_TEMPERATURE] as
      | BaseMetric[]
      | undefined;
    if (!wristTemporaryMetrics || wristTemporaryMetrics.length === 0) {
      return wristTemporaryByDate;
    }

    for (const metric of wristTemporaryMetrics) {
      const date = new Date(metric.date);
      const hour = date.getHours();

      // Use night boundary logic (before 6 AM = previous day's sleep)
      if (hour < NIGHT_BOUNDARY_HOUR) {
        date.setDate(date.getDate() - 1);
      }

      const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
      const existing = wristTemporaryByDate.get(dateKey);

      if (existing === undefined) {
        wristTemporaryByDate.set(dateKey, Math.round(metric.qty * 100) / 100);
      } else {
        // Average multiple readings for the same date
        wristTemporaryByDate.set(dateKey, Math.round(((existing + metric.qty) / 2) * 100) / 100);
      }
    }

    return wristTemporaryByDate;
  }

  private async saveWorkoutsForDate(
    dateKey: string,
    workouts: WorkoutData[],
  ): Promise<{ isNew: boolean }> {
    const filePath = getTrackingFilePath(this.vaultPath, 'workout', dateKey);

    // Debug: Log workout file write attempt
    if (isDebugEnabled()) {
      debugStorage(logger, 'Writing workout file', {
        data: workouts.map((w) => ({
          duration: w.duration,
          name: w.name,
          start: w.start,
        })),
        filePath,
        fileType: 'workout',
      });
    }

    return withLock(filePath, async () => {
      const existing = await readMarkdownFile(filePath);
      const isNew = !existing?.frontmatter;

      const frontmatter = createWorkoutFrontmatter(
        dateKey,
        workouts,
        existing?.frontmatter as WorkoutFrontmatter | undefined,
      );
      const body = existing?.body ?? getDefaultBody('workout', dateKey);

      // Debug: Log workout frontmatter being written
      if (isDebugEnabled()) {
        debugLog(logger, 'STORAGE', `Workout frontmatter for ${dateKey}`, {
          frontmatter,
          isNew,
          workoutCount: workouts.length,
        });
      }

      await writeMarkdownFile(filePath, frontmatter, body);

      return { isNew };
    });
  }
}
