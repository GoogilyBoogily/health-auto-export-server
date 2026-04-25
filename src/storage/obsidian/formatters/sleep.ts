/**
 * Sleep data formatter.
 * Transforms sleep_analysis metrics into sleep tracking frontmatter.
 */

import { MetricName } from '../../../types';
import { logger } from '../../../utils/logger';
import { formatIsoTimestamp, roundTo } from '../utils/dateUtilities';

import type {
  DailyFrontmatter,
  MetricsByType,
  SleepMetric,
  SleepSegment,
  SleepStage,
  SleepStageEntry,
} from '../../../types';

/**
 * Grouped sleep data for a single night.
 */
export interface SleepDateData {
  sleepMetrics: SleepMetric[];
}

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

  // Legacy aggregated payloads (no per-stage segments) carry totals on the
  // SleepMetric directly — synthesize stage entries spanning the bed window
  // so legacy data still lands in sleepStages instead of being dropped.
  if (allSegments.length === 0) {
    const legacySegments = legacyMetricsToSegments(sleepMetrics);
    if (legacySegments.length === 0) {
      logger.warn('Sleep data without segments or legacy totals — nothing to store', { dateKey });
      return frontmatter;
    }
    populateFromSegments(frontmatter, legacySegments);
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

function isValidSleepStageEntry(entry: unknown): entry is SleepStageEntry {
  if (typeof entry !== 'object' || entry === null) return false;
  const candidate = entry as Partial<SleepStageEntry>;
  return typeof candidate.startTime === 'string' && typeof candidate.stage === 'string';
}

/**
 * Synthesize SleepSegment objects from legacy aggregated SleepMetric totals.
 * Legacy payloads carry `core`/`deep`/`rem`/`awake`/`asleep` durations plus
 * `sleepStart`/`sleepEnd` (and `inBedStart`/`inBedEnd`) but no per-stage
 * segments. We emit one synthesized segment per non-zero stage spanning the
 * sleep window so the data persists in `sleepStages`. Boundaries are coarse
 * (whole sleep window per stage) but the totals survive — better than
 * dropping the entry entirely.
 */
function legacyMetricsToSegments(metrics: SleepMetric[]): SleepSegment[] {
  const segments: SleepSegment[] = [];
  for (const metric of metrics) {
    const start = metric.sleepStart;
    const end = metric.sleepEnd;
    if (
      !(start instanceof Date) ||
      !(end instanceof Date) ||
      Number.isNaN(start.getTime()) ||
      Number.isNaN(end.getTime())
    ) {
      continue;
    }
    const stageDurations: { duration: number; stage: SleepStage }[] = [
      { duration: metric.core, stage: 'core' },
      { duration: metric.deep, stage: 'deep' },
      { duration: metric.rem, stage: 'rem' },
      { duration: metric.awake, stage: 'awake' },
      { duration: metric.asleep ?? 0, stage: 'asleep' },
    ];
    for (const { duration, stage } of stageDurations) {
      if (duration > 0) {
        segments.push({
          duration,
          endTime: end,
          source: metric.source,
          stage,
          startTime: start,
        });
      }
    }
  }
  return segments;
}

/**
 * Populate frontmatter from individual sleep segments.
 * Upserts by same-stage interval overlap so split or partial payloads (multiple
 * pings, retries, edited sessions) preserve previously-stored stages instead of
 * silently dropping them, while Apple Health boundary revisions (same stage,
 * shifted startTime) replace the older entry instead of duplicating it.
 */
function populateFromSegments(frontmatter: DailyFrontmatter, segments: SleepSegment[]): void {
  const newEntries = segments.map((seg): SleepStageEntry => {
    const entry: SleepStageEntry = {
      duration: roundTo(seg.duration, 2),
      endTime: formatIsoTimestamp(seg.rawEndTime ?? seg.endTime) ?? '',
      stage: seg.stage,
      startTime: formatIsoTimestamp(seg.rawStartTime ?? seg.startTime) ?? '',
    };
    if (seg.source) entry.source = seg.source;
    return entry;
  });

  // Defensive: YAML-parsed frontmatter is loosely typed at runtime — guard against
  // user-edited entries that don't match SleepStageEntry shape before keying on them.
  const rawExisting = Array.isArray(frontmatter.sleepStages)
    ? (frontmatter.sleepStages as unknown[])
    : [];
  const existingEntries = rawExisting.filter((entry) => isValidSleepStageEntry(entry));

  // Newer-wins, same-stage overlap merge. Walking existing first then new means
  // any new entry that overlaps a prior same-stage entry replaces it. Also
  // collapses legacy duplicates left by the earlier exact-key dedup.
  const merged: SleepStageEntry[] = [];
  for (const entry of [...existingEntries, ...newEntries]) {
    const overlapIndex = merged.findIndex(
      (kept) => kept.stage === entry.stage && stageEntriesOverlap(kept, entry),
    );
    if (overlapIndex === -1) {
      merged.push(entry);
    } else {
      merged[overlapIndex] = entry;
    }
  }

  frontmatter.sleepStages = merged.toSorted((a, b) => a.startTime.localeCompare(b.startTime));
}

/**
 * True when two sleep stage entries' time intervals overlap.
 * Returns false if either timestamp fails to parse — defensive against
 * malformed entries from earlier writes or manual edits.
 */
function stageEntriesOverlap(a: SleepStageEntry, b: SleepStageEntry): boolean {
  const aStart = Date.parse(a.startTime);
  const aEnd = Date.parse(a.endTime);
  const bStart = Date.parse(b.startTime);
  const bEnd = Date.parse(b.endTime);
  if (Number.isNaN(aStart) || Number.isNaN(aEnd) || Number.isNaN(bStart) || Number.isNaN(bEnd)) {
    return false;
  }
  return aStart < bEnd && bStart < aEnd;
}
