/**
 * Metric data transformation utilities.
 * Transforms raw metric data from the API into typed metric objects.
 */

import { MetricName } from '../types';
import {
  debugInvalidDate,
  debugMetricMapping,
  debugSleepAggregation,
  debugTypeMismatch,
  debugUnknownSleepStage,
  debugValidationSummary,
  isDebugEnabled,
} from '../utils/debugLogger';
import { Logger } from '../utils/logger';

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
  WristTemperatureMetric,
} from '../types';
import type { ValidationStats } from '../utils/debugLogger';

// Gap threshold for grouping sleep segments into sessions (in minutes)
const SESSION_GAP_THRESHOLD_MINUTES = 30;

// Valid sleep stage values from Health Auto Export
const VALID_SLEEP_STAGES = ['Awake', 'Core', 'Deep', 'REM'] as const;
const VALID_SLEEP_STAGES_SET = new Set<string>(VALID_SLEEP_STAGES);

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
 * Flush validation stats and log summary if debug is enabled.
 */
export function flushValidationStats(context: MappingContext): ValidationStats {
  const stats = { ...context.stats };
  if (isDebugEnabled() && context.logger) {
    debugValidationSummary(context.logger, stats);
  }
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
 * Check if an object has all required fields defined (not undefined or null).
 */
function hasRequiredFields(object: unknown, fields: string[]): boolean {
  if (!object || typeof object !== 'object') return false;
  const record = object as Record<string, unknown>;
  return fields.every(
    (field) => field in record && record[field] !== undefined && record[field] !== null,
  );
}

/**
 * Validate base metric data has required fields and valid date.
 */
function isValidBaseMetricData(data: unknown, context: MappingContext): data is BaseMetric {
  if (!hasRequiredFields(data, ['date', 'qty'])) {
    context.stats.typeMismatches++;
    context.stats.skippedRecords++;
    debugTypeMismatch(context.logger, 'base_metric', ['date', 'qty'], data);
    return false;
  }

  const record = data as { date: unknown };
  const date = new Date(record.date as Date | string);
  if (!isValidDate(date)) {
    context.stats.invalidDates++;
    context.stats.skippedRecords++;
    debugInvalidDate(context.logger, record.date, 'base_metric');
    return false;
  }

  return true;
}

/**
 * Validate blood pressure data has required fields and valid date.
 */
function isValidBloodPressureData(
  data: unknown,
  context: MappingContext,
): data is BloodPressureMetric {
  if (!hasRequiredFields(data, ['date', 'systolic', 'diastolic'])) {
    context.stats.typeMismatches++;
    context.stats.skippedRecords++;
    debugTypeMismatch(context.logger, 'blood_pressure', ['date', 'systolic', 'diastolic'], data);
    return false;
  }

  const record = data as { date: unknown };
  const date = new Date(record.date as Date | string);
  if (!isValidDate(date)) {
    context.stats.invalidDates++;
    context.stats.skippedRecords++;
    debugInvalidDate(context.logger, record.date, 'blood_pressure');
    return false;
  }

  return true;
}

/**
 * Check if a Date object is valid (not NaN).
 */
function isValidDate(date: Date): boolean {
  return !Number.isNaN(date.getTime());
}

/**
 * Validate heart rate data has required fields and valid date.
 */
function isValidHeartRateData(data: unknown, context: MappingContext): data is HeartRateMetric {
  if (!hasRequiredFields(data, ['date', 'Avg', 'Max', 'Min'])) {
    context.stats.typeMismatches++;
    context.stats.skippedRecords++;
    debugTypeMismatch(context.logger, 'heart_rate', ['date', 'Avg', 'Max', 'Min'], data);
    return false;
  }

  const record = data as { date: unknown };
  const date = new Date(record.date as Date | string);
  if (!isValidDate(date)) {
    context.stats.invalidDates++;
    context.stats.skippedRecords++;
    debugInvalidDate(context.logger, record.date, 'heart_rate');
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
 * Convert uppercase sleep stage value to lowercase.
 * Only accepts validated SleepStageValue inputs.
 */
function toLowercaseStage(value: SleepStageValue): SleepStage {
  const stageMap: Record<SleepStageValue, SleepStage> = {
    Awake: 'awake',
    Core: 'core',
    Deep: 'deep',
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
    case MetricName.APPLE_SLEEPING_WRIST_TEMPERATURE: {
      // Wrist temperature needs end date for accurate night attribution
      const wristTemporaryData = metric.data as (BaseMetric & { end?: string })[];
      result = wristTemporaryData
        .filter((m) => isValidBaseMetricData(m, context))
        .map((measurement): WristTemperatureMetric => {
          context.stats.processedRecords++;
          return {
            date: new Date(measurement.date),
            endDate: measurement.end ? new Date(measurement.end) : new Date(measurement.date),
            metadata: measurement.metadata,
            qty: measurement.qty,
            source: measurement.source,
            units: metric.units,
          };
        });
      break;
    }
    case MetricName.BLOOD_PRESSURE: {
      const rawData = metric.data as unknown[];
      result = rawData
        .filter((m): m is BloodPressureMetric => isValidBloodPressureData(m, context))
        .map((measurement) => {
          context.stats.processedRecords++;
          return {
            date: new Date(measurement.date),
            diastolic: measurement.diastolic,
            metadata: measurement.metadata,
            source: measurement.source,
            systolic: measurement.systolic,
            units: metric.units,
          };
        });
      break;
    }
    case MetricName.HEART_RATE: {
      const rawData = metric.data as unknown[];
      result = rawData
        .filter((m): m is HeartRateMetric => isValidHeartRateData(m, context))
        .map((measurement) => {
          context.stats.processedRecords++;
          return {
            Avg: measurement.Avg,
            date: new Date(measurement.date),
            Max: measurement.Max,
            metadata: measurement.metadata,
            Min: measurement.Min,
            source: measurement.source,
            units: metric.units,
          };
        });
      break;
    }
    case MetricName.SLEEP_ANALYSIS: {
      const rawData = metric.data as unknown[];

      // Detect format: segment data has 'value' and 'startDate' fields
      if (isSegmentFormat(rawData)) {
        result = aggregateSegments(rawData as SleepSegmentRaw[], metric.units, context);
        break;
      }

      // Legacy aggregated format (pre-aggregated totals)
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
        totalSleep: measurement.totalSleep,
        units: metric.units,
      }));
      break;
    }
    default: {
      const rawData = metric.data as unknown[];
      result = rawData
        .filter((m): m is BaseMetric => isValidBaseMetricData(m, context))
        .map((measurement) => {
          context.stats.processedRecords++;
          return {
            date: new Date(measurement.date),
            metadata: measurement.metadata,
            qty: measurement.qty,
            source: measurement.source,
            units: metric.units,
          };
        });
    }
  }

  // Debug: Log metric mapping transformation
  debugMetricMapping(context.logger, metric.name, metric.data, result);

  return result;
};

/**
 * Aggregate sleep segments into sleep sessions.
 * Groups consecutive segments into sessions based on time gaps,
 * then calculates totals for each session.
 */
function aggregateSegments(
  segments: SleepSegmentRaw[],
  units: string,
  context: MappingContext,
): SleepMetric[] {
  if (segments.length === 0) return [];

  // Filter out invalid segments before processing
  const validSegments = segments.filter((seg) => isValidSleepSegment(seg, context));

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

    // Aggregate by stage type
    const totals = { Awake: 0, Core: 0, Deep: 0, REM: 0 };
    for (const seg of session) {
      totals[seg.value] += seg.qty;
    }

    const sleepStart = new Date(first.startDate);
    const sleepEnd = new Date(last.endDate);
    const inBedHours = (sleepEnd.getTime() - sleepStart.getTime()) / (1000 * 60 * 60);
    const asleepHours = totals.Core + totals.Deep + totals.REM;

    // Convert raw segments to typed SleepSegment objects
    // Stage is already validated in isValidSleepSegment
    const mappedSegments: SleepSegment[] = session.map((seg) => ({
      duration: seg.qty, // Already in hours
      endTime: new Date(seg.endDate),
      stage: toLowercaseStage(seg.value),
      startTime: new Date(seg.startDate),
    }));

    return {
      awake: totals.Awake,
      core: totals.Core,
      date: sleepStart,
      deep: totals.Deep,
      inBed: inBedHours,
      inBedEnd: sleepEnd,
      inBedStart: sleepStart,
      rem: totals.REM,
      segmentCount: session.length,
      segments: mappedSegments,
      sleepEnd,
      sleepStart,
      source: first.source,
      totalSleep: asleepHours,
      units,
    };
  });

  // Debug: Log sleep segment aggregation details
  debugSleepAggregation(context.logger, segments, sessions, result);

  return result;
}

/**
 * Group sleep segments into sessions based on time gaps.
 * A gap of more than SESSION_GAP_THRESHOLD_MINUTES starts a new session.
 */
function groupIntoSessions(segments: SleepSegmentRaw[]): SleepSegmentRaw[][] {
  const sessions: SleepSegmentRaw[][] = [];
  let currentSession: SleepSegmentRaw[] = [];

  for (const segment of segments) {
    if (currentSession.length === 0) {
      currentSession.push(segment);
      continue;
    }

    const lastSegment = currentSession.at(-1);
    if (!lastSegment) continue;
    const previousEnd = new Date(lastSegment.endDate);
    const currentStart = new Date(segment.startDate);
    const gapMs = currentStart.getTime() - previousEnd.getTime();
    const gapMins = gapMs / (1000 * 60);

    if (gapMins > SESSION_GAP_THRESHOLD_MINUTES) {
      // Gap too large, start new session
      sessions.push(currentSession);
      currentSession = [segment];
    } else {
      currentSession.push(segment);
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
  if (data.length === 0) return false;
  const first = data[0] as Record<string, unknown>;
  return 'value' in first && 'startDate' in first && 'endDate' in first;
}

/**
 * Validate a sleep segment has valid duration, time range, and stage value.
 */
function isValidSleepSegment(segment: SleepSegmentRaw, context: MappingContext): boolean {
  // Duration must be positive
  if (segment.qty <= 0) {
    context.stats.skippedRecords++;
    return false;
  }

  // Validate sleep stage value
  if (!isValidSleepStage(segment.value)) {
    context.stats.unknownStages++;
    context.stats.skippedRecords++;
    debugUnknownSleepStage(context.logger, segment.value, [...VALID_SLEEP_STAGES], segment);
    return false;
  }

  // Check for invalid dates (NaN)
  const startTime = new Date(segment.startDate).getTime();
  const endTime = new Date(segment.endDate).getTime();

  if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
    context.stats.invalidDates++;
    context.stats.skippedRecords++;
    debugInvalidDate(
      context.logger,
      { endDate: segment.endDate, startDate: segment.startDate },
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
