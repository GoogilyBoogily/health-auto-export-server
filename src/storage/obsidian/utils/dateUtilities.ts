/**
 * Date utilities for Obsidian frontmatter.
 * Provides ISO week calculation and date key formatting.
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
 * Get ISO week number and year.
 * Uses the ISO 8601 definition where week 1 is the week containing the first Thursday.
 */
export function getIsoWeek(date: Date): { week: number; year: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Set to nearest Thursday: current date + 4 - current day number (make Sunday=7)
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  // Get first day of year
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  // Calculate full weeks to nearest Thursday
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { week, year: d.getUTCFullYear() };
}

/**
 * Format date as month key: YYYY-MM
 */
export function getMonthKey(date: Date | string): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${String(year)}-${month}`;
}

/**
 * Format date as ISO week key: YYYY-WXX
 */
export function getWeekKey(date: Date | string): string {
  const d = new Date(date);
  const { week, year } = getIsoWeek(d);
  return `${String(year)}-W${String(week).padStart(2, '0')}`;
}

/**
 * Parse a date key (YYYY-MM-DD) into a Date object in local timezone.
 * Avoids timezone issues from `new Date("YYYY-MM-DD")` which interprets as UTC midnight.
 *
 * @param dateKey - Date string in YYYY-MM-DD format
 * @returns Date object representing the date in local timezone
 * @throws Error if dateKey format is invalid
 */
export function parseDateKey(dateKey: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    throw new Error(`Invalid date key format: ${dateKey}. Expected YYYY-MM-DD`);
  }

  const [y, m, d] = dateKey.split('-');
  const year = Number.parseInt(y, 10);
  const month = Number.parseInt(m, 10) - 1; // 0-indexed
  const day = Number.parseInt(d, 10);

  // Create date in local timezone
  const date = new Date(year, month, day);

  // Validate the date is real (e.g., reject "2025-13-99" or "2025-02-30")
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    throw new Error(`Invalid date: ${dateKey}. Date does not exist.`);
  }

  return date;
}

/**
 * Round a number to specified decimal places.
 */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
