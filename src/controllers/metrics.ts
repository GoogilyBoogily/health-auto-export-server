import { RetryConfig } from '../config';
import {
  createMappingContext,
  flushValidationStats,
  logValidationWarning,
  mapMetric,
} from '../mappers';
import { getObsidianStorage } from '../storage';
import { extractDatesFromMetrics, filterDuplicateMetrics } from '../utils/deduplication';
import { Logger } from '../utils/logger';
import { withRetry } from '../utils/retry';

import type { IngestData, IngestResponse, Metric } from '../types';

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
    log?.debugLog('TRANSFORM', 'Raw metrics input', {
      metricTypes: metricsData.map((m) => ({ dataCount: m.data.length, name: m.name })),
      totalMetrics: metricsData.length,
    });

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
    const transformSummary = Object.entries(metricsByType).map(([name, metrics]) => ({
      count: metrics.length,
      name,
      sampleDate: metrics[0]?.date,
    }));
    log?.debugLog('TRANSFORM', 'Metrics transformed and grouped', { byType: transformSummary });

    // === DEDUPLICATION FLOW ===

    // 1. Extract dates from incoming metrics
    const incomingDates = extractDatesFromMetrics(metricsByType);
    log?.debug('Incoming metric dates', { dates: incomingDates });

    // 2. Read existing Obsidian frontmatter for those dates
    const obsidianStorage = getObsidianStorage();
    const existingFrontmatter = await obsidianStorage.readHealthFrontmatter(incomingDates);
    log?.debug('Existing frontmatter loaded', { datesWithData: existingFrontmatter.size });

    // 3. Filter duplicates by comparing timestamps
    const { duplicateCount, newCount, newMetrics } = filterDuplicateMetrics(
      metricsByType,
      existingFrontmatter,
    );
    log?.debug('Deduplication complete', { duplicateCount, newCount });

    // Debug: Log detailed deduplication results
    const newMetricsSummary = Object.entries(newMetrics).map(([name, metrics]) => ({
      count: metrics.length,
      name,
    }));
    log?.debugDedup('Metrics deduplication', {
      duplicateCount,
      inputCount: Object.values(metricsByType).reduce((sum, m) => sum + m.length, 0),
      newCount,
    });
    log?.debugLog('DEDUP', 'New metrics after deduplication', { byType: newMetricsSummary });

    // 4. If all data is duplicates, return early
    if (newCount === 0) {
      response.metrics = {
        message: `All ${String(duplicateCount)} metrics were duplicates, nothing new to save`,
        success: true,
      };
      timer?.end('info', 'All metrics were duplicates');
      return response;
    }

    // 5. Write to Obsidian with retry logic
    // Debug: Log what we're about to write to Obsidian
    log?.debugStorage('Preparing Obsidian write', {
      data: Object.entries(newMetrics).map(([name, metrics]) => ({
        count: metrics.length,
        name,
      })),
      fileType: 'metrics',
    });

    try {
      const obsidianResult = await withRetry(() => obsidianStorage.saveMetrics(newMetrics), {
        baseDelayMs: RetryConfig.baseDelayMs,
        log,
        maxRetries: RetryConfig.maxRetries,
        operationName: 'Obsidian write',
      });

      // Debug: Log Obsidian write result
      log?.debugStorage('Obsidian write completed', {
        metadata: { saved: obsidianResult.saved, updated: obsidianResult.updated },
      });
    } catch (error) {
      const obsidianError = error instanceof Error ? error.message : 'Unknown Obsidian error';
      log?.error('Obsidian storage failed after all retries', {
        error: obsidianError,
        retries: RetryConfig.maxRetries,
      });

      timer?.end('error', 'Failed to save metrics to Obsidian', {
        duplicatesSkipped: duplicateCount,
        error: obsidianError,
        newMetricsAttempted: newCount,
      });

      return {
        metrics: {
          error: `Obsidian storage failed after ${String(RetryConfig.maxRetries)} attempts: ${obsidianError}`,
          success: false,
        },
      };
    }

    const metricTypesCount = Object.keys(newMetrics).length;

    response.metrics = {
      message: `${String(newCount)} new metrics saved, ${String(duplicateCount)} duplicates skipped across ${String(metricTypesCount)} metric types`,
      success: true,
    };

    timer?.end('info', 'Metrics saved', {
      duplicatesSkipped: duplicateCount,
      metricTypes: metricTypesCount,
      newMetricsSaved: newCount,
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
