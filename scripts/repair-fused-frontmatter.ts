/**
 * Merge a second frontmatter block back into the first.
 *
 * Some daily notes carry more than the two `---` fences a note should have. `parseMarkdown`'s
 * regex is non-greedy, so it takes block 1 and hands everything after it back as *body*, which the
 * storage layer preserves byte-for-byte. A whole second block of real readings therefore sits in
 * the file, invisible to this server, to `bun report:vault`, and to every downstream consumer.
 *
 * Five of the nine affected notes have a block 2 that is itself damaged — `Nested mappings are not
 * allowed in compact mappings`, the same spliced-line corruption behind the `*.md.corrupt.*.bak`
 * files. Those are reported and left alone. Guessing at a half-written mapping is how you turn an
 * invisible problem into a wrong one.
 *
 * Dry run by default. Usage:
 *   bun run scripts/repair-fused-frontmatter.ts [vaultPath]
 *   bun run scripts/repair-fused-frontmatter.ts [vaultPath] --commit
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { parseDocument } from 'yaml';

import { LEGACY_OWNED_KEYS, ObsidianConfig } from '../src/config';
import { collapseReadings } from '../src/storage/obsidian/formatters/health';
import { serializeMarkdown } from '../src/storage/obsidian/utils/markdownUtilities';
import { MetricName } from '../src/types';
import { snakeToCamelCase } from '../src/utils/stringUtilities';

import type { Reading } from '../src/storage/obsidian/formatters/health';
import type { DailyFrontmatter } from '../src/types';

const DAILY_NOTE = /^\d{4}-\d{2}-\d{2}\.md$/;

/**
 * DISABLED FOR WRITES. Two independent audits found this script destroys data, and it did:
 * run once against the live vault on 2026-09-11, it silently discarded 18 and 29 sleep stages,
 * 3 workouts with 145 per-minute heart-rate samples, a habit entry, and 24-48 hours of weather.
 * All of it was restored from backup.
 *
 * The faults are structural, not cosmetic:
 *   - `OWNED_KEYS` misses `sleepStages`, `workoutEntries`, `habitEntries`, `hourlyData` and
 *     `moodEntries` (`sleep_analysis` camel-cases to `sleepAnalysis`), so every one of them takes
 *     the "block 1 wins, block 2 discarded" branch — and a discard is never reported.
 *   - `splitBlocks` assumes fences pair as (0,1) then (2,3). A note with three fences — an
 *     ordinary Markdown horizontal rule in the body — has its body deleted and its frontmatter
 *     filled with single-character keys.
 *   - `planFile` commits a partial merge and swallows the error when a later block is damaged,
 *     leaving the note in the three-fence state the previous point destroys.
 *   - `collapseReadings` runs over block 1's own readings as a side effect of merging, so the
 *     report shows gains while the file shrinks by 70%.
 *   - Writes are a bare `writeFileSync` — no temp-and-rename, no lock — while Obsidian is running.
 *
 * Dry run still works and is still the way to find fused notes. Re-enable only after the merge is
 * rewritten to pair fences explicitly, refuse odd fence counts, merge foreign arrays by identity,
 * report every discard, and leave historical de-duplication to `heal-vault.ts`.
 */
const WRITES_DISABLED = true;


const OWNED_KEYS = new Set<string>([
  ...Object.values(MetricName).map((name) => snakeToCamelCase(name)),
  ...LEGACY_OWNED_KEYS,
]);

const METRIC_TYPE_BY_KEY = new Map<string, string>([
  ...Object.values(MetricName).map((name): [string, string] => [snakeToCamelCase(name), name]),
  ...LEGACY_OWNED_KEYS.map((key): [string, string] => [key, key]),
]);

interface Blocks {
  body: string;
  firstRaw: string;
  secondRaw: string;
}

interface RepairPlan {
  after: string;
  recovered: Map<string, number>;
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

/**
 * Split a fused note into its first block, its second block, and whatever follows.
 * Returns undefined for a normal two-fence note.
 */
function splitBlocks(content: string): Blocks | undefined {
  const lines = content.split('\n');
  const fences = lines.reduce<number[]>((found, line, index) => {
    if (line === '---') found.push(index);
    return found;
  }, []);
  if (fences.length <= 2 || fences[0] !== 0) return undefined;

  return {
    body: lines.slice((fences[3] ?? lines.length - 1) + 1).join('\n'),
    firstRaw: lines.slice(1, fences[1]).join('\n'),
    secondRaw: lines.slice(fences[2] + 1, fences[3] ?? lines.length).join('\n'),
  };
}

/**
 * Fold block 2 into block 1.
 *
 * Owned reading arrays are concatenated and passed through the same `collapseReadings` the write
 * path uses, so recovering these readings cannot reintroduce the duplication the dedup key exists
 * to prevent. A key present only in block 2 is carried over as-is; a foreign key present in both
 * keeps block 1's copy, because block 1 is what every consumer has been reading.
 */
function mergeBlocks(first: DailyFrontmatter, second: DailyFrontmatter): Map<string, number> {
  const recovered = new Map<string, number>();

  for (const [key, secondValue] of Object.entries(second)) {
    const firstValue = first[key];

    if (OWNED_KEYS.has(key) && isReadingArray(secondValue)) {
      const existing = isReadingArray(firstValue) ? firstValue : [];
      const before = existing.length;
      const merged = collapseReadings(METRIC_TYPE_BY_KEY.get(key) ?? key, [
        ...existing,
        ...secondValue,
      ]);
      first[key] = merged;
      if (merged.length > before) recovered.set(key, merged.length - before);
      continue;
    }

    if (firstValue === undefined) {
      first[key] = secondValue;
      recovered.set(key, 0);
    }
  }

  return recovered;
}

/**
 * The whole decision for one file, and the only place bytes are produced.
 *
 * Folds repeatedly: a note can carry more than one stray block, and merging the first leaves the
 * next one still sitting in the body. Looping here means one `--commit` finishes the file rather
 * than leaving it half-repaired for a second run nobody remembers to do.
 */
function planFile(filePath: string): RepairPlan | string | undefined {
  let content = readFileSync(filePath, 'utf8');
  const recovered = new Map<string, number>();
  let merges = 0;

  for (;;) {
    const step = planOnce(content);
    if (step === undefined) break;
    if (typeof step === 'string') return merges > 0 ? { after: content, recovered } : step;
    content = step.after;
    merges++;
    for (const [key, count] of step.recovered) {
      recovered.set(key, (recovered.get(key) ?? 0) + count);
    }
  }

  return merges > 0 ? { after: content, recovered } : undefined;
}

/** One fold: merge the first stray block back into the first block. */
function planOnce(content: string): RepairPlan | string | undefined {
  const blocks = splitBlocks(content);
  if (!blocks) return undefined;

  const firstDoc = parseDocument(blocks.firstRaw, { uniqueKeys: false });
  const secondDoc = parseDocument(blocks.secondRaw, { uniqueKeys: false });

  if (firstDoc.errors.length > 0) return `block 1 unparseable: ${firstDoc.errors[0].message}`;
  if (secondDoc.errors.length > 0) return `block 2 unparseable: ${secondDoc.errors[0].message}`;

  const first = firstDoc.toJS() as DailyFrontmatter;
  const second = secondDoc.toJS() as DailyFrontmatter;
  if (!first || !second) return 'a block is empty';

  const recovered = mergeBlocks(first, second);
  return { after: serializeMarkdown(first, blocks.body), recovered };
}

function findDailyNotes(vaultPath: string): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const full = path.join(directory, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (DAILY_NOTE.test(entry)) found.push(full);
    }
  };
  walk(path.join(vaultPath, ObsidianConfig.dailyPath));
  return found.sort();
}

const vaultPath = process.argv[2] ?? process.env.OBSIDIAN_VAULT_PATH;
const commit = process.argv.includes('--commit');
if (!vaultPath) {
  console.error('Usage: bun run scripts/repair-fused-frontmatter.ts [vaultPath] [--commit]');
  process.exit(1);
}

const todayNote = `${new Date().toISOString().slice(0, 10)}.md`;
const notes = findDailyNotes(vaultPath).filter((file) => path.basename(file) !== todayNote);

if (commit && WRITES_DISABLED) {
  console.error('--commit is disabled: this merge is known to discard data. See the note at the');
  console.error('top of this file. Dry run still works and still finds fused notes.');
  process.exit(1);
}

console.log(`${commit ? 'REPAIRING' : 'DRY RUN'} — scanning ${String(notes.length)} daily notes`);
if (!commit) console.log('Nothing will be written. Pass --commit to apply.\n');
else console.log('Writing. Stop the ingest server and quit Obsidian first.\n');

let repaired = 0;
let skipped = 0;

for (const file of notes) {
  const plan = planFile(file);
  if (plan === undefined) continue;

  if (typeof plan === 'string') {
    skipped++;
    console.log(`  SKIP  ${path.basename(file)}  ${plan}`);
    continue;
  }

  repaired++;
  const detail = [...plan.recovered.entries()]
    .map(([key, count]) => (count > 0 ? `${key} +${String(count)}` : `${key} (carried)`))
    .join(', ');
  console.log(`  MERGE ${path.basename(file)}  ${detail || 'no new readings'}`);

  if (commit) writeFileSync(file, plan.after, 'utf8');
}

console.log(
  `\n${commit ? 'Repaired' : 'Would repair'} ${String(repaired)} notes; ${String(skipped)} skipped as unparseable.`,
);
if (skipped > 0) {
  console.log('Skipped notes need the damaged line fixed by hand before they can be merged.');
}
