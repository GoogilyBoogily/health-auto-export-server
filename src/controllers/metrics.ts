import { mapMetric } from '../mappers';
import { cacheStorage, getObsidianStorage } from '../storage';
import { extractDatesFromMetrics, filterDuplicateMetrics } from '../utils/deduplication';
import { Logger } from '../utils/logger';

import type { IngestData, IngestResponse, Metric } from '../types';

// === RETRY CONFIGURATION ===
const MAX_OBSIDIAN_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

// === CLEANUP DEBOUNCING ===
// Prevents overlapping cleanup runs from concurrent requests
let cleanupScheduled = false;
const CLEANUP_DEBOUNCE_MS = 5000;

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
  }, CLEANUP_DEBOUNCE_MS);

  // Don't block process exit
  timeout.unref();
}

/**
 * Execute a function with exponential backoff retry logic.
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number,
  baseDelayMs: number,
  log?: Logger,
  operationName?: string,
): Promise<T> {
  let lastError: Error = new Error('Operation failed with no error details');

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error');

      if (attempt < maxRetries - 1) {
        const delay = baseDelayMs * Math.pow(2, attempt);
        log?.warn(`${operationName ?? 'Operation'} failed, retrying in ${String(delay)}ms`, {
          attempt: attempt + 1,
          error: lastError.message,
          maxRetries,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

export const saveMetrics = async (
  ingestData: IngestData,
  log?: Logger,
): Promise<IngestResponse> => {
  const timer = log?.startTimer('saveMetrics');

  try {
    const response: IngestResponse = {};
    const metricsData = ingestData.data.metrics;

    if (!metricsData || metricsData.length === 0) {
      log?.debug('No metrics data provided');
      response.metrics = {
        message: 'No metrics data provided',
        success: true,
      };
      timer?.end('info', 'No metrics to save');
      return response;
    }

    log?.debug('Processing metrics', { rawMetricsCount: metricsData.length });

    // Group metrics by type and map the data
    const metricsByType: Record<string, Metric[]> = {};
    for (const metric of metricsData) {
      const mappedMetrics = mapMetric(metric);
      const key = metric.name;
      metricsByType[key] ??= [];
      metricsByType[key].push(...mappedMetrics);
    }

    // === DEDUPLICATION FLOW ===

    // 1. Extract dates from incoming metrics
    const incomingDates = extractDatesFromMetrics(metricsByType);
    log?.debug('Incoming metric dates', { dates: incomingDates });

    // 2. Read cache for those dates
    const cachedData = await cacheStorage.getMetricsForDates(incomingDates);
    log?.debug('Cache data loaded', { cachedDates: cachedData.size });

    // 3. Filter duplicates via exact-match hash comparison
    const { duplicateCount, newCount, newMetrics } = filterDuplicateMetrics(
      metricsByType,
      cachedData,
    );
    log?.debug('Deduplication complete', { duplicateCount, newCount });

    // 4. If all data is duplicates, return early
    if (newCount === 0) {
      response.metrics = {
        message: `All ${String(duplicateCount)} metrics were duplicates, nothing new to save`,
        success: true,
      };
      timer?.end('info', 'All metrics were duplicates');
      return response;
    }

    // 5. Write to Obsidian FIRST (authoritative store) with retry logic
    const obsidianStorage = getObsidianStorage();
    let obsidianSaved: number;
    try {
      const obsidianResult = await withRetry(
        () => obsidianStorage.saveMetrics(newMetrics),
        MAX_OBSIDIAN_RETRIES,
        RETRY_BASE_DELAY_MS,
        log,
        'Obsidian write',
      );
      obsidianSaved = obsidianResult.saved;
    } catch (error) {
      // Obsidian failed after all retries - do NOT update cache, return error
      const obsidianError = error instanceof Error ? error.message : 'Unknown Obsidian error';
      log?.error('Obsidian storage failed after all retries, cache not updated', {
        error: obsidianError,
        retries: MAX_OBSIDIAN_RETRIES,
      });

      timer?.end('error', 'Failed to save metrics to Obsidian', {
        duplicatesSkipped: duplicateCount,
        error: obsidianError,
        newMetricsAttempted: newCount,
      });

      return {
        metrics: {
          error: `Obsidian storage failed after ${String(MAX_OBSIDIAN_RETRIES)} attempts: ${obsidianError}`,
          success: false,
        },
      };
    }

    // 6. Only on Obsidian success: Save NEW metrics to cache (pre-deduplicated)
    const cacheResult = await cacheStorage.saveMetricsDirectly(newMetrics);

    // 7. Trigger cache cleanup (debounced)
    scheduleCleanup(log);

    const metricTypesCount = Object.keys(newMetrics).length;

    response.metrics = {
      message: `${String(cacheResult.saved)} new metrics saved, ${String(duplicateCount)} duplicates skipped across ${String(metricTypesCount)} metric types`,
      success: true,
    };

    timer?.end('info', 'Metrics saved', {
      duplicatesSkipped: duplicateCount,
      metricTypes: metricTypesCount,
      newMetricsSaved: cacheResult.saved,
      obsidianSaved,
    });

    return response;
  } catch (error) {
    timer?.end('error', 'Failed to save metrics', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    const errorResponse: IngestResponse = {
      metrics: {
        error: error instanceof Error ? error.message : 'Error saving metrics',
        success: false,
      },
    };

    return errorResponse;
  }
};
