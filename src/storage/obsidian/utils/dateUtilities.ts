/**
 * Date utilities for Obsidian frontmatter.
 */

/**
 * Format a Date as ISO 8601 timestamp with timezone offset.
 * Output format: "2026-01-26T06:33:44-06:00"
 * Returns undefined for invalid dates.
 */
export function formatIsoTimestamp(date: Date | string | undefined): string | undefined {
  if (!date) return undefined;

  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return undefined;

  // Get timezone offset in minutes and convert to hours:minutes format
  const offsetMinutes = d.getTimezoneOffset();
  const offsetSign = offsetMinutes <= 0 ? '+' : '-';
  const offsetHours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0');
  const offsetMins = String(Math.abs(offsetMinutes) % 60).padStart(2, '0');
  const tzOffset = `${offsetSign}${offsetHours}:${offsetMins}`;

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');

  return `${String(year)}-${month}-${day}T${hours}:${minutes}:${seconds}${tzOffset}`;
}

/**
 * Format a Date as HH:MM time string (local time).
 * Returns undefined for invalid dates instead of "NaN:NaN".
 */
export function formatTime(date: Date | string | undefined): string | undefined {
  if (!date) return undefined;

  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return undefined;

  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
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
