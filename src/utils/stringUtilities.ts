/**
 * Convert a snake_case string to camelCase.
 * Used to transform API metric names (e.g., "heart_rate") to
 * Obsidian frontmatter keys (e.g., "heartRate").
 */
export function snakeToCamelCase(s: string): string {
  return s.replaceAll(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
