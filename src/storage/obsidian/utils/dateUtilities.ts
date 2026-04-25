/**
 * Date utilities for Obsidian frontmatter.
 */

// TZ-stable: identical input → identical output regardless of server timezone.
// Used as a dedup key, so any drift would create silent duplicates.
//
// Both regexes capture the offset hours/minutes so we can emit the canonical
// `±HH:MM` form from inputs that arrive as either `±HHMM` or `±HH:MM`.
// Fractional seconds are dropped during emit so payloads with vs without
// milliseconds produce identical dedup keys.
const HAE_DATE_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})\s*([+-])(\d{2}):?(\d{2})$/;
const ISO_OFFSET_REGEX = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d+)?([+-])(\d{2}):?(\d{2})$/;
const ISO_UTC_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

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

  // Date input loses the original TZ offset (Date stores only an instant). The
  // mapper preserves the raw string in `rawDate`/`rawStartTime`/`rawEndTime` so
  // this branch is only hit when no raw string is available — fall back to UTC.
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

  // Fallback for Date objects or non-standard string formats
  const d = new Date(date);
  const year = String(d.getFullYear());
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Round a number to specified decimal places.
 */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
