/**
 * Health metrics formatter.
 * Transforms raw metrics into Obsidian health tracking frontmatter.
 * Stores every metric type as unaggregated timestamped reading lists.
 */

import { logger } from '../../../utils/logger';
import { snakeToCamelCase } from '../../../utils/stringUtilities';
import { formatIsoTimestamp } from '../utils/dateUtilities';
import { isSleepMetric } from './sleep';

import type {
  BaseMetric,
  BloodPressureReading,
  HealthFrontmatter,
  HeartRateHealthReading,
  Metric,
  MetricCommon,
  MetricReading,
} from '../../../types';

type MetricsByType = Record<string, Metric[]>;

type Reading = BloodPressureReading | HeartRateHealthReading | MetricReading;

/**
 * Create health frontmatter from metrics for a specific date.
 * Each metric type becomes a key with an array of timestamped readings.
 */
export function createHealthFrontmatter(
  dateKey: string,
  metricsByType: MetricsByType,
  existing?: HealthFrontmatter,
): HealthFrontmatter {
  const frontmatter: HealthFrontmatter = existing ?? {
    date: dateKey,
    type: 'health',
  };

  frontmatter.date = dateKey;

  const metricTypes = Object.keys(metricsByType);
  const metricCounts = Object.fromEntries(
    Object.entries(metricsByType).map(([k, v]) => [k, v.length]),
  );
  logger.debugLog('TRANSFORM', 'Health frontmatter creation started', {
    dateKey,
    hasExisting: existing !== undefined,
    metricCounts,
    metricTypes,
  });

  for (const [metricType, metrics] of Object.entries(metricsByType)) {
    const key = snakeToCamelCase(metricType);
    const newReadings = metrics.map((m) => metricToReading(m));
    const existingReadings = Array.isArray(frontmatter[key]) ? frontmatter[key] : [];

    // Deduplicate by time — new readings overwrite existing at same timestamp (upsert)
    const readingMap = new Map<string, Reading>();
    for (const r of existingReadings) {
      readingMap.set(r.time, r);
    }
    for (const r of newReadings) {
      readingMap.set(r.time, r);
    }
    frontmatter[key] = [...readingMap.values()];
  }

  const fieldsSet = Object.keys(frontmatter);
  logger.debugLog('TRANSFORM', 'Health frontmatter completed', {
    dateKey,
    fieldsSet,
    metricTypeCount: metricTypes.length,
  });

  return frontmatter;
}

/**
 * Group metrics by date for health tracking.
 * All metric types except sleep go to health files.
 */
export function groupHealthMetricsByDate(metricsByType: MetricsByType): Map<string, MetricsByType> {
  const byDate = new Map<string, MetricsByType>();

  for (const [metricType, metrics] of Object.entries(metricsByType)) {
    if (isSleepMetric(metricType)) continue;

    for (const metric of metrics) {
      const dateKey = (metric as MetricCommon).sourceDate;
      let dateMetrics = byDate.get(dateKey);
      if (!dateMetrics) {
        dateMetrics = {};
        byDate.set(dateKey, dateMetrics);
      }
      dateMetrics[metricType] ??= [];
      dateMetrics[metricType].push(metric);
    }
  }

  const inputMetricTypes = Object.keys(metricsByType).filter((t) => !isSleepMetric(t));
  const totalInputMetrics = inputMetricTypes.reduce(
    (total, t) => total + metricsByType[t].length,
    0,
  );
  logger.debugLog('TRANSFORM', 'Health metrics grouped by date', {
    dateKeys: [...byDate.keys()],
    datesWithData: byDate.size,
    inputMetricTypes,
    totalInputMetrics,
  });

  return byDate;
}

/**
 * Convert a raw metric to a timestamped reading based on its shape.
 */
function metricToReading(metric: Metric): Reading {
  const time = formatIsoTimestamp((metric as BaseMetric).date) ?? '';

  // Heart rate metrics have Avg/Min/Max fields
  if ('Avg' in metric) {
    const reading: HeartRateHealthReading = {
      avg: metric.Avg,
      max: metric.Max,
      min: metric.Min,
      time,
    };
    if (metric.source) reading.source = metric.source;
    return reading;
  }

  // Blood pressure metrics have systolic/diastolic fields
  if ('systolic' in metric) {
    const reading: BloodPressureReading = {
      diastolic: metric.diastolic,
      systolic: metric.systolic,
      time,
    };
    if (metric.source) reading.source = metric.source;
    return reading;
  }

  // Default: BaseMetric with qty
  const base = metric as BaseMetric;
  const reading: MetricReading = {
    time,
    value: base.qty,
  };
  if (base.source) reading.source = base.source;
  return reading;
}
