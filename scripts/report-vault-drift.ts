/**
 * Read-only vault diagnostics. Writes nothing, ever.
 *
 * Two reports:
 *   1. Duplicate readings — Health Auto Export re-exports the same samples anchored to a
 *      different minute each sync, so the `time|source` dedup key never collides and every
 *      cumulative daily total is inflated.
 *   2. Misfiled sleep-window readings — wrist temperature and breathing disturbances are stamped
 *      in the evening but describe the night that ends the following morning, so they sit in a
 *      different file from that night's sleepStages.
 *
 * A third report claiming to measure serializer drift used to live here. It compared a document
 * against frontmatter derived from that same document, so `applyOwnedKeys` short-circuited every
 * key and it never executed a single `Document.set` — it printed "0 of 4299 files would change"
 * while the real write path does change files (bare ISO timestamps come back quoted). Measuring
 * nothing and reporting zero is worse than not reporting, so it is gone.
 *
 * Usage: bun run report:vault [vaultPath]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import {
  CUMULATIVE_METRICS,
  EVENT_TOTAL_METRICS,
  HOURLY_BUCKETED_METRICS,
  LEGACY_OWNED_KEYS,
  MetricsConfig,
  ObsidianConfig,
} from '../src/config';
import { nextDateKey } from '../src/storage/obsidian/utils/dateUtilities';
import { parseMarkdown } from '../src/storage/obsidian/utils/markdownUtilities';
import { MetricName } from '../src/types';
import { snakeToCamelCase } from '../src/utils/stringUtilities';

/** Metrics measured during sleep but stamped at bedtime. */
const SLEEP_WINDOW_KEYS = ['appleSleepingWristTemperature', 'breathingDisturbances'];

/**
 * Frontmatter keys this server writes. Everything else in a daily file belongs to another app
 * (weather, moods, habits) and must never be reported on or touched.
 */
const OWNED_KEYS = new Set([
  ...Object.values(MetricName).map((name) => snakeToCamelCase(name)),
  ...LEGACY_OWNED_KEYS,
]);

interface Reading {
  time: string;
  source?: string;
  value?: number;
}

function isReadingArray(value: unknown): value is Reading[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (entry) =>
        typeof entry === 'object' && entry !== null && typeof (entry as Reading).time === 'string',
    )
  );
}

function findDailyFiles(vaultPath: string): string[] {
  const root = path.join(vaultPath, ObsidianConfig.dailyPath);
  const found: string[] = [];

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const full = path.join(directory, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.md')) found.push(full);
    }
  };

  walk(root);
  return found.sort();
}

// ===== Report 1: duplicate readings =====

/** A reading's value, tolerating the handful of string-typed values already in the vault. */
function numericValue(reading: Reading): number {
  return Number(reading.value) || 0;
}

/**
 * Event totals are logged per entry, not per hour — two meals an hour apart are two readings.
 * Only an exact repeat of the same instant and device set is a duplicate.
 */
function dedupeByInstant(readings: Reading[]): Reading[] {
  const byKey = new Map<string, Reading>();
  for (const reading of readings) {
    const key = `${String(Date.parse(reading.time))}|${normalizeSource(reading.source)}`;
    const prior = byKey.get(key);
    if (!prior || numericValue(reading) > numericValue(prior)) byKey.set(key, reading);
  }
  return [...byKey.values()];
}

/** True UTC hour index. Two readings an hour apart share a wall-clock hour when the clocks go
 *  back, and the same instant reported under two offsets does not — only the instant is stable. */
function hourIndex(reading: Reading): number {
  return Math.floor(Date.parse(reading.time) / 3_600_000);
}

/**
 * Rebuild the readings a single export would have produced.
 *
 * Health Auto Export re-exports the same samples anchored to whatever minute the sync ran at, so
 * a day accumulates several complete or partial *generations* of the same hours — 05:00, 06:00,
 * 07:00 from one sync and 05:30, 06:30, 07:30 from the next, describing the same steps.
 *
 * Taking the maximum per hour, which this script used to do, mixes generations: it picks the
 * largest value seen in each hour label across windows that start at different minutes and
 * therefore cover different samples. That inflates "truth" and understates the duplication —
 * on 2026-08-11 it put stepCount at 1.11x when the day is genuinely 1.44x.
 *
 * Instead, group by anchor, prefer the generation covering the most hours, and fill any hours it
 * misses from the next-best generation. Within one (anchor, hour) the larger value wins, which is
 * a ≤0.4% conservative bias — it can only make the reported inflation smaller, never larger.
 */
function reconstructTruth(readings: Reading[]): Reading[] {
  const chosen: Reading[] = [];
  // Reconstruct within one device set at a time. The storage key retains `source`, so readings
  // attributed to different device sets are distinct rows by design; measuring across them would
  // report duplication the vault is never going to collapse (see reportSourceResidual).
  for (const group of groupBy(readings, (r) => normalizeSource(r.source)).values()) {
    const generations = new Map<string, Map<number, Reading>>();
    for (const reading of group) {
      const anchor = reading.time.slice(14, 19); // MM:SS — the export's alignment
      const byHour = generations.get(anchor) ?? new Map<number, Reading>();
      const hour = hourIndex(reading);
      const prior = byHour.get(hour);
      if (!prior || numericValue(reading) > numericValue(prior)) byHour.set(hour, reading);
      generations.set(anchor, byHour);
    }

    const perHour = new Map<number, Reading>();
    for (const generation of [...generations.values()].sort((a, b) => b.size - a.size)) {
      for (const [hour, reading] of generation) {
        if (!perHour.has(hour)) perHour.set(hour, reading);
      }
    }
    chosen.push(...perHour.values());
  }

  return chosen;
}

/** Canonical device-set string — must match `dedupKey`'s normalization in the health formatter. */
function normalizeSource(source: string | undefined): string {
  if (!source) return '';
  const devices = source
    .split('|')
    .map((device) => device.trim())
    .filter(Boolean);
  return [...new Set(devices)].toSorted((a, b) => a.localeCompare(b)).join('|');
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

/**
 * Group a metric's readings by wall-clock hour, ignoring source.
 * Source is deliberately ignored: the duplicates carry identical source strings, so grouping
 * by it would fail to collapse them.
 */
function reportDuplicates(files: string[]): void {
  console.log('\n=== 1. Duplicate readings in cumulative metrics (inflates daily totals) ===\n');

  let totalExtra = 0;
  let filesAffected = 0;
  const perMetric = new Map<string, { extra: number; storedSum: number; truthSum: number }>();
  const discreteSuspects = new Map<string, number>();

  for (const file of files) {
    const { frontmatter } = parseMarkdown(readFileSync(file, 'utf8'));
    if (!frontmatter) continue;
    let fileHasDuplicates = false;

    for (const [key, value] of Object.entries(frontmatter)) {
      if (!OWNED_KEYS.has(key) || !isReadingArray(value)) continue;

      const truth = HOURLY_BUCKETED_METRICS.has(key)
        ? reconstructTruth(value)
        : dedupeByInstant(value);
      const extra = value.length - truth.length;
      if (extra === 0) continue;

      // Discrete metrics legitimately have several readings per hour — count them separately
      // and never claim an inflation figure, because summing them means nothing.
      if (!CUMULATIVE_METRICS.has(key)) {
        discreteSuspects.set(key, (discreteSuspects.get(key) ?? 0) + extra);
        continue;
      }

      const storedSum = value.reduce((sum, r) => sum + numericValue(r), 0);
      const truthSum = truth.reduce((sum, r) => sum + numericValue(r), 0);

      const stats = perMetric.get(key) ?? { extra: 0, storedSum: 0, truthSum: 0 };
      perMetric.set(key, {
        extra: stats.extra + extra,
        storedSum: stats.storedSum + storedSum,
        truthSum: stats.truthSum + truthSum,
      });

      totalExtra += extra;
      fileHasDuplicates = true;
    }

    if (fileHasDuplicates) filesAffected++;
  }

  console.log(
    `  ${'metric'.padEnd(30)} ${'extra'.padStart(6)} ${'stored'.padStart(13)} ${'deduped'.padStart(13)} ${'ratio'.padStart(7)}`,
  );
  for (const [key, s] of [...perMetric.entries()].sort((a, b) => b[1].extra - a[1].extra)) {
    const ratio = s.truthSum > 0 ? `${(s.storedSum / s.truthSum).toFixed(2)}x` : '-';
    console.log(
      `  ${key.padEnd(30)} ${String(s.extra).padStart(6)} ${s.storedSum.toFixed(1).padStart(13)} ${s.truthSum.toFixed(1).padStart(13)} ${ratio.padStart(7)}`,
    );
  }
  console.log(
    `\n  ${String(totalExtra)} duplicate readings in cumulative metrics, across ${String(filesAffected)} of ${String(files.length)} files.`,
  );

  console.log(
    '\n  --- discrete metrics with multiple readings per hour (NOT summable, review only) ---',
  );
  for (const [key, extra] of [...discreteSuspects.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${key.padEnd(30)} ${String(extra).padStart(6)}`);
  }
  console.log('  Several genuine spot readings per hour are normal for these — not duplicates.');
}

// ===== Report 1a: the residual retained by design =====

/**
 * Same hour, same metric, different device set.
 *
 * The storage key keeps `source`, so these are separate rows on purpose — attribution is
 * preserved. But they describe one hour of one metric, so anything that sums them over-counts.
 * Report 1 cannot see them (it reconstructs within a device set), and that silence would be the
 * bad kind: a decision whose cost stops being visible the moment it is taken.
 */
function reportSourceResidual(files: string[]): void {
  console.log('\n=== 1a. Same-hour readings differing only by device set (retained by design) ===\n');

  const perMetric = new Map<string, { extra: number; files: Set<string>; overCount: number }>();

  for (const file of files) {
    const { frontmatter } = parseMarkdown(readFileSync(file, 'utf8'));
    if (!frontmatter) continue;

    for (const [key, value] of Object.entries(frontmatter)) {
      if (!HOURLY_BUCKETED_METRICS.has(key) || !isReadingArray(value)) continue;

      for (const group of groupBy(value, (r) => String(hourIndex(r))).values()) {
        const distinctSources = new Set(group.map((r) => normalizeSource(r.source)));
        if (distinctSources.size < 2) continue;

        const largest = Math.max(...group.map((r) => numericValue(r)));
        const summed = group.reduce((total, r) => total + numericValue(r), 0);

        const stats = perMetric.get(key) ?? { extra: 0, files: new Set<string>(), overCount: 0 };
        stats.extra += distinctSources.size - 1;
        stats.files.add(file);
        stats.overCount += summed - largest;
        perMetric.set(key, stats);
      }
    }
  }

  if (perMetric.size === 0) {
    console.log('  None.');
    return;
  }

  console.log(
    `  ${'metric'.padEnd(30)} ${'extra'.padStart(6)} ${'files'.padStart(6)} ${'over-count if summed'.padStart(21)}`,
  );
  let totalExtra = 0;
  const allFiles = new Set<string>();
  for (const [key, stats] of [...perMetric.entries()].sort((a, b) => b[1].extra - a[1].extra)) {
    totalExtra += stats.extra;
    for (const file of stats.files) allFiles.add(file);
    console.log(
      `  ${key.padEnd(30)} ${String(stats.extra).padStart(6)} ${String(stats.files.size).padStart(6)} ${stats.overCount.toFixed(1).padStart(21)}`,
    );
  }
  console.log(
    `\n  ${String(totalExtra)} readings across ${String(allFiles.size)} files. These are kept on purpose:`,
  );
  console.log('  the dedup key retains `source`, so a device set is part of a reading\'s identity.');
  console.log('  Any consumer that sums them is over-counting by the amount above.');
}

// ===== Report 1b: notes with a second frontmatter block =====

/**
 * Daily notes carrying more than the two `---` fences a note should have.
 *
 * `parseMarkdown`'s regex is non-greedy, so it takes block 1 and hands everything after it back as
 * *body*, which the storage layer then preserves byte-for-byte. A second block of real readings
 * therefore sits in the file, invisible to this server, to this report, and to every consumer.
 * Detecting it is the point: it is the one failure mode that looks like nothing at all.
 */
function reportFusedFrontmatter(files: string[]): void {
  console.log('\n=== 1b. Notes with a second frontmatter block (data invisible to every consumer) ===\n');

  let affected = 0;
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    const fences = lines.filter((line) => line === '---').length;
    if (fences <= 2) continue;

    affected++;
    const secondBlockStart = lines.indexOf('---', lines.indexOf('---', 1) + 1);
    const trapped = lines.slice(secondBlockStart).filter((line) => line.startsWith('  - time:')).length;
    console.log(
      `  ${path.basename(file).padEnd(16)} ${String(fences)} fences, ~${String(trapped)} readings past the first block`,
    );
  }

  console.log(
    affected === 0
      ? '  None.'
      : `\n  ${String(affected)} notes. Run \`bun run scripts/repair-fused-frontmatter.ts\` to inspect and merge.`,
  );
}

// ===== Report 2: misfiled sleep-window readings =====

function reportMisfiledSleepMetrics(files: string[]): void {
  console.log('\n=== 2. Sleep-window readings filed to the bedtime day ===\n');

  let count = 0;
  for (const file of files) {
    const { frontmatter } = parseMarkdown(readFileSync(file, 'utf8'));
    if (!frontmatter) continue;

    const fileDate = path.basename(file, '.md');

    for (const key of SLEEP_WINDOW_KEYS) {
      const value = frontmatter[key];
      if (!isReadingArray(value)) continue;

      for (const reading of value) {
        // Same cutoff the mapper uses, read from config rather than copied — a local constant
        // would keep reporting readings the server has stopped moving.
        const hour = Number.parseInt(reading.time.slice(11, 13), 10);
        if (hour < MetricsConfig.sleepWindowCutoffHour) continue;

        const target = nextDateKey(reading.time.slice(0, 10));
        // Already where it belongs. Without this the report never converges to zero: after the
        // fix lands, a reading stamped 22:00 and correctly filed on the next day still matches
        // the hour test and would be reported as needing the move it has already had.
        if (target === fileDate) continue;

        count++;
        console.log(
          `  ${path.basename(file).padEnd(16)} ${key.padEnd(32)} ${reading.time}  →  ${target}.md`,
        );
      }
    }
  }

  console.log(`\n  ${String(count)} readings would move to the following day's file.`);
}

const vaultPath = process.argv[2] ?? process.env.OBSIDIAN_VAULT_PATH;
if (!vaultPath) {
  console.error('Usage: bun run report:vault [vaultPath]   (or set OBSIDIAN_VAULT_PATH)');
  process.exit(1);
}

const dailyFiles = findDailyFiles(vaultPath);
console.log(`Scanning ${String(dailyFiles.length)} daily files under ${vaultPath}`);
console.log('This script is read-only and writes nothing.');

reportDuplicates(dailyFiles);
reportSourceResidual(dailyFiles);
reportFusedFrontmatter(dailyFiles);
reportMisfiledSleepMetrics(dailyFiles);
