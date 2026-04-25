/**
 * Health metrics formatter.
 * Transforms raw metrics into health tracking frontmatter.
 * Stores every metric type as unaggregated timestamped reading lists.
 */

import { logger } from '../../../utils/logger';
import { snakeToCamelCase } from '../../../utils/stringUtilities';
import { formatIsoTimestamp } from '../utils/dateUtilities';
import { isSleepMetric } from './sleep';

import type {
  BaseMetric,
  BloodPressureReading,
  DailyFrontmatter,
  HeartRateHealthReading,
  Metric,
  MetricCommon,
  MetricReading,
  MetricsByType,
} from '../../../types';

type Reading = BloodPressureReading | HeartRateHealthReading | MetricReading;

/**
 * Merge health metrics into existing frontmatter for a specific date.
 * Each metric type becomes a key with an array of timestamped readings.
 * Non-health keys in the frontmatter are preserved.
 */
export function createHealthFrontmatter(
  dateKey: string,
  metricsByType: MetricsByType,
  existing?: DailyFrontmatter,
): DailyFrontmatter {
  const frontmatter: DailyFrontmatter = existing ?? { date: dateKey };

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

    // Defensive: only keep entries that look like Reading objects (guards against user-edited frontmatter)
    const rawExisting = Array.isArray(frontmatter[key]) ? (frontmatter[key] as unknown[]) : [];
    const existingReadings = rawExisting.filter(
      (r): r is Reading =>
        typeof r === 'object' && r !== null && typeof (r as Reading).time === 'string',
    );

    // Composite key (time|source) so same-instant readings from different sources don't collide
    const readingMap = new Map<string, Reading>();
    for (const r of existingReadings) {
      readingMap.set(dedupKey(r), r);
    }
    for (const r of newReadings) {
      readingMap.set(dedupKey(r), r);
    }
    frontmatter[key] = [...readingMap.values()].toSorted((a, b) => a.time.localeCompare(b.time));
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
 * Composite dedup key: same-instant readings from different sources must coexist.
 * Empty source slot still distinguishes "no source" from any named source.
 *
 * Time is normalized via formatIsoTimestamp so legacy on-disk entries with
 * fractional seconds collapse onto the same key as new ms-stripped readings.
 */
function dedupKey(r: Reading): string {
  const normalizedTime = formatIsoTimestamp(r.time) ?? r.time;
  return `${normalizedTime}|${r.source ?? ''}`;
}

/**
 * Convert a raw metric to a timestamped reading based on its shape.
 * Prefers rawDate (preserves embedded TZ offset) over the parsed Date object
 * so the dedup key stays stable across server timezone changes.
 */
function metricToReading(metric: Metric): Reading {
  const base = metric as BaseMetric;
  const time = formatIsoTimestamp(base.rawDate ?? base.date) ?? '';

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
  const reading: MetricReading = {
    time,
    value: base.qty,
  };
  if (base.source) reading.source = base.source;
  return reading;
}
