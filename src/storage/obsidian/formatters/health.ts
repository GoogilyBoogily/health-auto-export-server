/**
 * Health metrics formatter.
 * Transforms raw metrics into health tracking frontmatter.
 * Stores every metric type as unaggregated timestamped reading lists.
 */

import { HOURLY_BUCKETED_METRICS } from '../../../config';
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
import type { Logger } from '../../../utils/logger';

export type Reading = BloodPressureReading | HeartRateHealthReading | MetricReading;

/**
 * Merge health metrics into existing frontmatter for a specific date.
 * Each metric type becomes a key with an array of timestamped readings.
 * Non-health keys in the frontmatter are preserved.
 */
export function createHealthFrontmatter(
  dateKey: string,
  metricsByType: MetricsByType,
  existing?: DailyFrontmatter,
  log: Logger = logger,
): DailyFrontmatter {
  const frontmatter: DailyFrontmatter = existing ?? { date: dateKey };

  frontmatter.date = dateKey;

  const metricTypes = Object.keys(metricsByType);
  const metricCounts = Object.fromEntries(
    Object.entries(metricsByType).map(([k, v]) => [k, v.length]),
  );
  log.debugLog('TRANSFORM', 'Health frontmatter creation started', {
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

    frontmatter[key] = collapseReadings(metricType, [...existingReadings, ...newReadings]);
  }

  const fieldsSet = Object.keys(frontmatter);
  log.debugLog('TRANSFORM', 'Health frontmatter completed', {
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
export function groupHealthMetricsByDate(
  metricsByType: MetricsByType,
  log: Logger = logger,
): Map<string, MetricsByType> {
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
  log.debugLog('TRANSFORM', 'Health metrics grouped by date', {
    dateKeys: [...byDate.keys()],
    datesWithData: byDate.size,
    inputMetricTypes,
    totalInputMetrics,
  });

  return byDate;
}

/**
 * Dedup key for a stored reading.
 *
 * Keyed on the parsed instant rather than the timestamp text: the same moment arrives under
 * different UTC offsets when the device changes timezone, and two spellings of one instant are
 * one reading. Unparseable timestamps fall back to the raw text so a bad value cannot collapse
 * every reading in the array into one.
 *
 * Metrics the exporter delivers as one bucket per hour additionally fold to the hour, because it
 * re-buckets the same samples against a different anchor on every sync and those buckets are the
 * same hour re-reported. Everything else keeps its exact instant — several genuine readings in one
 * hour are normal for a discrete measurement, and for an event total two entries an hour apart are
 * two distinct events.
 *
 * `source` stays in the key so readings attributed to different device sets coexist.
 */
function dedupKey(r: Reading, metricType: string): string {
  const instant = instantOf(r.time);
  if (Number.isNaN(instant)) return `raw:${r.time}|${normalizeSource(r.source)}`;

  const bucket = HOURLY_BUCKETED_METRICS.has(snakeToCamelCase(metricType))
    ? Math.floor(instant / MILLISECONDS_PER_HOUR)
    : instant;

  return `${String(bucket)}|${normalizeSource(r.source)}`;
}

const MILLISECONDS_PER_HOUR = 3_600_000;

/**
 * Collapse a metric's readings onto the dedup key and order them by instant.
 *
 * Exported because the repair pass needs to apply exactly this rule to already-stored readings.
 * Two implementations of a dedup rule is two dedup rules.
 *
 * Where readings collapse onto one key the larger value wins. Insertion order is not freshness
 * order: the exporter sends its rolling window as concurrent requests where adjacent ones share a
 * date, so a partial bucket for an hour still in progress can arrive after the complete one.
 * Last-write-wins would store whichever request happened to finish last; the largest value for a
 * bucket is the most complete report of it.
 */
export function collapseReadings<T extends Reading>(metricType: string, readings: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const reading of readings) {
    const key = dedupKey(reading, metricType);
    const prior = byKey.get(key);
    if (prior && readingValue(prior) > readingValue(reading)) continue;
    byKey.set(key, reading);
  }
  return [...byKey.values()].toSorted((a, b) => instantOf(a.time) - instantOf(b.time));
}

/** Epoch milliseconds for a stored timestamp; NaN when it does not parse. */
function instantOf(time: string): number {
  return Date.parse(time);
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
      units: metric.units,
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
      units: metric.units,
    };
    if (metric.source) reading.source = metric.source;
    return reading;
  }

  // Default: BaseMetric with qty
  const reading: MetricReading = {
    time,
    units: base.units,
    value: base.qty,
  };
  if (base.source) reading.source = base.source;
  return reading;
}

/**
 * Canonical form of a `|`-separated device list: trimmed, de-duplicated, sorted.
 *
 * The list is a set, but the exporter spells it inconsistently — order varies between exports,
 * spacing varies, and a device occasionally repeats. Those spellings all describe one attribution
 * and must produce one key.
 */
function normalizeSource(source: string | undefined): string {
  if (!source) return '';
  const devices = source
    .split('|')
    .map((device) => device.trim())
    .filter(Boolean);
  return [...new Set(devices)].toSorted((a, b) => a.localeCompare(b)).join('|');
}

/**
 * The magnitude of a reading, for deciding which survives a collapse.
 *
 * Not every reading has `value`: heart rate carries `avg`/`max`/`min` and blood pressure carries
 * `systolic`/`diastolic`. Reading only `value` made both sides evaluate to 0, so `prior > incoming`
 * was always false and the later reading always won — turning "the larger value wins" into
 * order-dependent last-write-wins for precisely the two metrics where the wrong survivor matters:
 * a peak heart rate quietly revised downward, a hypertensive reading erased by a normal one.
 *
 * Coerced with `Number` because a handful of stored values are strings, and a bare `>` against a
 * string compares lexically — which is how `"8.8e-8"` beats a real total.
 */
function readingValue(r: Reading): number {
  const candidate = r as { avg?: unknown; systolic?: unknown; value?: unknown };
  return Number(candidate.value ?? candidate.avg ?? candidate.systolic) || 0;
}
