/**
 * Sleep data formatter.
 * Transforms sleep_analysis metrics into Obsidian sleep tracking frontmatter.
 */

import { MetricName } from '../../../types';
import { logger } from '../../../utils/logger';
import { roundTo } from '../utils/dateUtilities';

import type {
  Metric,
  SleepFrontmatter,
  SleepMetric,
  SleepSegment,
  SleepStageEntry,
} from '../../../types';

/**
 * Grouped sleep data for a single night.
 */
export interface SleepDateData {
  sleepMetrics: SleepMetric[];
}

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

  const { sleepMetrics } = sleepData;

  if (sleepMetrics.length === 0) {
    return frontmatter;
  }

  // Collect all segments from all entries
  const allSegments = collectAndSortSegments(sleepMetrics);

  if (allSegments.length === 0) {
    logger.warn('Sleep data without segments — nothing to store', { dateKey });
    return frontmatter;
  }

  populateFromSegments(frontmatter, allSegments);

  return frontmatter;
}

/**
 * Group sleep metrics by wake-up date.
 * Sleep is attributed to the date it ends (when you wake up).
 *
 * Example: Sleep starting 11:30 PM Dec 14, ending 7 AM Dec 15 → assigned to 2024-12-15.md
 */
export function groupSleepMetricsByDate(metricsByType: MetricsByType): Map<string, SleepDateData> {
  const byDate = new Map<string, SleepDateData>();

  // Process sleep analysis metrics
  const sleepData = metricsByType[MetricName.SLEEP_ANALYSIS] as SleepMetric[] | undefined;
  if (sleepData) {
    for (const sleep of sleepData) {
      // Use sourceDate (wake-up date extracted before timezone conversion)
      const dateKey = sleep.sourceDate;
      let dateData = byDate.get(dateKey);
      if (!dateData) {
        dateData = { sleepMetrics: [] };
        byDate.set(dateKey, dateData);
      }
      dateData.sleepMetrics.push(sleep);
    }
  }

  logger.debugLog('TRANSFORM', 'Sleep metrics grouped by wake-up date', {
    dateKeys: [...byDate.keys()],
    datesWithData: byDate.size,
    inputMetricCount: sleepData?.length ?? 0,
  });

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
  };
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

  logger.debugTransform(
    'Sleep segment collection',
    { sleepEntryCount: sleepEntries.length },
    {
      firstSegment: allSegments[0]
        ? {
            stage: allSegments[0].stage,
            startTime: allSegments[0].startTime.toISOString(),
          }
        : undefined,
      totalSegments: allSegments.length,
    },
  );

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
 * Populate frontmatter from individual sleep segments.
 */
function populateFromSegments(frontmatter: SleepFrontmatter, segments: SleepSegment[]): void {
  frontmatter.sleepStages = segments.map((seg): SleepStageEntry => {
    const entry: SleepStageEntry = {
      duration: roundTo(seg.duration, 2),
      endTime: formatIsoTimestamp(seg.endTime),
      stage: seg.stage,
      startTime: formatIsoTimestamp(seg.startTime),
    };
    if (seg.source) entry.source = seg.source;
    return entry;
  });
}
