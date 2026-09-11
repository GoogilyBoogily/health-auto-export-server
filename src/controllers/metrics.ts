import {
  createMappingContext,
  flushValidationStats,
  logValidationWarning,
  mapMetric,
} from '../mappers';
import { MetricDataSchema } from '../validation/schemas';

import type { IngestData, Metric, MetricData } from '../types';
import type { Logger } from '../utils/logger';

/**
 * Result of preparing metrics for storage.
 */
export interface MetricsPrepResult {
  newCount: number;
  newMetrics: Record<string, Metric[]>;
  skippedRecords: number;
}

/**
 * Validate metric blocks one at a time.
 * A malformed block is dropped and counted rather than failing the whole request, so one bad
 * entry cannot discard a sync carrying dozens of good ones.
 */
function validateMetricBlocks(
  rawMetrics: unknown[],
  log?: Logger,
): { skipped: number; valid: MetricData[] } {
  const valid: MetricData[] = [];
  let skipped = 0;

  for (const candidate of rawMetrics) {
    const parsed = MetricDataSchema.safeParse(candidate);
    if (parsed.success) {
      valid.push(parsed.data);
      continue;
    }

    skipped++;
    log?.warn('Skipping malformed metric block', {
      issues: parsed.error.issues.slice(0, 3),
      name: (candidate as null | { name?: unknown })?.name,
    });
  }

  return { skipped, valid };
}

/**
 * Prepare metrics: map and validate.
 * Returns prepared data without writing to any storage.
 * Deduplication is handled by the Obsidian formatters during merge.
 */
export const prepareMetrics = (
  ingestData: IngestData,
  log?: Logger,
): MetricsPrepResult | undefined => {
  const timer = log?.startTimer('prepareMetrics');

  const rawMetrics = ingestData.data.metrics;

  if (!rawMetrics || rawMetrics.length === 0) {
    log?.debug('No metrics data provided');
    timer?.end('info', 'No metrics to prepare');
    return undefined;
  }

  const { skipped: skippedBlocks, valid: metricsData } = validateMetricBlocks(rawMetrics, log);

  log?.debug('Processing metrics', { rawMetricsCount: metricsData.length, skippedBlocks });

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

  const newCount = Object.values(metricsByType).reduce((sum, m) => sum + m.length, 0);
  const skippedRecords = validationStats.skippedRecords + skippedBlocks;
  timer?.end('info', 'Metrics prepared', { newCount, skippedRecords });

  return {
    newCount,
    newMetrics: metricsByType,
    skippedRecords,
  };
};
