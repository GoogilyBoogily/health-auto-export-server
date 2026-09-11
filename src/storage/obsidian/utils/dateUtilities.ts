/**
 * Date utilities for Obsidian frontmatter.
 */

import { logger } from '../../../utils/logger';

// TZ-stable: identical input → identical output regardless of server timezone.
// Used as a dedup key, so any drift would create silent duplicates.
const HAE_DATE_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})\s*([+-])(\d{2}):?(\d{2})$/;
// Captures the offset so the canonical `±HH:MM` form is emitted whether the input arrived as
// `±HHMM` or `±HH:MM`. Fractional seconds are dropped on emit, so one instant spelled with and
// without milliseconds produces one dedup key.
const ISO_OFFSET_REGEX = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?([+-])(\d{2}):?(\d{2})$/;
const ISO_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
// Capture groups mirror HAE_DATE_REGEX so both share group 4 = hour.
const ISO_LOCAL_HOUR_REGEX = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/;

export function formatIsoTimestamp(date: Date | string | undefined): string | undefined {
  if (!date) return undefined;

  if (typeof date === 'string') {
    const trimmed = date.trim();

    const hae = HAE_DATE_REGEX.exec(trimmed);
    if (hae) {
      const [, y, mo, d, h, mi, s, sign, oh, om] = hae;
      return `${y}-${mo}-${d}T${h}:${mi}:${s}${sign}${oh}:${om}`;
    }

    const iso = ISO_OFFSET_REGEX.exec(trimmed);
    if (iso) {
      const [, datetime, sign, oh, om] = iso;
      return `${datetime}${sign}${oh}:${om}`;
    }

    if (ISO_UTC_REGEX.test(trimmed)) {
      return trimmed.replace(/\.\d+Z$/, 'Z');
    }
  }

  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return undefined;

  return d.toISOString().replace(/\.\d+Z$/, 'Z');
}

/**
 * Extract the date as YYYY-MM-DD string from a date string or Date object.
 *
 * For strings (e.g., "2026-02-02 08:00:00 -0600"), extracts the date portion directly,
 * preserving the user's intended local date without timezone conversion.
 *
 * For Date objects, falls back to server local timezone extraction.
 */
export function getDateKey(date: Date | string): string {
  if (typeof date === 'string') {
    // Extract date portion directly from the string to preserve user's local date
    // Format: "YYYY-MM-DD HH:MM:SS ±HHMM" or ISO format "YYYY-MM-DDTHH:MM:SS..."
    const dateMatch = /^(\d{4}-\d{2}-\d{2})/.exec(date);
    if (dateMatch) {
      return dateMatch[1];
    }
  }

  // Fallback: no embedded local date to read, so the server's own timezone decides the day.
  // That makes the answer depend on where the process runs — the same instant resolves to a
  // different file under UTC than under America/Chicago. Real Health Auto Export payloads
  // never reach here; anything that does is worth knowing about.
  const d = new Date(date);
  const year = String(d.getFullYear());
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const dateKey = `${year}-${month}-${day}`;

  logger.warn('Date key derived from server timezone, not the payload', {
    dateKey,
    input: typeof date === 'string' ? date : d.toISOString(),
    serverTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });

  return dateKey;
}

/**
 * Read the local hour from a raw Health Auto Export timestamp.
 *
 * Reads the digits straight out of the string rather than constructing a `Date`, so the answer
 * is the hour the user experienced, not the hour in the server's timezone. Returns undefined
 * for anything that isn't the expected format, so callers can fall back deliberately.
 */
export function getLocalHour(date: Date | string): number | undefined {
  if (typeof date !== 'string') return undefined;

  const match = HAE_DATE_REGEX.exec(date.trim()) ?? ISO_LOCAL_HOUR_REGEX.exec(date.trim());
  if (!match) return undefined;

  const hour = Number(match[4]);
  return Number.isNaN(hour) ? undefined : hour;
}

/**
 * Advance a YYYY-MM-DD date key by one day.
 * Uses UTC arithmetic so the result never depends on the server's timezone.
 */
export function nextDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}

/**
 * Round a number to specified decimal places.
 */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
