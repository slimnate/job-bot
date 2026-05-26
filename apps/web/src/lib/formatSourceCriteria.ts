import { formatRemotiveCategoriesForDisplay } from '@job-bot/shared';

/**
 * Formats scrape run source criteria for display in queue/history tables.
 */
export function formatSourceCriteriaSummary(
  source: string,
  sourceCriteria: Record<string, string> | undefined
): string {
  if (!sourceCriteria || Object.keys(sourceCriteria).length === 0) {
    return source.trim().toLowerCase() === 'remotive' ? 'All jobs' : '—';
  }

  if (source.trim().toLowerCase() === 'remotive') {
    return formatRemotiveCategoriesForDisplay(sourceCriteria.categories);
  }

  return Object.entries(sourceCriteria)
    .map(([key, value]) => `${key}: ${value}`)
    .join(' | ');
}
