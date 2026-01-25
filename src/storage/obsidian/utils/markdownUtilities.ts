/**
 * Utilities for reading and writing Markdown files with YAML frontmatter.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { parse as parseYaml, Scalar, stringify as stringifyYaml } from 'yaml';

import { logger } from '../../../utils/logger';
import { TRACKING_BODY_TEMPLATES, TRACKING_PATHS } from '../constants';
import { getDateKey } from './dateUtilities';

import type { MarkdownFile, ObsidianFrontmatter, TrackingType } from '../../../types';

const FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

/**
 * Get the default body template for a tracking type.
 */
export function getDefaultBody(trackingType: TrackingType, date: Date | string): string {
  const dateKey = getDateKey(date);
  return TRACKING_BODY_TEMPLATES[trackingType].replace('{{date}}', dateKey);
}

/**
 * Get the file path for a tracking file.
 * When date is a YYYY-MM-DD string (dateKey), it's parsed directly to avoid
 * timezone issues with `new Date()` interpreting it as midnight UTC.
 */
export function getTrackingFilePath(
  vaultPath: string,
  trackingType: TrackingType,
  date: Date | string,
): string {
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

  return path.join(vaultPath, TRACKING_PATHS[trackingType], String(year), month, `${dateKey}.md`);
}

/**
 * Parse a markdown file with YAML frontmatter.
 * Returns frontmatter object and body content.
 */
export function parseMarkdown(content: string): {
  body: string;
  frontmatter: ObsidianFrontmatter | undefined;
} {
  const match = FRONTMATTER_REGEX.exec(content);
  if (!match) {
    return { body: content, frontmatter: undefined };
  }

  try {
    const frontmatter = parseYaml(match[1]) as ObsidianFrontmatter;
    return { body: match[2], frontmatter };
  } catch (error) {
    logger.warn('Failed to parse YAML frontmatter, treating as plain markdown', { error });
    return { body: content, frontmatter: undefined };
  }
}

/**
 * Read a markdown file with frontmatter.
 * Returns undefined if file doesn't exist.
 */
export async function readMarkdownFile(
  filePath: string,
): Promise<undefined | { body: string; frontmatter: ObsidianFrontmatter | undefined }> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return parseMarkdown(content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

/**
 * Read or create a markdown file.
 * Returns existing file contents or creates new file with default structure.
 */
export async function readOrCreateMarkdownFile(
  filePath: string,
  defaultFrontmatter: ObsidianFrontmatter,
  trackingType: TrackingType,
  date: Date | string,
): Promise<MarkdownFile> {
  const existing = await readMarkdownFile(filePath);

  if (existing?.frontmatter) {
    return {
      body: existing.body,
      frontmatter: existing.frontmatter,
    };
  }

  return {
    body: getDefaultBody(trackingType, date),
    frontmatter: defaultFrontmatter,
  };
}

/**
 * ISO 8601 timestamp pattern with timezone offset (e.g., 2026-01-10T04:40:59-06:00)
 * The colon in the timezone offset can cause YAML parsing issues if not quoted.
 */
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;

/**
 * Serialize frontmatter and body to markdown string.
 */
export function serializeMarkdown(frontmatter: ObsidianFrontmatter, body: string): string {
  // Prepare frontmatter to ensure ISO timestamps are double-quoted
  const preparedFrontmatter = prepareForYaml(frontmatter);

  // Custom YAML options for consistent formatting
  const yamlContent = stringifyYaml(preparedFrontmatter, {
    doubleQuotedAsJSON: false,
    indent: 2,
    lineWidth: 0, // Disable line wrapping
    singleQuote: false,
  });

  return `---\n${yamlContent}---\n${body}`;
}

/**
 * Write a markdown file with frontmatter atomically.
 */
export async function writeMarkdownFile(
  filePath: string,
  frontmatter: ObsidianFrontmatter,
  body: string,
): Promise<void> {
  // Ensure directory exists
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  // Write atomically using temp file + rename
  // eslint-disable-next-line sonarjs/pseudo-random -- Not security-critical
  const temporaryPath = `${filePath}.tmp.${String(Date.now())}.${Math.random().toString(36).slice(2)}`;
  const content = serializeMarkdown(frontmatter, body);

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
