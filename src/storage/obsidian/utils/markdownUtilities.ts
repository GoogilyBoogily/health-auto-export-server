/**
 * Utilities for reading and writing Markdown files with YAML frontmatter.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { Document, parseDocument, Scalar } from 'yaml';

import { ObsidianConfig } from '../../../config';
import { logger } from '../../../utils/logger';
import { getDateKey } from './dateUtilities';

import type { DailyFrontmatter } from '../../../types';

/**
 * A parsed daily file.
 *
 * `document` carries the original YAML syntax tree. Keeping it lets writes replace only the
 * keys this server owns, so foreign keys written by other apps (weather, mood, habits) keep
 * their exact formatting — bare ISO timestamps stay bare, empty scalars stay empty, and
 * comments survive. Absent when the file had no frontmatter block to begin with.
 */
export interface ParsedMarkdown {
  body: string;
  document: Document | undefined;
  frontmatter: DailyFrontmatter | undefined;
}

const YAML_STRINGIFY_OPTIONS = {
  doubleQuotedAsJSON: false,
  indent: 2,
  lineWidth: 0, // Disable line wrapping
  singleQuote: false,
} as const;

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
const LEADING_BOM_REGEX = /^\uFEFF/;
const LEADING_BLANK_LINES_REGEX = /^\s*\n/;

/**
 * Get the file path for a daily tracking file.
 * When date is a YYYY-MM-DD string (dateKey), it's parsed directly to avoid
 * timezone issues with `new Date()` interpreting it as midnight UTC.
 */
export function getDailyFilePath(vaultPath: string, date: Date | string): string {
  let year: number;
  let month: string;
  let dateKey: string;

  // If it's already a YYYY-MM-DD string, parse it directly
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [y, m] = date.split('-');
    year = Number.parseInt(y, 10);
    month = m;
    dateKey = date;
  } else {
    // For Date objects or ISO strings with time, use UTC methods
    // to ensure consistent file paths regardless of server timezone
    const d = new Date(date);
    year = d.getUTCFullYear();
    month = String(d.getUTCMonth() + 1).padStart(2, '0');
    dateKey = getDateKey(d);
  }

  return path.join(vaultPath, ObsidianConfig.dailyPath, String(year), month, `${dateKey}.md`);
}

/**
 * Get the default body template for a daily tracking file.
 */
export function getDefaultBody(date: Date | string): string {
  const dateKey = getDateKey(date);
  return ObsidianConfig.bodyTemplate.replaceAll('{{date}}', dateKey);
}

/**
 * Recursively list all `.md` files under a directory.
 * Returns empty array if the directory does not exist.
 */
export async function listMarkdownFiles(directory: string): Promise<string[]> {
  const out: string[] = [];
  const stack: string[] = [directory];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        out.push(full);
      }
    }
  }

  return out;
}

/**
 * Parse a markdown file with YAML frontmatter.
 * Returns frontmatter object and body content.
 *
 * A file with no frontmatter block at all is a genuine new-file case and returns undefined.
 * A file whose frontmatter block exists but does not parse THROWS: continuing would overwrite
 * the unreadable data with a fresh minimal frontmatter, which is the loudest possible way to
 * lose a day of metrics. A file we cannot read is not a file we may replace.
 */
export function parseMarkdown(content: string): ParsedMarkdown {
  const match = FRONTMATTER_REGEX.exec(normalizeForFrontmatter(content));
  if (!match) {
    return { body: content, document: undefined, frontmatter: undefined };
  }

  // parseDocument collects errors instead of throwing, so check them explicitly.
  const document = parseDocument(match[1]);
  if (document.errors.length > 0) {
    throw new Error(document.errors.map((error) => error.message).join('; '));
  }

  return { body: match[2], document, frontmatter: document.toJS() as DailyFrontmatter };
}

/**
 * Read a markdown file with frontmatter.
 * Returns undefined if file doesn't exist.
 *
 * Unparseable frontmatter is backed up alongside the file and then rethrown. The backup keeps the
 * bytes recoverable; the throw keeps this server from replacing a day of metrics it could not
 * read. Doing only the first would reset the live note to fresh frontmatter, and doing only the
 * second would leave no copy of whatever damaged it.
 */
export async function readMarkdownFile(filePath: string): Promise<ParsedMarkdown | undefined> {
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }

  try {
    return parseMarkdown(content);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error';
    await backupCorruptFile(filePath, content);
    logger.error('Unreadable frontmatter — refusing to overwrite', error, { filePath });
    throw new Error(`Unreadable YAML frontmatter in ${filePath}: ${detail}`);
  }
}

/**
 * Decide the body to write: preserve what is there, or seed the template.
 *
 * Three cases, and the middle one is a bug fix. A file created by another app — the weather
 * writer gets there first on most days — has frontmatter and no body. `serializeMarkdown` then
 * normalises that empty body to `'\n'`, which is a stable fixed point.
 *
 * `'\n'` is both non-nullish and TRUTHY, so `existing?.body ?? …` and `existing?.body || …` BOTH
 * preserve it forever and the template never applies again. Only a `.trim()` test sees it.
 * Do not "simplify" this to `||`.
 *
 * The backfill window bounds the repair: a full-history re-export must not retro-fill the
 * template into hundreds of notes that have been legitimately empty for years. A brand-new file
 * is always templated regardless of age — otherwise backfilling old data would create notes with
 * no body at all.
 */
export function resolveBody(dateKey: string, existingBody: string | undefined): string {
  if (existingBody === undefined) return getDefaultBody(dateKey);
  if (existingBody.trim()) return existingBody;
  return isWithinTemplateBackfillWindow(dateKey) ? getDefaultBody(dateKey) : existingBody;
}

/**
 * Is this date recent enough to seed an empty note with the body template?
 *
 * UTC arithmetic, matching `nextDateKey`, so the answer never depends on the server's timezone.
 */
function isWithinTemplateBackfillWindow(dateKey: string): boolean {
  const [year, month, day] = dateKey.split('-').map(Number);
  const noteDay = Date.UTC(year, month - 1, day);

  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

  const daysAgo = (today - noteDay) / 86_400_000;
  return daysAgo <= ObsidianConfig.templateBackfillDays;
}

/**
 * ISO 8601 timestamp pattern with timezone offset (e.g., 2026-01-10T04:40:59-06:00)
 * The colon in the timezone offset can cause YAML parsing issues if not quoted.
 */
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;

/**
 * Serialize frontmatter and body to markdown string.
 * Ensures the output always ends with a newline.
 */
export function serializeMarkdown(
  frontmatter: DailyFrontmatter,
  body: string,
  document?: Document,
): string {
  // Reuse the original document when there is one so untouched keys keep their exact
  // formatting; otherwise build a fresh one for a brand-new file.
  const target = document ?? new Document({});
  applyOwnedKeys(target, frontmatter);

  const yamlContent = target.toString(YAML_STRINGIFY_OPTIONS);

  // Ensure body ends with a newline
  const normalizedBody = body.endsWith('\n') ? body : `${body}\n`;

  return `---\n${yamlContent}---\n${normalizedBody}`;
}

/**
 * Write a markdown file with frontmatter atomically.
 */
export async function writeMarkdownFile(
  filePath: string,
  frontmatter: DailyFrontmatter,
  body: string,
  document?: Document,
): Promise<void> {
  // Ensure directory exists
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  // Write atomically using temp file + rename
  // eslint-disable-next-line sonarjs/pseudo-random -- Not security-critical
  const temporaryPath = `${filePath}.tmp.${String(Date.now())}.${Math.random().toString(36).slice(2)}`;
  const content = serializeMarkdown(frontmatter, body, document);

  try {
    await fs.writeFile(temporaryPath, content, 'utf8');
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    // Clean up temp file on failure
    try {
      await fs.unlink(temporaryPath);
    } catch {
      // Ignore cleanup errors - file may not exist
    }
    throw error;
  }
}

/**
 * Write back only the keys this server owns.
 *
 * A key counts as owned when the formatters produced a value that differs from what the file
 * already held. Untouched keys are never re-serialized, so a foreign app's bare ISO timestamps,
 * empty scalars and comments survive verbatim instead of being normalized on every ingest.
 */
function applyOwnedKeys(document: Document, frontmatter: DailyFrontmatter): void {
  const existing = (document.toJS() as Record<string, unknown> | null) ?? {};

  for (const [key, value] of Object.entries(frontmatter)) {
    if (JSON.stringify(existing[key]) === JSON.stringify(value)) continue;
    document.set(key, prepareForYaml(value));
  }
}

/**
 * Save a backup of a file whose YAML frontmatter could not be parsed, so the bytes stay
 * recoverable even though this server refuses to rewrite the file.
 * Backup name: `<filePath>.corrupt.<timestamp>.bak`. Idempotent on the
 * same millisecond — failures here are logged but never thrown.
 */
async function backupCorruptFile(filePath: string, content: string): Promise<void> {
  const backupPath = `${filePath}.corrupt.${String(Date.now())}.bak`;
  try {
    await fs.writeFile(backupPath, content, { encoding: 'utf8', flag: 'wx' });
    logger.warn('Backed up file with unparseable frontmatter', { backupPath, filePath });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return;
    logger.error('Failed to back up corrupt frontmatter file', error, { backupPath, filePath });
  }
}

/**
 * Normalize a file's leading bytes so frontmatter detection survives editors and sync
 * clients that write a BOM, CRLF line endings, or a blank line before the opening `---`.
 *
 * Without this, one stray byte makes the whole file parse as body text and the next write
 * starts from empty frontmatter, silently demoting every metric already stored for that day.
 */
function normalizeForFrontmatter(content: string): string {
  return content
    .replace(LEADING_BOM_REGEX, '')
    .replaceAll('\r\n', '\n')
    .replace(LEADING_BLANK_LINES_REGEX, '');
}

/**
 * Recursively prepare an object for YAML serialization by wrapping ISO timestamps
 * in Scalar objects with QUOTE_DOUBLE type to ensure proper quoting.
 */
function prepareForYaml(value: unknown): unknown {
  if (typeof value === 'string' && ISO_TIMESTAMP_PATTERN.test(value)) {
    const scalar = new Scalar(value);
    scalar.type = Scalar.QUOTE_DOUBLE;
    return scalar;
  }

  if (Array.isArray(value)) {
    return value.map((item) => prepareForYaml(item));
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value_] of Object.entries(value)) {
      result[key] = prepareForYaml(value_);
    }
    return result;
  }

  return value;
}
