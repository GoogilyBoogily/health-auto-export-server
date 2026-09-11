/**
 * Metric data transformation utilities.
 * Transforms raw metric data from the API into typed metric objects.
 */

import { MetricsConfig } from '../config';
import { getDateKey, getLocalHour, nextDateKey } from '../storage/obsidian/utils/dateUtilities';
import { MetricName } from '../types';
import { Logger, ValidationStats } from '../utils/logger';

import type {
  BaseMetric,
  BloodPressureMetric,
  HeartRateMetric,
  Metric,
  MetricData,
  SleepMetric,
  SleepSegment,
  SleepSegmentRaw,
  SleepStage,
  SleepStageValue,
} from '../types';

// Valid sleep stage values from Health Auto Export
const VALID_SLEEP_STAGES_SET = new Set<string>(MetricsConfig.validSleepStages);

/**
 * Metrics measured during sleep but stamped at bedtime.
 *
 * Apple files these against the evening they start, while the sleep stages for the same night
 * are filed against the morning you wake up. Left alone, one night's data lands in two files.
 */
const SLEEP_WINDOW_METRICS = new Set<string>([
  MetricName.APPLE_SLEEPING_WRIST_TEMPERATURE,
  MetricName.BREATHING_DISTURBANCES,
]);

/**
 * Request-scoped context for tracking validation stats.
 * Prevents race conditions from module-level mutable state.
 */
export interface MappingContext {
  stats: ValidationStats;
  logger?: Logger;
}

/**
 * Create a new mapping context for a request.
 */
export function createMappingContext(logger?: Logger): MappingContext {
  return {
    logger,
    stats: {
      invalidDates: 0,
      processedRecords: 0,
      skippedRecords: 0,
      typeMismatches: 0,
      unknownStages: 0,
    },
  };
}

/**
 * Flush validation stats and log summary.
 */
export function flushValidationStats(context: MappingContext): ValidationStats {
  const stats = { ...context.stats };
  context.logger?.debugValidationSummary(stats);
  return stats;
}

/**
 * Log validation warning if there were data quality issues.
 * Called after processing to surface issues at WARN level.
 */
export function logValidationWarning(context: MappingContext): void {
  const { logger, stats } = context;
  if (!logger) return;

  const hasIssues = stats.invalidDates > 0 || stats.typeMismatches > 0 || stats.unknownStages > 0;

  if (hasIssues && stats.skippedRecords > 0) {
    const issues: string[] = [];
    if (stats.invalidDates > 0) issues.push(`${String(stats.invalidDates)} invalid dates`);
    if (stats.typeMismatches > 0) issues.push(`${String(stats.typeMismatches)} type mismatches`);
    if (stats.unknownStages > 0) issues.push(`${String(stats.unknownStages)} unknown sleep stages`);

    logger.warn(
      `Data quality issues: ${String(stats.skippedRecords)}/${String(stats.processedRecords + stats.skippedRecords)} records skipped`,
      {
        details: issues.join(', '),
        validationStats: stats,
      },
    );
  }
}

/**
 * Check that every required field is present and correctly typed.
 *
 * `date` is the only non-numeric required field across all metric shapes; everything else
 * (qty, systolic/diastolic, Avg/Max/Min) is a measurement and must be a finite number. That
 * makes the check branch-aware for free — no per-metric-type configuration needed.
 *
 * Presence alone is not enough: Zod passes metric datums through untyped, so a stringified or
 * object-valued quantity would otherwise reach the vault verbatim. `date` is checked just as
 * strictly, because it decides the filename: a boolean or a number reaches `new Date()` intact
 * and files the reading under 1969-12-31, and an array stringifies a day early.
 */
function hasRequiredFields(object: unknown, fields: string[]): boolean {
  if (!object || typeof object !== 'object') return false;
  const record = object as Record<string, unknown>;

  return fields.every((field) => {
    const value = record[field];
    if (value === undefined || value === null) return false;
    if (field === 'date') return typeof value === 'string' || value instanceof Date;
    return typeof value === 'number' && Number.isFinite(value);
  });
}

/**
 * Check if a Date object is valid (not NaN).
 */
function isValidDate(date: Date): boolean {
  return !Number.isNaN(date.getTime());
}

/**
 * Validate metric data has required fields and a valid date.
 */
function isValidMetricData(
  data: unknown,
  requiredFields: string[],
  metricType: string,
  context: MappingContext,
): boolean {
  if (!hasRequiredFields(data, requiredFields)) {
    context.stats.typeMismatches++;
    context.stats.skippedRecords++;
    context.logger?.debugTypeMismatch(metricType, requiredFields, data);
    return false;
  }

  const record = data as { date: unknown };
  const date = new Date(record.date as Date | string);
  if (!isValidDate(date)) {
    context.stats.invalidDates++;
    context.stats.skippedRecords++;
    context.logger?.debugInvalidDate(record.date, metricType);
    return false;
  }

  return true;
}

/**
 * Check if a string value is a valid sleep stage.
 */
function isValidSleepStage(value: unknown): value is SleepStageValue {
  return typeof value === 'string' && VALID_SLEEP_STAGES_SET.has(value);
}

/**
 * Decide which daily file a measurement belongs in.
 *
 * For sleep-window metrics an evening reading describes the night ahead, so it is attributed
 * to the following day — matching where that night's sleep stages are stored. Everything else
 * keeps the date it was recorded on.
 */
function resolveSourceDate(metricName: string, rawDate: Date | string): string {
  const dateKey = getDateKey(rawDate);
  if (!SLEEP_WINDOW_METRICS.has(metricName)) return dateKey;

  const hour = getLocalHour(rawDate);
  if (hour === undefined || hour < MetricsConfig.sleepWindowCutoffHour) return dateKey;

  return nextDateKey(dateKey);
}

/**
 * Convert uppercase sleep stage value to lowercase.
 * Only accepts validated SleepStageValue inputs.
 */
function toLowercaseStage(value: SleepStageValue): SleepStage | 'inBed' {
  const stageMap: Record<SleepStageValue, SleepStage | 'inBed'> = {
    Asleep: 'asleep',
    Awake: 'awake',
    Core: 'core',
    Deep: 'deep',
    'In Bed': 'inBed',
    REM: 'rem',
  };
  return stageMap[value];
}

/**
 * Map a single metric data object to typed metric objects.
 * Uses request-scoped context for validation tracking.
 */
export const mapMetric = (
  metric: MetricData,
  context: MappingContext = createMappingContext(),
): (BloodPressureMetric | HeartRateMetric | Metric | SleepMetric)[] => {
  // Cast to MetricName for switch comparison - unknown strings handled by default case
  const metricName = metric.name as MetricName;
  let result: (BloodPressureMetric | HeartRateMetric | Metric | SleepMetric)[];

  switch (metricName) {
    case MetricName.BLOOD_PRESSURE: {
      const rawData = metric.data;
      result = rawData
        .filter((m): m is BloodPressureMetric =>
          isValidMetricData(m, ['date', 'systolic', 'diastolic'], 'blood_pressure', context),
        )
        .map((measurement) => {
          context.stats.processedRecords++;
          return {
            date: new Date(measurement.date),
            diastolic: measurement.diastolic,
            metadata: measurement.metadata,
            rawDate: typeof measurement.date === 'string' ? measurement.date : undefined,
            source: measurement.source,
            sourceDate: getDateKey(measurement.date),
            systolic: measurement.systolic,
            units: metric.units,
          };
        });
      break;
    }
    case MetricName.HEART_RATE: {
      const rawData = metric.data;
      result = rawData
        .filter((m): m is HeartRateMetric =>
          isValidMetricData(m, ['date', 'Avg', 'Max', 'Min'], 'heart_rate', context),
        )
        .map((measurement) => {
          context.stats.processedRecords++;
          return {
            Avg: measurement.Avg,
            date: new Date(measurement.date),
            Max: measurement.Max,
            metadata: measurement.metadata,
            Min: measurement.Min,
            rawDate: typeof measurement.date === 'string' ? measurement.date : undefined,
            source: measurement.source,
            sourceDate: getDateKey(measurement.date),
            units: metric.units,
          };
        });
      break;
    }
    case MetricName.SLEEP_ANALYSIS: {
      const rawData = metric.data;

      // Segment data has 'value', 'startDate' and 'endDate' fields.
      if (isSegmentFormat(rawData)) {
        result = aggregateSegments(rawData as SleepSegmentRaw[], metric.units, context);
        break;
      }

      // Legacy aggregated payloads carry per-stage totals plus a sleep and bed window rather
      // than segments. The sleep formatter synthesizes stage entries from them, so they are
      // mapped rather than dropped.
      const sleepData = rawData as SleepMetric[];
      result = sleepData.map((measurement) => ({
        asleep: measurement.asleep,
        awake: measurement.awake,
        core: measurement.core,
        date: new Date(measurement.date),
        deep: measurement.deep,
        inBed: measurement.inBed,
        inBedEnd: new Date(measurement.inBedEnd),
        inBedStart: new Date(measurement.inBedStart),
        metadata: measurement.metadata,
        rem: measurement.rem,
        sleepEnd: new Date(measurement.sleepEnd),
        sleepStart: new Date(measurement.sleepStart),
        source: measurement.source,
        sourceDate: getDateKey(measurement.sleepEnd),
        totalSleep: measurement.totalSleep,
        units: metric.units,
      }));
      break;
    }
    default: {
      const rawData = metric.data;
      result = rawData
        .filter((m): m is BaseMetric =>
          isValidMetricData(m, ['date', 'qty'], 'base_metric', context),
        )
        .map((measurement) => {
          context.stats.processedRecords++;
          return {
            date: new Date(measurement.date),
            metadata: measurement.metadata,
            qty: measurement.qty,
            rawDate: typeof measurement.date === 'string' ? measurement.date : undefined,
            source: measurement.source,
            sourceDate: resolveSourceDate(metric.name, measurement.date),
            units: metric.units,
          };
        });
    }
  }

  // Debug: Log metric mapping transformation
  context.logger?.debugMetricMapping(metric.name, metric.data, result);

  return result;
};

/**
 * Aggregate sleep segments into sleep sessions.
 * Groups consecutive segments into sessions based on time gaps,
 * then calculates totals for each session.
 */
function aggregateSegments(
  segments: unknown[],
  units: string,
  context: MappingContext,
): SleepMetric[] {
  if (segments.length === 0) return [];

  // Filter out invalid segments before processing
  const validSegments = segments.filter((seg): seg is SleepSegmentRaw =>
    isValidSleepSegment(seg, context),
  );

  if (validSegments.length === 0) return [];

  // Sort by start time (toSorted creates a copy, avoiding mutation)
  const sorted = validSegments.toSorted(
    (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
  );

  // Group into sessions (30 min gap = new session)
  const sessions = groupIntoSessions(sorted);

  const result = sessions.map((session: SleepSegmentRaw[]) => {
    // Sessions are guaranteed non-empty by groupIntoSessions
    const first = session[0];
    const last = session.at(-1) ?? first;

    // "In Bed" rows are bed-window metadata, not a sleep stage. Apple has not sent one in any
    // observed payload, but the filter stays so that if it starts, the row is not counted as
    // sleep time.
    const sleepSegments = session.filter((seg) => seg.value !== 'In Bed');

    // Aggregate by stage type
    const totals = { Asleep: 0, Awake: 0, Core: 0, Deep: 0, REM: 0 };
    for (const seg of sleepSegments) {
      totals[seg.value as keyof typeof totals] += seg.qty;
    }

    // Bed window, for the legacy aggregated shape consumers still read. "In Bed" rows give it
    // directly when present; otherwise the session's own extent is the best available answer.
    const inBedSegments = session.filter((seg) => seg.value === 'In Bed');
    const bedStart =
      inBedSegments.length > 0 ? new Date(inBedSegments[0].startDate) : new Date(first.startDate);
    const bedEnd =
      inBedSegments.length > 0
        ? new Date((inBedSegments.at(-1) ?? inBedSegments[0]).endDate)
        : new Date(last.endDate);

    const sleepFirst = sleepSegments[0] ?? first;
    const sleepLast = sleepSegments.at(-1) ?? last;
    const sleepStart = new Date(sleepFirst.startDate);
    const sleepEnd = new Date(sleepLast.endDate);

    const asleepHours = totals.Asleep + totals.Core + totals.Deep + totals.REM;

    // Convert sleep segments (excluding "In Bed") to typed SleepSegment objects
    const mappedSegments: SleepSegment[] = sleepSegments.map((seg) => ({
      duration: seg.qty,
      endTime: new Date(seg.endDate),
      rawEndTime: seg.endDate,
      rawStartTime: seg.startDate,
      source: seg.source,
      stage: toLowercaseStage(seg.value) as SleepStage,
      startTime: new Date(seg.startDate),
    }));

    return {
      asleep: totals.Asleep > 0 ? totals.Asleep : undefined,
      awake: totals.Awake,
      core: totals.Core,
      date: sleepStart,
      deep: totals.Deep,
      inBed: (bedEnd.getTime() - bedStart.getTime()) / (1000 * 60 * 60),
      inBedEnd: bedEnd,
      inBedStart: bedStart,
      rem: totals.REM,
      segmentCount: sleepSegments.length,
      segments: mappedSegments,
      sleepEnd,
      sleepStart,
      source: first.source,
      sourceDate: getDateKey(sleepLast.endDate),
      totalSleep: asleepHours,
      units,
    };
  });

  // Debug: Log sleep segment aggregation details
  context.logger?.debugSleepAggregation(segments, sessions, result);

  return result;
}

/**
 * Group sleep segments into sessions based on time gaps.
 * A gap of more than the configured threshold starts a new session.
 */
function groupIntoSessions(segments: SleepSegmentRaw[]): SleepSegmentRaw[][] {
  const sessions: SleepSegmentRaw[][] = [];
  let currentSession: SleepSegmentRaw[] = [];
  // Track the furthest end seen so far, not just the previous segment's. Segments are sorted
  // by start, so one long enveloping segment (an "In Bed" row spanning the night) would
  // otherwise reset the baseline and split the night into spurious sessions.
  let sessionEndMs = 0;

  for (const segment of segments) {
    const segmentEndMs = new Date(segment.endDate).getTime();

    if (currentSession.length === 0) {
      currentSession.push(segment);
      sessionEndMs = segmentEndMs;
      continue;
    }

    const currentStartMs = new Date(segment.startDate).getTime();
    const gapMins = (currentStartMs - sessionEndMs) / (1000 * 60);

    if (gapMins > MetricsConfig.sessionGapThresholdMinutes) {
      // Gap too large, start new session
      sessions.push(currentSession);
      currentSession = [segment];
      sessionEndMs = segmentEndMs;
    } else {
      currentSession.push(segment);
      sessionEndMs = Math.max(sessionEndMs, segmentEndMs);
    }
  }

  if (currentSession.length > 0) {
    sessions.push(currentSession);
  }

  return sessions;
}

/**
 * Check if sleep data is in segment format (individual stage entries).
 * Segment format has 'value' and 'startDate' fields.
 * Aggregated format has 'sleepStart', 'core', 'deep', 'rem' fields.
 */
function isSegmentFormat(data: unknown[]): boolean {
  const first = data[0];
  if (!first || typeof first !== 'object') return false;
  return 'value' in first && 'startDate' in first && 'endDate' in first;
}

/**
 * Validate a sleep segment has valid duration, time range, and stage value.
 *
 * `qty` is type-checked, not just compared: `undefined <= 0` is false, so an absent duration
 * used to pass straight through and surface as `.nan` in the stored stage and every total
 * derived from it.
 */
function isValidSleepSegment(segment: unknown, context: MappingContext): boolean {
  if (!segment || typeof segment !== 'object') {
    context.stats.typeMismatches++;
    context.stats.skippedRecords++;
    return false;
  }

  const candidate = segment as Partial<SleepSegmentRaw>;

  // Duration must be a real, positive number of hours
  if (typeof candidate.qty !== 'number' || !Number.isFinite(candidate.qty)) {
    context.stats.typeMismatches++;
    context.stats.skippedRecords++;
    context.logger?.debugTypeMismatch('sleep_segment', ['qty'], segment);
    return false;
  }
  if (candidate.qty <= 0) {
    context.stats.skippedRecords++;
    return false;
  }

  // Validate sleep stage value
  if (!isValidSleepStage(candidate.value)) {
    context.stats.unknownStages++;
    context.stats.skippedRecords++;
    context.logger?.debugUnknownSleepStage(
      candidate.value,
      [...MetricsConfig.validSleepStages],
      segment,
    );
    return false;
  }

  // Check for invalid dates (NaN)
  const startTime = new Date(candidate.startDate ?? '').getTime();
  const endTime = new Date(candidate.endDate ?? '').getTime();

  if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
    context.stats.invalidDates++;
    context.stats.skippedRecords++;
    context.logger?.debugInvalidDate(
      { endDate: candidate.endDate, startDate: candidate.startDate },
      'sleep_segment',
    );
    return false;
  }

  // End time must be after start time
  if (endTime <= startTime) {
    context.stats.skippedRecords++;
    return false;
  }

  context.stats.processedRecords++;
  return true;
}
