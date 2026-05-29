export type DailySchedule = {
  kind: 'daily';
  timeOfDay: string;
  timezone: string;
};

export type IntervalSchedule = {
  kind: 'interval';
  intervalHours: number;
};

export type WorkerRecurringSchedule = DailySchedule | IntervalSchedule;

/** One-time run with no recurrence. Never persisted as a schedule row. */
export type OnceSchedule = {
  kind: 'once';
};

/** Accepted schedule shape from the unified run dialog: one-time or recurring. */
export type RunScheduleInput = OnceSchedule | WorkerRecurringSchedule;

/**
 * Narrows a run schedule input to a recurring schedule. One-time inputs never
 * advance `nextRunAt`, so `computeNextRunAt` must only be called when this returns true.
 */
export const isRecurringSchedule = (
  schedule: RunScheduleInput
): schedule is WorkerRecurringSchedule => schedule.kind !== 'once';

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

type ParsedDailyTime = {
  hour: number;
  minute: number;
};

/**
 * Parses a daily `HH:mm` schedule string and validates value bounds.
 */
function parseDailyTime(timeOfDay: string): ParsedDailyTime {
  const trimmed = timeOfDay.trim();
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(trimmed);
  if (!match) {
    throw new Error('Daily schedule time must be in HH:mm format.');
  }
  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  };
}

/**
 * Returns local hour/minute for a UTC timestamp in the provided IANA timezone.
 */
function getLocalHourMinute(timestamp: number, timezone: string): { hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(new Date(timestamp));
  const hourPart = parts.find((part) => part.type === 'hour')?.value;
  const minutePart = parts.find((part) => part.type === 'minute')?.value;
  if (!hourPart || !minutePart) {
    throw new Error(`Could not resolve local time for timezone '${timezone}'.`);
  }
  return {
    hour: Number(hourPart),
    minute: Number(minutePart),
  };
}

/**
 * Finds the next matching local wall-clock minute in the target timezone.
 * Iterates minute-by-minute up to 48h to safely handle DST gaps/overlaps.
 */
function computeNextDailyRunAt(schedule: DailySchedule, afterMs: number): number {
  const { hour, minute } = parseDailyTime(schedule.timeOfDay);
  let cursor = Math.floor(afterMs / MS_PER_MINUTE) * MS_PER_MINUTE + MS_PER_MINUTE;
  const maxChecks = 48 * 60 + 2;

  for (let i = 0; i < maxChecks; i += 1) {
    const local = getLocalHourMinute(cursor, schedule.timezone);
    if (local.hour === hour && local.minute === minute) {
      return cursor;
    }
    cursor += MS_PER_MINUTE;
  }

  throw new Error(
    `Could not compute next daily run for ${schedule.timeOfDay} in timezone '${schedule.timezone}'.`
  );
}

/**
 * Computes the next run timestamp strictly after `afterMs`.
 */
export function computeNextRunAt(schedule: WorkerRecurringSchedule, afterMs: number): number {
  if (!Number.isFinite(afterMs)) {
    throw new Error('afterMs must be a finite timestamp.');
  }

  if (schedule.kind === 'interval') {
    if (!Number.isInteger(schedule.intervalHours) || schedule.intervalHours < 1) {
      throw new Error('Interval schedule must use a whole number of hours >= 1.');
    }
    return afterMs + schedule.intervalHours * MS_PER_HOUR;
  }

  return computeNextDailyRunAt(schedule, afterMs);
}
