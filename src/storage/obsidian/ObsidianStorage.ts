/**
 * ObsidianStorage - Writes health data to Obsidian vault as Markdown with YAML frontmatter.
 * All data types (health, sleep, workouts) merge into a single daily file.
 */

import { promises as fs } from 'node:fs';

import { logger } from '../../utils/logger';
import { withLock } from '../fileHelpers';
import { createHealthFrontmatter, groupHealthMetricsByDate } from './formatters/health';
import { createSleepFrontmatter, groupSleepMetricsByDate } from './formatters/sleep';
import { createWorkoutFrontmatter, groupWorkoutsByDate } from './formatters/workout';
import {
  getDailyFilePath,
  getDefaultBody,
  readMarkdownFile,
  writeMarkdownFile,
} from './utils/markdownUtilities';

import type { DailyFrontmatter, MetricsByType, SaveResult, WorkoutData } from '../../types';
import type { SleepDateData } from './formatters/sleep';

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
   * Save all data types to unified daily files.
   * Groups data by date and writes each date's data in a single atomic operation.
   * Preserves non-health frontmatter (moods, habits, weather, etc.) from other apps.
   */
  async saveDailyData(parameters: {
    metrics?: MetricsByType;
    workouts?: WorkoutData[];
  }): Promise<SaveResult> {
    const { metrics, workouts } = parameters;

    // Group each data type by date
    // groupHealthMetricsByDate filters OUT sleep; groupSleepMetricsByDate filters FOR sleep
    const healthByDate = metrics
      ? groupHealthMetricsByDate(metrics)
      : new Map<string, MetricsByType>();
    const sleepByDate = metrics
      ? groupSleepMetricsByDate(metrics)
      : new Map<string, SleepDateData>();
    const workoutsByDate = workouts
      ? groupWorkoutsByDate(workouts)
      : new Map<string, WorkoutData[]>();

    // Collect all unique date keys
    const allDates = new Set<string>([
      ...healthByDate.keys(),
      ...sleepByDate.keys(),
      ...workoutsByDate.keys(),
    ]);

    if (allDates.size === 0) {
      return { saved: 0, success: true, updated: 0 };
    }

    logger.debug('Saving daily data to Obsidian', {
      dates: [...allDates],
      healthDates: healthByDate.size,
      sleepDates: sleepByDate.size,
      workoutDates: workoutsByDate.size,
    });

    let totalSaved = 0;
    let totalUpdated = 0;
    const errors: string[] = [];

    for (const dateKey of allDates) {
      try {
        const result = await this.saveDailyForDate(
          dateKey,
          healthByDate.get(dateKey),
          sleepByDate.get(dateKey),
          workoutsByDate.get(dateKey),
        );
        if (result.isNew) {
          totalSaved++;
        } else {
          totalUpdated++;
        }
      } catch (error) {
        logger.error('Failed to save daily file', error, { dateKey });
        errors.push(`${dateKey}: ${(error as Error).message}`);
      }
    }

    logger.debug('Obsidian daily data saved', {
      filesWritten: allDates.size,
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
   * Save all data for a single date into one daily file.
   * Reads existing file first to preserve non-health data.
   */
  private async saveDailyForDate(
    dateKey: string,
    healthData?: MetricsByType,
    sleepData?: SleepDateData,
    workoutData?: WorkoutData[],
  ): Promise<{ isNew: boolean }> {
    const filePath = getDailyFilePath(this.vaultPath, dateKey);

    logger.debugStorage('Writing daily file', {
      data: {
        hasHealth: healthData !== undefined,
        hasSleep: sleepData !== undefined,
        hasWorkouts: workoutData !== undefined,
      },
      filePath,
      fileType: 'daily',
    });

    return withLock(filePath, async () => {
      const existing = await readMarkdownFile(filePath);
      const isNew = !existing?.frontmatter;

      // Start with existing frontmatter to preserve non-health data (moods, weather, etc.)
      let frontmatter: DailyFrontmatter = existing?.frontmatter ?? { date: dateKey };
      frontmatter.date = dateKey;

      // Merge health metrics
      if (healthData) {
        frontmatter = createHealthFrontmatter(dateKey, healthData, frontmatter);
      }

      // Merge sleep stages
      if (sleepData) {
        frontmatter = createSleepFrontmatter(dateKey, sleepData, frontmatter);
      }

      // Merge workout entries
      if (workoutData) {
        frontmatter = createWorkoutFrontmatter(dateKey, workoutData, frontmatter);
      }

      // Preserve existing body or generate default
      const body = existing?.body ?? getDefaultBody(dateKey);

      logger.debugLog('STORAGE', `Daily frontmatter for ${dateKey}`, {
        frontmatterKeys: Object.keys(frontmatter),
        isNew,
      });

      await writeMarkdownFile(filePath, frontmatter, body);

      return { isNew };
    });
  }
}
