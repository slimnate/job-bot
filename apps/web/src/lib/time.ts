/**
 * Returns a concise, human-friendly timestamp string for UI tables.
 *
 * Behavior:
 * - Missing/invalid timestamp -> '-'
 * - Same local calendar day as `nowMs` -> local time only (for example, `11:42 AM`)
 * - Older dates -> relative age bucket (`1 day`, `2 weeks`, `1 month`)
 *
 * Note: Relative buckets intentionally stay coarse for scanability in dense tables.
 */
export const formatHumanizedTime = (timestamp?: number, nowMs = Date.now()): string => {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return '-';
  }

  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    return '-';
  }

  const now = new Date(nowMs);
  if (isSameLocalDay(value, now)) {
    return value.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  const daysOld = getLocalCalendarDayDiff(value, now);
  if (daysOld < 1) {
    return value.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  if (daysOld < 7) {
    return pluralize(daysOld, 'day');
  }
  if (daysOld < 30) {
    return pluralize(Math.floor(daysOld / 7), 'week');
  }
  return pluralize(Math.floor(daysOld / 30), 'month');
};

/**
 * Computes elapsed full local calendar days between two dates.
 */
const getLocalCalendarDayDiff = (from: Date, to: Date): number => {
  const fromStart = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const toStart = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.max(0, Math.floor((toStart - fromStart) / 86_400_000));
};

/**
 * Checks whether two dates fall on the same local calendar day.
 */
const isSameLocalDay = (left: Date, right: Date): boolean =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

/**
 * Produces compact singular/plural labels such as `1 day`, `2 weeks`.
 */
const pluralize = (count: number, unit: 'day' | 'week' | 'month'): string =>
  `${count} ${unit}${count === 1 ? '' : 's'}`;
