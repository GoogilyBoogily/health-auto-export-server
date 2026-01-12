/**
 * Metric data transformation utilities.
 * Transforms raw metric data from the API into typed metric objects.
 */

import { MetricName } from '../types';
import { debugMetricMapping, debugSleepAggregation, isDebugEnabled } from '../utils/debugLogger';
import { logger } from '../utils/logger';

import type {
  BaseMetric,
  BloodPressureMetric,
  HeartRateMetric,
  Metric,
  MetricData,
  SleepMetric,
  SleepSegmentRaw,
} from '../types';

// Gap threshold for grouping sleep segments into sessions (in minutes)
const SESSION_GAP_THRESHOLD_MINUTES = 30;

export const mapMetric = (
  metric: MetricData,
): (BloodPressureMetric | HeartRateMetric | Metric | SleepMetric)[] => {
  // Cast to MetricName for switch comparison - unknown strings handled by default case
  const metricName = metric.name as MetricName;
  let result: (BloodPressureMetric | HeartRateMetric | Metric | SleepMetric)[];

  switch (metricName) {
    case MetricName.BLOOD_PRESSURE: {
      const bpData = metric.data as BloodPressureMetric[];
      result = bpData.map((measurement) => ({
        date: new Date(measurement.date),
        diastolic: measurement.diastolic,
        metadata: measurement.metadata,
        source: measurement.source,
        systolic: measurement.systolic,
        units: metric.units,
      }));
      break;
    }
    case MetricName.HEART_RATE: {
      const hrData = metric.data as HeartRateMetric[];
      result = hrData.map((measurement) => ({
        Avg: measurement.Avg,
        date: new Date(measurement.date),
        Max: measurement.Max,
        metadata: measurement.metadata,
        Min: measurement.Min,
        source: measurement.source,
        units: metric.units,
      }));
      break;
    }
    case MetricName.SLEEP_ANALYSIS: {
      const rawData = metric.data as unknown[];

      // Detect format: segment data has 'value' and 'startDate' fields
      if (isSegmentFormat(rawData)) {
        result = aggregateSegments(rawData as SleepSegmentRaw[], metric.units);
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
      const baseData = metric.data as BaseMetric[];
      result = baseData.map((measurement) => ({
        date: new Date(measurement.date),
        metadata: measurement.metadata,
        qty: measurement.qty,
        source: measurement.source,
        units: metric.units,
      }));
    }
  }

  // Debug: Log metric mapping transformation
  if (isDebugEnabled()) {
    debugMetricMapping(logger, metric.name, metric.data, result);
  }

  return result;
};

/**
 * Aggregate sleep segments into sleep sessions.
 * Groups consecutive segments into sessions based on time gaps,
 * then calculates totals for each session.
 */
function aggregateSegments(segments: SleepSegmentRaw[], units: string): SleepMetric[] {
  if (segments.length === 0) return [];

  // Sort by start time (toSorted creates a copy, avoiding mutation)
  const sorted = [...segments].toSorted(
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
      sleepEnd,
      sleepStart,
      source: first.source,
      totalSleep: asleepHours,
      units,
    };
  });

  // Debug: Log sleep segment aggregation details
  if (isDebugEnabled()) {
    debugSleepAggregation(logger, segments, sessions, result);
  }

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
