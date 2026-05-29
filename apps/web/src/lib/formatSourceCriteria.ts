import { formatGreenhouseCriteriaForDisplay, formatRemotiveCategoriesForDisplay } from '@job-bot/shared';

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

  if (source.trim().toLowerCase() === 'greenhouse') {
    return formatGreenhouseCriteriaForDisplay(sourceCriteria);
  }

  return Object.entries(sourceCriteria)
    .map(([key, value]) => `${key}: ${value}`)
    .join(' | ');
}

type RunSchedule =
  | { kind: 'once' }
  | { kind: 'daily'; timeOfDay: string; timezone: string }
  | { kind: 'interval'; intervalHours: number };

/**
 * Human-readable cadence summary for a schedule. One-time runs return an empty
 * string so callers can omit the cadence portion of a label.
 */
export function formatScheduleCadence(schedule: RunSchedule): string {
  if (schedule.kind === 'daily') {
    return `Daily ${schedule.timeOfDay} (${schedule.timezone})`;
  }
  if (schedule.kind === 'interval') {
    return `Every ${schedule.intervalHours}h`;
  }
  return '';
}

/**
 * Derives a display label for a run/schedule from its source, criteria, and cadence.
 * Replaces the removed user-defined name field. Examples:
 *   "LinkedIn — search: dev | location: Austin — Daily 09:00 (America/Chicago)"
 *   "Remotive — All jobs"  (one-time)
 */
export function formatRunLabel(args: {
  source: string;
  displayName?: string;
  sourceCriteria: Record<string, string> | undefined;
  schedule: RunSchedule;
}): string {
  const sourceLabel = args.displayName?.trim() || args.source;
  const criteria = formatSourceCriteriaSummary(args.source, args.sourceCriteria);
  const cadence = formatScheduleCadence(args.schedule);
  const parts = [sourceLabel];
  if (criteria && criteria !== '—') {
    parts.push(criteria);
  }
  if (cadence) {
    parts.push(cadence);
  }
  return parts.join(' — ');
}
