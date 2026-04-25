import {
  createMappingContext,
  flushValidationStats,
  logValidationWarning,
  mapMetric,
} from '../mappers';

import type { IngestData, Metric } from '../types';
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
 * Prepare metrics: map and validate.
 * Returns prepared data without writing to any storage.
 * Deduplication is handled by the Obsidian formatters during merge.
 */
export const prepareMetrics = (
  ingestData: IngestData,
  log?: Logger,
): MetricsPrepResult | undefined => {
  const timer = log?.startTimer('prepareMetrics');

  const metricsData = ingestData.data.metrics;

  if (!metricsData || metricsData.length === 0) {
    log?.debug('No metrics data provided');
    timer?.end('info', 'No metrics to prepare');
    return undefined;
  }

  log?.debug('Processing metrics', { rawMetricsCount: metricsData.length });

  // Debug: Log raw metrics data structure
  log?.debugLog('TRANSFORM', 'Raw metrics input', {
    metricTypes: metricsData.map((m) => ({ dataCount: m.data.length, name: m.name })),
    totalMetrics: metricsData.length,
  });

  // Create request-scoped context for validation tracking
  const mappingContext = createMappingContext(log);

  // Group metrics by type and map the data.
  // Lowercase the name so casing drift between payloads (e.g. "heart_rate" vs
  // "Heart_Rate") collapses into a single bucket and produces a stable
  // frontmatter key after snakeToCamelCase conversion.
  const metricsByType: Record<string, Metric[]> = {};
  for (const metric of metricsData) {
    const mappedMetrics = mapMetric(metric, mappingContext);
    const key = metric.name.toLowerCase();
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
  timer?.end('info', 'Metrics prepared', {
    newCount,
    skippedRecords: validationStats.skippedRecords,
  });

  return {
    newCount,
    newMetrics: metricsByType,
    skippedRecords: validationStats.skippedRecords,
  };
};
