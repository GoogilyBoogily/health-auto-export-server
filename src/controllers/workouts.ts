import { RetryConfig } from '../config';
import { prepareWorkouts } from '../mappers';
import { cacheStorage, getObsidianStorage } from '../storage';
import { extractDatesFromWorkouts, filterDuplicateWorkouts } from '../utils/deduplication';
import { Logger } from '../utils/logger';
import { withRetry } from '../utils/retry';

import type { IngestData, IngestResponse } from '../types';

// === CLEANUP DEBOUNCING ===
// Prevents overlapping cleanup runs from concurrent requests
let cleanupScheduled = false;

/**
 * Schedule cache cleanup with debouncing to prevent overlapping runs.
 */
function scheduleCleanup(log?: Logger): void {
  if (cleanupScheduled) {
    return;
  }

  cleanupScheduled = true;
  const timeout = setTimeout(() => {
    cleanupScheduled = false;
    cacheStorage
      .cleanupExpiredCache()
      .then((result) => {
        if (result.deletedFiles > 0) {
          log?.info('Cache cleanup completed', result);
        }
        return result;
      })
      .catch((error: unknown) => {
        log?.error('Cache cleanup failed', {
          error: error instanceof Error ? error.message : 'Unknown',
        });
      });
  }, RetryConfig.cleanupDebounceMs);

  // Don't block process exit
  timeout.unref();
}

export const saveWorkouts = async (
  ingestData: IngestData,
  log?: Logger,
): Promise<IngestResponse> => {
  const timer = log?.startTimer('saveWorkouts');

  try {
    const response: IngestResponse = {};
    const rawWorkouts = ingestData.data.workouts;

    if (!rawWorkouts || rawWorkouts.length === 0) {
      log?.debug('No workout data provided');
      response.workouts = {
        message: 'No workout data provided',
        success: true,
      };
      timer?.end('info', 'No workouts to save');
      return response;
    }

    // Extract sourceDate from raw date strings before any Date conversion
    const workouts = prepareWorkouts(rawWorkouts);

    log?.debug('Processing workouts', { count: workouts.length });

    // Debug: Log raw workouts input
    log?.debugLog('TRANSFORM', 'Raw workouts input', {
      workoutsCount: workouts.length,
      workoutSummary: workouts.map((w) => ({
        date: w.start,
        duration: w.duration,
        name: w.name,
        workoutId: (w as { id?: string }).id,
      })),
    });

    // === DEDUPLICATION FLOW ===

    // 1. Extract dates from incoming workouts
    const incomingDates = extractDatesFromWorkouts(workouts);
    log?.debug('Incoming workout dates', { dates: incomingDates });

    // 2. Read cache for those dates
    const cachedData = await cacheStorage.getWorkoutsForDates(incomingDates);
    log?.debug('Cache data loaded', { cachedDates: cachedData.size });

    // 3. Filter duplicates by workoutId
    const { duplicateCount, newCount, newWorkouts } = filterDuplicateWorkouts(workouts, cachedData);
    log?.debug('Deduplication complete', { duplicateCount, newCount });

    // Debug: Log detailed deduplication results
    log?.debugDedup('Workouts deduplication', {
      duplicateCount,
      inputCount: workouts.length,
      newCount,
    });
    if (newWorkouts.length > 0) {
      log?.debugLog('DEDUP', 'New workouts after deduplication', {
        workouts: newWorkouts.map((w) => ({
          date: w.start,
          name: w.name,
        })),
      });
    }

    // 4. If all data is duplicates, return early
    if (newCount === 0) {
      response.workouts = {
        message: `All ${String(duplicateCount)} workouts were duplicates, nothing new to save`,
        success: true,
      };
      timer?.end('info', 'All workouts were duplicates');
      return response;
    }

    // 5. Write to Obsidian FIRST (authoritative store) with retry logic
    const obsidianStorage = getObsidianStorage();
    let obsidianSaved: number;

    // Debug: Log what we're about to write to Obsidian
    log?.debugStorage('Preparing Obsidian write', {
      data: newWorkouts.map((w) => ({
        date: w.start,
        duration: w.duration,
        name: w.name,
      })),
      fileType: 'workouts',
    });

    try {
      const obsidianResult = await withRetry(() => obsidianStorage.saveWorkouts(newWorkouts), {
        baseDelayMs: RetryConfig.baseDelayMs,
        log,
        maxRetries: RetryConfig.maxRetries,
        operationName: 'Obsidian write',
      });
      obsidianSaved = obsidianResult.saved;

      // Debug: Log Obsidian write result
      log?.debugStorage('Obsidian write completed', {
        metadata: { saved: obsidianSaved, updated: obsidianResult.updated },
      });
    } catch (error) {
      // Obsidian failed after all retries - do NOT update cache, return error
      const obsidianError = error instanceof Error ? error.message : 'Unknown Obsidian error';
      log?.error('Obsidian storage failed after all retries, cache not updated', {
        error: obsidianError,
        retries: RetryConfig.maxRetries,
      });

      timer?.end('error', 'Failed to save workouts to Obsidian', {
        duplicatesSkipped: duplicateCount,
        error: obsidianError,
        newWorkoutsAttempted: newCount,
      });

      return {
        workouts: {
          error: `Obsidian storage failed after ${String(RetryConfig.maxRetries)} attempts: ${obsidianError}`,
          success: false,
        },
      };
    }

    // 6. Only on Obsidian success: Save NEW workouts to cache (pre-deduplicated)
    const cacheResult = await cacheStorage.saveWorkouts(newWorkouts);

    // 7. Trigger cache cleanup (debounced)
    scheduleCleanup(log);

    response.workouts = {
      message: `${String(cacheResult.saved)} new workouts saved, ${String(duplicateCount)} duplicates skipped`,
      success: true,
    };

    timer?.end('info', 'Workouts saved', {
      duplicatesSkipped: duplicateCount,
      newWorkoutsSaved: cacheResult.saved,
      obsidianSaved,
    });

    return response;
  } catch (error) {
    timer?.end('error', 'Failed to save workouts', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    const errorResponse: IngestResponse = {
      workouts: {
        error: error instanceof Error ? error.message : 'An error occurred',
        message: 'Workouts not saved',
        success: false,
      },
    };

    return errorResponse;
  }
};
