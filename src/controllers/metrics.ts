import {
  createMappingContext,
  flushValidationStats,
  logValidationWarning,
  mapMetric,
} from '../mappers';
import { cacheStorage, getObsidianStorage } from '../storage';
import { debugDedup, debugLog, debugStorage, isDebugEnabled } from '../utils/debugLogger';
import { extractDatesFromMetrics, filterDuplicateMetrics } from '../utils/deduplication';
import { Logger } from '../utils/logger';
import { withRetry } from '../utils/retry';

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

/* eslint-disable sonarjs/cognitive-complexity -- Debug logging conditionals add necessary complexity */
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

    // Debug: Log raw metrics data structure
    if (log && isDebugEnabled()) {
      debugLog(log, 'TRANSFORM', 'Raw metrics input', {
        metricTypes: metricsData.map((m) => ({ dataCount: m.data.length, name: m.name })),
        totalMetrics: metricsData.length,
      });
    }

    // Create request-scoped context for validation tracking
    const mappingContext = createMappingContext(log);

    // Group metrics by type and map the data
    const metricsByType: Record<string, Metric[]> = {};
    for (const metric of metricsData) {
      const mappedMetrics = mapMetric(metric, mappingContext);
      const key = metric.name;
      metricsByType[key] ??= [];
      metricsByType[key].push(...mappedMetrics);
    }

    // Flush validation stats and log warnings for data quality issues
    const validationStats = flushValidationStats(mappingContext);
    logValidationWarning(mappingContext);

    log?.debug('Validation complete', {
      processed: validationStats.processedRecords,
      skipped: validationStats.skippedRecords,
    });

    // Debug: Log transformed metrics structure
    if (log && isDebugEnabled()) {
      const transformSummary = Object.entries(metricsByType).map(([name, metrics]) => ({
        count: metrics.length,
        name,
        sampleDate: metrics[0]?.date,
      }));
      debugLog(log, 'TRANSFORM', 'Metrics transformed and grouped', { byType: transformSummary });
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

    // Debug: Log detailed deduplication results
    if (log && isDebugEnabled()) {
      const newMetricsSummary = Object.entries(newMetrics).map(([name, metrics]) => ({
        count: metrics.length,
        name,
      }));
      debugDedup(log, 'Metrics deduplication', {
        duplicateCount,
        inputCount: Object.values(metricsByType).reduce((sum, m) => sum + m.length, 0),
        newCount,
      });
      debugLog(log, 'DEDUP', 'New metrics after deduplication', { byType: newMetricsSummary });
    }

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

    // Debug: Log what we're about to write to Obsidian
    if (log && isDebugEnabled()) {
      debugStorage(log, 'Preparing Obsidian write', {
        data: Object.entries(newMetrics).map(([name, metrics]) => ({
          count: metrics.length,
          name,
        })),
        fileType: 'metrics',
      });
    }

    try {
      const obsidianResult = await withRetry(() => obsidianStorage.saveMetrics(newMetrics), {
        baseDelayMs: RETRY_BASE_DELAY_MS,
        log,
        maxRetries: MAX_OBSIDIAN_RETRIES,
        operationName: 'Obsidian write',
      });
      obsidianSaved = obsidianResult.saved;

      // Debug: Log Obsidian write result
      if (log && isDebugEnabled()) {
        debugStorage(log, 'Obsidian write completed', {
          metadata: { saved: obsidianSaved, updated: obsidianResult.updated },
        });
      }
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
/* eslint-enable sonarjs/cognitive-complexity */
