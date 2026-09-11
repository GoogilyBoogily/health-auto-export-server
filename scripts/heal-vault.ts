/**
 * One-off repair pass: collapse readings that the old dedup key let accumulate.
 *
 * The old key was `time|source` over the raw timestamp text, so the same hour re-exported against
 * a different anchor, and the same instant spelled under two UTC offsets, both stored twice. The
 * new key (see `collapseReadings` in the health formatter) resolves them — but only for metric
 * types present in an incoming payload, and only for days the exporter still re-sends. Everything
 * older needs this.
 *
 * It does NOT work by re-saving through the merge. `createHealthFrontmatter` re-keys stored
 * readings inside its per-metric loop, so an empty payload never enters it and collapses nothing
 * (there is a self-check pinning that). This walks the stored keys itself and applies the same
 * `collapseReadings` the write path uses — one implementation, two callers.
 *
 * Dry run by default. Usage:
 *   bun run scripts/heal-vault.ts [vaultPath]            # report only, writes nothing
 *   bun run scripts/heal-vault.ts [vaultPath] --commit   # write
 */
import { readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { LEGACY_OWNED_KEYS, ObsidianConfig } from '../src/config';
import { collapseReadings } from '../src/storage/obsidian/formatters/health';
import { parseMarkdown, serializeMarkdown } from '../src/storage/obsidian/utils/markdownUtilities';
import { MetricName } from '../src/types';
import { snakeToCamelCase } from '../src/utils/stringUtilities';

import type { Reading } from '../src/storage/obsidian/formatters/health';
import type { DailyFrontmatter } from '../src/types';

/**
 * Only files this server writes. `moodEntries`, `habitEntries` and `hourlyData` are reading-shaped
 * arrays belonging to other apps; running them through a health dedup rule would drop any entry
 * without a `time` string.
 */
const OWNED_KEYS = new Set<string>([
  ...Object.values(MetricName).map((name) => snakeToCamelCase(name)),
  ...LEGACY_OWNED_KEYS,
]);

/**
 * Daily notes only. `72 Daily Tracking/` also holds `72.01 The List.md` and a `CLAUDE.md`, neither
 * with frontmatter — a `*.md` walk would rewrite both with an empty daily template.
 */
const DAILY_NOTE = /^\d{4}-\d{2}-\d{2}\.md$/;

/** Reverse of `snakeToCamelCase` for the enum; legacy keys map to themselves. */
const METRIC_TYPE_BY_KEY = new Map<string, string>([
  ...Object.values(MetricName).map((name): [string, string] => [snakeToCamelCase(name), name]),
  ...LEGACY_OWNED_KEYS.map((key): [string, string] => [key, key]),
]);

interface FilePlan {
  after: string;
  perKey: Map<string, number>;
  removed: number;
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
 * The whole decision for one file, and the only place bytes are produced.
 *
 * Dry run and commit both call this, so the report cannot describe something other than what a
 * write would do. Returns undefined when nothing would change.
 */
function planFile(filePath: string): FilePlan | undefined {
  const original = readFileSync(filePath, 'utf8');
  const parsed = parseMarkdown(original);
  if (!parsed.frontmatter) return undefined;

  const frontmatter = parsed.frontmatter as DailyFrontmatter;
  const perKey = new Map<string, number>();
  let removed = 0;

  for (const [key, value] of Object.entries(frontmatter)) {
    if (!OWNED_KEYS.has(key) || !isReadingArray(value)) continue;

    const collapsed = collapseReadings(METRIC_TYPE_BY_KEY.get(key) ?? key, value);
    if (collapsed.length === value.length) continue;

    perKey.set(key, value.length - collapsed.length);
    removed += value.length - collapsed.length;
    frontmatter[key] = collapsed;
  }

  if (removed === 0) return undefined;

  return { after: serializeMarkdown(frontmatter, parsed.body, parsed.document), perKey, removed };
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
  console.error('Usage: bun run scripts/heal-vault.ts [vaultPath] [--commit]');
  process.exit(1);
}

// Today's note is rewritten by another process on its own schedule; a read-modify-write here
// would silently drop whatever it wrote in between.
const todayNote = `${new Date().toISOString().slice(0, 10)}.md`;

const notes = findDailyNotes(vaultPath).filter((file) => path.basename(file) !== todayNote);
console.log(`${commit ? 'HEALING' : 'DRY RUN'} — ${String(notes.length)} daily notes under ${vaultPath}`);
if (!commit) console.log('Nothing will be written. Pass --commit to apply.\n');
else console.log('Writing. Stop the ingest server and quit Obsidian first.\n');

const perKeyTotal = new Map<string, number>();
let filesChanged = 0;
let readingsRemoved = 0;

for (const file of notes) {
  const plan = planFile(file);
  if (!plan) continue;

  filesChanged++;
  readingsRemoved += plan.removed;
  for (const [key, count] of plan.perKey) {
    perKeyTotal.set(key, (perKeyTotal.get(key) ?? 0) + count);
  }

  const detail = [...plan.perKey.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => `${key} -${String(count)}`)
    .join(', ');
  console.log(`  ${path.basename(file)}  -${String(plan.removed).padStart(4)}  ${detail}`);

  // Temp-and-rename, the same way the write path does it. A torn write is how notes end up with
  // two frontmatter blocks in the first place, and Obsidian keeps these files open and rewrites
  // them from its own cache. No lock: nothing else that touches these notes takes one, so a lock
  // here would guard against nothing. The rename is what actually makes a half-written file
  // impossible.
  if (commit) {
    const temporaryPath = `${file}.tmp.${String(process.pid)}`;
    writeFileSync(temporaryPath, plan.after, 'utf8');
    renameSync(temporaryPath, file);
  }
}

console.log(`\n  ${'metric'.padEnd(30)} ${'removed'.padStart(8)}`);
for (const [key, count] of [...perKeyTotal.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${key.padEnd(30)} ${String(count).padStart(8)}`);
}
console.log(
  `\n${commit ? 'Healed' : 'Would heal'} ${String(filesChanged)} files, removing ${String(readingsRemoved)} readings.`,
);
if (!commit) console.log('Re-run with --commit to apply. Back up the affected files first.');
