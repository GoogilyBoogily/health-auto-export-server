/**
 * ObsidianStorage - Writes health data to Obsidian vault as Markdown with YAML frontmatter.
 * All data types (health, sleep, workouts) merge into a single daily file.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { ObsidianConfig } from '../../config';
import { logger } from '../../utils/logger';
import { withLock } from '../fileHelpers';
import { createHealthFrontmatter, groupHealthMetricsByDate } from './formatters/health';
import { createSleepFrontmatter, groupSleepMetricsByDate } from './formatters/sleep';
import { createWorkoutFrontmatter, groupWorkoutsByDate } from './formatters/workout';
import {
  getDailyFilePath,
  getDefaultBody,
  listMarkdownFiles,
  readMarkdownFile,
  writeMarkdownFile,
} from './utils/markdownUtilities';

import type { DailyFrontmatter, MetricsByType, SaveResult, WorkoutData } from '../../types';
import type { SleepDateData } from './formatters/sleep';

export class ObsidianStorage {
  private vaultPath: string;
  private workoutIndex: Map<string, string> | undefined;
  private workoutIndexBuild: Promise<Map<string, string>> | undefined;

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

    // Reroute workouts whose appleWorkoutId already lives at a different date —
    // prevents cross-file duplicates when the workout's local-date shifts between
    // payloads (e.g. phone TZ change).
    const reroutedWorkouts = workouts
      ? await this.rerouteWorkoutsToExistingDate(workouts)
      : undefined;

    // Group each data type by date
    // groupHealthMetricsByDate filters OUT sleep; groupSleepMetricsByDate filters FOR sleep
    const healthByDate = metrics
      ? groupHealthMetricsByDate(metrics)
      : new Map<string, MetricsByType>();
    const sleepByDate = metrics
      ? groupSleepMetricsByDate(metrics)
      : new Map<string, SleepDateData>();
    const workoutsByDate = reroutedWorkouts
      ? groupWorkoutsByDate(reroutedWorkouts)
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

    const { errors, totalSaved, totalUpdated } = await this.processDateSaves(
      allDates,
      healthByDate,
      sleepByDate,
      workoutsByDate,
    );

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
   * Scan the vault's daily folder once to build a map of
   * `appleWorkoutId → dateKey`. Used to detect cross-file duplicates.
   */
  private async buildWorkoutIndex(): Promise<Map<string, string>> {
    const index = new Map<string, string>();
    const dailyRoot = path.join(this.vaultPath, ObsidianConfig.dailyPath);
    const files = await listMarkdownFiles(dailyRoot);

    for (const file of files) {
      try {
        const parsed = await readMarkdownFile(file);
        const rawEntries = parsed?.frontmatter?.workoutEntries as unknown;
        const dateKey = parsed?.frontmatter?.date;
        if (!Array.isArray(rawEntries) || typeof dateKey !== 'string') continue;
        for (const entry of rawEntries as unknown[]) {
          const id = extractWorkoutId(entry);
          if (id) index.set(id, dateKey);
        }
      } catch (error) {
        logger.warn('Skipping unreadable daily file during workout index build', {
          error: error instanceof Error ? error.message : 'Unknown error',
          file,
        });
      }
    }

    logger.debug('Workout index built', { entryCount: index.size, fileCount: files.length });
    return index;
  }

  /**
   * Lazy memoized accessor for the workout id → date map.
   * Concurrent callers share a single in-flight build promise.
   */
  private async ensureWorkoutIndex(): Promise<Map<string, string>> {
    if (this.workoutIndex) return this.workoutIndex;
    this.workoutIndexBuild ??= this.buildWorkoutIndex();
    this.workoutIndex = await this.workoutIndexBuild;
    return this.workoutIndex;
  }

  /**
   * Iterate the per-date save calls, accumulate saved/updated counts and errors,
   * and refresh the workout index with successfully written workouts.
   */
  private async processDateSaves(
    allDates: Set<string>,
    healthByDate: Map<string, MetricsByType>,
    sleepByDate: Map<string, SleepDateData>,
    workoutsByDate: Map<string, WorkoutData[]>,
  ): Promise<{ errors: string[]; totalSaved: number; totalUpdated: number }> {
    let totalSaved = 0;
    let totalUpdated = 0;
    const errors: string[] = [];

    for (const dateKey of allDates) {
      const dateWorkouts = workoutsByDate.get(dateKey);
      try {
        const result = await this.saveDailyForDate(
          dateKey,
          healthByDate.get(dateKey),
          sleepByDate.get(dateKey),
          dateWorkouts,
        );
        if (result.isNew) totalSaved++;
        else totalUpdated++;
        this.recordWorkoutsInIndex(dateKey, dateWorkouts);
      } catch (error) {
        logger.error('Failed to save daily file', error, { dateKey });
        errors.push(`${dateKey}: ${(error as Error).message}`);
      }
    }

    return { errors, totalSaved, totalUpdated };
  }

  /**
   * Update the workout index with ids written for a given date, when the index
   * has already been built. New ids without a prior bootstrap are added on
   * the next index access.
   */
  private recordWorkoutsInIndex(dateKey: string, workouts: WorkoutData[] | undefined): void {
    if (!workouts || !this.workoutIndex) return;
    for (const w of workouts) this.workoutIndex.set(w.id, dateKey);
  }

  /**
   * Replace each workout's `sourceDate` with the date its `appleWorkoutId` was
   * previously written to (if any). Workouts that have never been seen keep
   * their incoming sourceDate.
   */
  private async rerouteWorkoutsToExistingDate(workouts: WorkoutData[]): Promise<WorkoutData[]> {
    if (workouts.length === 0) return workouts;
    const index = await this.ensureWorkoutIndex();
    return workouts.map((workout) => {
      const existingDate = index.get(workout.id);
      if (existingDate && existingDate !== workout.sourceDate) {
        logger.info('Rerouting workout to existing daily file', {
          appleWorkoutId: workout.id,
          fromDate: workout.sourceDate,
          toDate: existingDate,
        });
        return { ...workout, sourceDate: existingDate };
      }
      return workout;
    });
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

/**
 * Extract `appleWorkoutId` from a YAML-parsed entry of unknown shape.
 * Returns undefined when the entry is malformed or missing the id field.
 */
function extractWorkoutId(entry: unknown): string | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined;
  const id = (entry as { appleWorkoutId?: unknown }).appleWorkoutId;
  return typeof id === 'string' ? id : undefined;
}
