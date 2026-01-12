/**
 * Sleep data formatter.
 * Transforms sleep_analysis metrics into Obsidian sleep tracking frontmatter.
 */

import { MetricName } from '../../../types';
import {
  formatTime,
  getDateKey,
  getMonthKey,
  getWeekKey,
  parseDateKey,
  roundTo,
} from '../utils/dateUtilities';

import type { Metric, NapSession, SleepFrontmatter, SleepMetric } from '../../../types';

// Minimum duration in hours to be considered main sleep (vs nap)
// Matches CSV import script threshold
const MIN_MAIN_SLEEP_HOURS = 2;

// Hours range for "evening" start time (main sleep usually starts between 6pm-6am)
// Matches CSV import script thresholds
const EVENING_START_HOUR = 18; // 6 PM
const MORNING_CUTOFF_HOUR = 6; // 6 AM

// Night boundary hour for date assignment
// Sleep starting before this hour belongs to the previous day's "night"
const NIGHT_BOUNDARY_HOUR = 6;

type MetricsByType = Record<string, Metric[]>;

/**
 * Create sleep frontmatter from sleep metrics for a specific date.
 * Data values (core, deep, rem, awake, inBed) are already in hours from the mapper.
 */
export function createSleepFrontmatter(
  dateKey: string,
  sleepEntries: SleepMetric[],
  existing?: SleepFrontmatter,
  wristTemporary?: number,
): SleepFrontmatter {
  const date = parseDateKey(dateKey);
  const frontmatter: SleepFrontmatter = existing ?? {
    date: dateKey,
    monthKey: getMonthKey(date),
    type: 'sleep',
    weekKey: getWeekKey(date),
  };

  // Always update date keys
  frontmatter.date = dateKey;
  frontmatter.weekKey = getWeekKey(date);
  frontmatter.monthKey = getMonthKey(date);

  // Separate main sleep from naps
  const mainSleepEntries = sleepEntries.filter((sleep) => isMainSleep(sleep));
  const napEntries = sleepEntries.filter((sleep) => !isMainSleep(sleep));

  // Process main sleep (use the longest one if multiple)
  if (mainSleepEntries.length > 0) {
    // Sort by total sleep duration, take the longest
    mainSleepEntries.sort((a, b) => b.core + b.deep + b.rem - (a.core + a.deep + a.rem));
    const mainSleep = mainSleepEntries[0];

    frontmatter.sleepStart = formatTime(mainSleep.sleepStart);
    frontmatter.sleepEnd = formatTime(mainSleep.sleepEnd);
    frontmatter.inBedDuration = roundTo(mainSleep.inBed, 2); // Already in hours
    frontmatter.asleepDuration = roundTo(mainSleep.core + mainSleep.deep + mainSleep.rem, 2);
    frontmatter.sleepEfficiency =
      mainSleep.inBed > 0
        ? Math.round(((mainSleep.core + mainSleep.deep + mainSleep.rem) / mainSleep.inBed) * 100)
        : undefined;

    // Sleep stage breakdown (already in hours)
    frontmatter.coreHours = roundTo(mainSleep.core, 2);
    frontmatter.deepHours = roundTo(mainSleep.deep, 2);
    frontmatter.remHours = roundTo(mainSleep.rem, 2);
    frontmatter.awakeHours = roundTo(mainSleep.awake, 2);

    // Sleep segments count (from segment aggregation)
    if (mainSleep.segmentCount) {
      frontmatter.sleepSegments = mainSleep.segmentCount;
    }

    // Source
    frontmatter.source = mainSleep.source;
  }

  // Add wrist temperature if available
  if (wristTemporary !== undefined) {
    frontmatter.wristTemp = wristTemporary;
  }

  // Process naps
  if (napEntries.length > 0) {
    const napSessions: NapSession[] = napEntries.map((nap) => ({
      duration: roundTo(nap.core + nap.deep + nap.rem, 2), // Already in hours
      endTime: formatTime(nap.sleepEnd) ?? '',
      startTime: formatTime(nap.sleepStart) ?? '',
    }));

    frontmatter.napSessions = napSessions;
    frontmatter.napCount = napSessions.length;
    frontmatter.napDuration = roundTo(
      napSessions.reduce((sum, n) => sum + n.duration, 0),
      2,
    );
  } else {
    // Remove nap fields if no naps
    delete frontmatter.napSessions;
    delete frontmatter.napCount;
    delete frontmatter.napDuration;
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
export function groupSleepMetricsByDate(metricsByType: MetricsByType): Map<string, SleepMetric[]> {
  const byDate = new Map<string, SleepMetric[]>();

  const sleepData = metricsByType[MetricName.SLEEP_ANALYSIS] as SleepMetric[] | undefined;
  if (!sleepData) return byDate;

  for (const sleep of sleepData) {
    // Use evening/night date for attribution (matches CSV import script)
    const dateKey = getNightDate(sleep.sleepStart);
    let dateEntries = byDate.get(dateKey);
    if (!dateEntries) {
      dateEntries = [];
      byDate.set(dateKey, dateEntries);
    }
    dateEntries.push(sleep);
  }

  return byDate;
}

/**
 * Check if a metric type is sleep-related.
 */
export function isSleepMetric(metricType: string): boolean {
  return metricType === (MetricName.SLEEP_ANALYSIS as string);
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
    type: 'sleep',
  };
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
 * Determine if a sleep entry is the main sleep (vs a nap).
 * Data values are already in hours from the mapper.
 */
function isMainSleep(sleep: SleepMetric): boolean {
  const totalSleepHours = sleep.core + sleep.deep + sleep.rem; // Already in hours
  const startHour = new Date(sleep.sleepStart).getHours();

  // Main sleep criteria:
  // 1. Duration >= MIN_MAIN_SLEEP_HOURS (2 hours)
  // 2. Starts in evening (6pm-midnight) OR early morning (midnight-6am)
  const isLongEnough = totalSleepHours >= MIN_MAIN_SLEEP_HOURS;
  const isEveningStart = startHour >= EVENING_START_HOUR || startHour < MORNING_CUTOFF_HOUR;

  return isLongEnough && isEveningStart;
}
