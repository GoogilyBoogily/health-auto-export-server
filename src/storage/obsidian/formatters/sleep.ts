/**
 * Sleep data formatter.
 * Transforms sleep_analysis metrics into sleep tracking frontmatter.
 */

import { MetricName } from '../../../types';
import { logger } from '../../../utils/logger';
import { formatIsoTimestamp, roundTo } from '../utils/dateUtilities';

import type {
  DailyFrontmatter,
  Metric,
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
 * Merge sleep data into existing frontmatter for a specific date.
 * Combines all sleep sessions into sleepStages.
 * Non-sleep keys in the frontmatter are preserved.
 */
export function createSleepFrontmatter(
  dateKey: string,
  sleepData: SleepDateData,
  existing?: DailyFrontmatter,
): DailyFrontmatter {
  const frontmatter: DailyFrontmatter = existing ?? { date: dateKey };

  frontmatter.date = dateKey;

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
 * Populate frontmatter from individual sleep segments.
 * Replaces all existing sleep stages — sleep data is always sent as a complete snapshot
 * per date, so merging would create duplicates rather than preserve data.
 */
function populateFromSegments(frontmatter: DailyFrontmatter, segments: SleepSegment[]): void {
  frontmatter.sleepStages = segments.map((seg): SleepStageEntry => {
    const entry: SleepStageEntry = {
      duration: roundTo(seg.duration, 2),
      endTime: formatIsoTimestamp(seg.endTime) ?? '',
      stage: seg.stage,
      startTime: formatIsoTimestamp(seg.startTime) ?? '',
    };
    if (seg.source) entry.source = seg.source;
    return entry;
  });
}
