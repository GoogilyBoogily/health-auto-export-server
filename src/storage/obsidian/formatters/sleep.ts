/**
 * Sleep data formatter.
 * Transforms sleep_analysis metrics into Obsidian sleep tracking frontmatter.
 */

import { MetricName } from '../../../types';
import { getDateKey, roundTo } from '../utils/dateUtilities';

import type {
  Metric,
  SleepFrontmatter,
  SleepMetric,
  SleepSegment,
  SleepStageEntry,
  WristTemperatureMetric,
} from '../../../types';

/**
 * Grouped sleep data for a single night.
 * Combines sleep analysis metrics with wrist temperature.
 */
export interface SleepDateData {
  sleepMetrics: SleepMetric[];
  wristTemperature?: number;
}

// Night boundary hour for date assignment
// Sleep starting before this hour belongs to the previous day's "night"
const NIGHT_BOUNDARY_HOUR = 6;

type MetricsByType = Record<string, Metric[]>;

/**
 * Create sleep frontmatter from sleep data for a specific date.
 * Combines all sleep sessions into a single output with all segments.
 */
export function createSleepFrontmatter(
  dateKey: string,
  sleepData: SleepDateData,
  _existing?: SleepFrontmatter,
): SleepFrontmatter {
  const frontmatter: SleepFrontmatter = {
    date: dateKey,
  };

  const { sleepMetrics, wristTemperature } = sleepData;

  // Add wrist temperature if present
  if (wristTemperature !== undefined) {
    frontmatter.wristTemperature = wristTemperature;
  }

  if (sleepMetrics.length === 0) {
    return frontmatter;
  }

  // Collect all segments from all entries
  const allSegments = collectAndSortSegments(sleepMetrics);

  // Build frontmatter from segments or fall back to aggregate values
  if (allSegments.length > 0) {
    populateFromSegments(frontmatter, allSegments);
  } else {
    populateFromAggregates(frontmatter, sleepMetrics);
  }

  return frontmatter;
}

/**
 * Group sleep metrics by evening date (night date).
 * Sleep is attributed to the evening/night it started, not the wake-up date.
 * This matches the CSV import script's behavior for consistency.
 *
 * Example: Sleep starting 11:30 PM Dec 14, ending 7 AM Dec 15 → assigned to 2024-12-14.md
 */
export function groupSleepMetricsByDate(metricsByType: MetricsByType): Map<string, SleepDateData> {
  const byDate = new Map<string, SleepDateData>();

  // Process sleep analysis metrics
  const sleepData = metricsByType[MetricName.SLEEP_ANALYSIS] as SleepMetric[] | undefined;
  if (sleepData) {
    for (const sleep of sleepData) {
      // Use evening/night date for attribution (matches CSV import script)
      const dateKey = getNightDate(sleep.sleepStart);
      let dateData = byDate.get(dateKey);
      if (!dateData) {
        dateData = { sleepMetrics: [] };
        byDate.set(dateKey, dateData);
      }
      dateData.sleepMetrics.push(sleep);
    }
  }

  // Process wrist temperature metrics
  const wristTemperatureData = metricsByType[MetricName.APPLE_SLEEPING_WRIST_TEMPERATURE] as
    | WristTemperatureMetric[]
    | undefined;
  if (wristTemperatureData) {
    addWristTemperatureToSleepData(byDate, wristTemperatureData);
  }

  return byDate;
}

/**
 * Check if a metric type is sleep-related.
 */
export function isSleepMetric(metricType: string): boolean {
  return (
    metricType === (MetricName.SLEEP_ANALYSIS as string) ||
    metricType === (MetricName.APPLE_SLEEPING_WRIST_TEMPERATURE as string)
  );
}

/**
 * Merge new sleep data with existing frontmatter.
 * New values completely replace existing ones (sleep data is typically complete).
 */
export function mergeSleepFrontmatter(
  existing: SleepFrontmatter,
  newData: Partial<SleepFrontmatter>,
): SleepFrontmatter {
  // For sleep, we typically want to replace entirely with new data
  // But preserve any user-added fields
  return {
    ...existing,
    ...newData,
  };
}

/**
 * Add wrist temperature readings to sleep data, grouped by night date.
 * Uses the end date (morning after sleep) minus one day to determine the night.
 * Multiple readings for the same night are averaged.
 */
function addWristTemperatureToSleepData(
  byDate: Map<string, SleepDateData>,
  wristTemperatureMetrics: WristTemperatureMetric[],
): void {
  // Group wrist temperature readings by night date
  const temperaturesByDate = new Map<string, number[]>();
  for (const metric of wristTemperatureMetrics) {
    // Use end date minus one day to get the night date
    // (end date is the morning after sleep, so subtract a day)
    const dateKey = getNightDateFromEndDate(metric.endDate);
    let temperatures = temperaturesByDate.get(dateKey);
    if (!temperatures) {
      temperatures = [];
      temperaturesByDate.set(dateKey, temperatures);
    }
    temperatures.push(metric.qty);
  }

  // Add averaged wrist temperatures to sleep data
  for (const [dateKey, temperatures] of temperaturesByDate) {
    let dateData = byDate.get(dateKey);
    if (!dateData) {
      dateData = { sleepMetrics: [] };
      byDate.set(dateKey, dateData);
    }
    // Average multiple readings and round to 2 decimal places
    const average = temperatures.reduce((a, b) => a + b, 0) / temperatures.length;
    dateData.wristTemperature = roundTo(average, 2);
  }
}

/**
 * Collect segments from all sleep entries and sort by start time.
 */
function collectAndSortSegments(sleepEntries: SleepMetric[]): SleepSegment[] {
  const allSegments: SleepSegment[] = [];
  for (const entry of sleepEntries) {
    if (entry.segments) {
      allSegments.push(...entry.segments);
    }
  }
  allSegments.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  return allSegments;
}

/**
 * Format a Date to ISO 8601 string with local timezone offset.
 * Example output: "2025-12-29T21:39:09-06:00"
 */
function formatIsoTimestamp(date: Date): string {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  // Get timezone offset in hours and minutes
  const tzOffset = -date.getTimezoneOffset();
  const tzSign = tzOffset >= 0 ? '+' : '-';
  const tzHours = String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, '0');
  const tzMinutes = String(Math.abs(tzOffset) % 60).padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${tzSign}${tzHours}:${tzMinutes}`;
}

/**
 * Get the "night date" for a sleep session.
 * Sleep starting before NIGHT_BOUNDARY_HOUR (6 AM) belongs to the previous day's night.
 * This ensures sleep sessions spanning midnight are assigned to the evening date.
 */
function getNightDate(sleepStart: Date): string {
  const date = new Date(sleepStart);
  const hour = date.getHours();

  // If sleep starts before 6 AM, it belongs to the previous day's "night"
  if (hour < NIGHT_BOUNDARY_HOUR) {
    date.setDate(date.getDate() - 1);
  }

  return getDateKey(date);
}

/**
 * Get the night date from the end date of a sleep measurement.
 * The end date is the morning after sleep, so subtract one day to get the night.
 */
function getNightDateFromEndDate(endDate: Date): string {
  const date = new Date(endDate);
  date.setDate(date.getDate() - 1);
  return getDateKey(date);
}

/**
 * Populate frontmatter from aggregated sleep metrics (legacy fallback).
 */
function populateFromAggregates(frontmatter: SleepFrontmatter, entries: SleepMetric[]): void {
  let totalCore = 0;
  let totalDeep = 0;
  let totalRem = 0;
  let totalAwake = 0;
  let totalInBed = 0;
  let totalSegmentCount = 0;
  let earliestStart: Date | undefined;
  let latestEnd: Date | undefined;

  for (const entry of entries) {
    totalCore += entry.core;
    totalDeep += entry.deep;
    totalRem += entry.rem;
    totalAwake += entry.awake;
    totalInBed += entry.inBed;
    totalSegmentCount += entry.segmentCount ?? 0;

    if (!earliestStart || entry.sleepStart < earliestStart) {
      earliestStart = entry.sleepStart;
    }
    if (!latestEnd || entry.sleepEnd > latestEnd) {
      latestEnd = entry.sleepEnd;
    }
  }

  if (earliestStart) {
    frontmatter.sleepStart = formatIsoTimestamp(earliestStart);
  }
  if (latestEnd) {
    frontmatter.sleepEnd = formatIsoTimestamp(latestEnd);
  }

  const asleepDuration = totalCore + totalDeep + totalRem;
  frontmatter.inBedDuration = roundTo(totalInBed, 2);
  frontmatter.asleepDuration = roundTo(asleepDuration, 2);
  frontmatter.sleepEfficiency =
    totalInBed > 0 ? Math.round((asleepDuration / totalInBed) * 100) : undefined;
  if (totalSegmentCount > 0) {
    frontmatter.sleepSegments = totalSegmentCount;
  }
  frontmatter.coreHours = roundTo(totalCore, 2);
  frontmatter.deepHours = roundTo(totalDeep, 2);
  frontmatter.remHours = roundTo(totalRem, 2);
  frontmatter.awakeHours = roundTo(totalAwake, 2);
}

/**
 * Populate frontmatter from individual sleep segments.
 */
function populateFromSegments(frontmatter: SleepFrontmatter, segments: SleepSegment[]): void {
  frontmatter.sleepStages = segments.map(
    (seg): SleepStageEntry => ({
      duration: roundTo(seg.duration, 2),
      endTime: formatIsoTimestamp(seg.endTime),
      stage: seg.stage,
      startTime: formatIsoTimestamp(seg.startTime),
    }),
  );

  const firstSegment = segments[0];
  const lastSegment = segments.at(-1) ?? firstSegment;

  frontmatter.sleepStart = formatIsoTimestamp(firstSegment.startTime);
  frontmatter.sleepEnd = formatIsoTimestamp(lastSegment.endTime);

  const totals = { awake: 0, core: 0, deep: 0, rem: 0 };
  for (const seg of segments) {
    totals[seg.stage] += seg.duration;
  }

  const inBedDuration =
    (lastSegment.endTime.getTime() - firstSegment.startTime.getTime()) / (1000 * 60 * 60);
  const asleepDuration = totals.core + totals.deep + totals.rem;

  frontmatter.inBedDuration = roundTo(inBedDuration, 2);
  frontmatter.asleepDuration = roundTo(asleepDuration, 2);
  frontmatter.sleepEfficiency =
    inBedDuration > 0 ? Math.round((asleepDuration / inBedDuration) * 100) : undefined;
  frontmatter.sleepSegments = segments.length;
  frontmatter.coreHours = roundTo(totals.core, 2);
  frontmatter.deepHours = roundTo(totals.deep, 2);
  frontmatter.remHours = roundTo(totals.rem, 2);
  frontmatter.awakeHours = roundTo(totals.awake, 2);
}
