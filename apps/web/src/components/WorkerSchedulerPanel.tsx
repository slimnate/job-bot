import { useQuery } from 'convex/react';
import { useEffect, useState } from 'react';

import { api } from '../../../../convex/_generated/api.js';
import type { Doc } from '../../../../convex/_generated/dataModel.js';

type WorkerSchedulerStatusRow = Doc<'worker_scheduler_status'>;

/**
 * Wall-clock age (ms) past which we consider the persisted status stale and
 * the worker likely dead. Paired with the worker's 5s heartbeat interval —
 * 30s gives ~6 missed heartbeats before alerting.
 */
const STALE_THRESHOLD_MS = 30_000;

function formatDateTime(ts: number | null): string {
  if (ts === null) {
    return '—';
  }
  return new Date(ts).toLocaleString();
}

/** Same calendar day as `now` → time only; otherwise short date + time (saves horizontal space). */
function formatCompactClock(ts: number | null, now: number): string {
  if (ts === null) {
    return '—';
  }
  const d = new Date(ts);
  const n = new Date(now);
  const sameDay =
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  }
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatTriggerShort(label: string | null): string {
  if (!label) {
    return '—';
  }
  switch (label) {
    case 'run_on_start':
      return 'start';
    case 'interval':
      return 'interval';
    case 'run_now':
      return 'manual';
    default:
      return label;
  }
}

function formatRelativeFuture(ts: number | null, now: number): string {
  if (ts === null) {
    return '';
  }
  const delta = ts - now;
  if (delta <= 0) {
    return 'due';
  }
  const sec = Math.round(delta / 1000);
  if (sec < 60) {
    return `~${sec}s`;
  }
  const min = Math.round(sec / 60);
  if (min < 120) {
    return `~${min}m`;
  }
  const hr = Math.round(min / 60);
  return `~${hr}h`;
}

/** How long ago `ts` was, for heartbeat display. */
function formatRelativePast(ts: number, now: number): string {
  const delta = now - ts;
  if (delta < 2_000) {
    return 'just now';
  }
  const sec = Math.round(delta / 1000);
  if (sec < 60) {
    return `${sec}s ago`;
  }
  const min = Math.round(sec / 60);
  if (min < 120) {
    return `${min}m ago`;
  }
  const hr = Math.round(min / 60);
  return `${hr}h ago`;
}

/**
 * Reactive view of the worker's scheduler status. Backed by Convex
 * (`worker_scheduler_status`), so updates render instantly and persist
 * across worker restarts. A "stale" badge appears when the heartbeat
 * is older than `STALE_THRESHOLD_MS`, indicating the worker may have
 * crashed even though the last persisted `timerActive` was true.
 *
 * The first-row heartbeat chip shows the fixed text `live` while fresh
 * (same threshold) so it does not tick every second; only the stale
 * branch shows a relative "last hb …" age that updates with the panel clock.
 *
 * Layout is intentionally dense (two text rows + optional error) to keep
 * vertical footprint small on the Workers page.
 */
export function WorkerSchedulerPanel() {
  const status = useQuery(api.workerScheduler.getStatus, {}) as
    | WorkerSchedulerStatusRow
    | null
    | undefined;

  const [nowTick, setNowTick] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const isStale = status ? nowTick - status.heartbeatAt > STALE_THRESHOLD_MS : false;

  return (
    <section className='panel panel--scheduler-tight'>
      <div className='panel-heading'>
        <h2>Scheduler</h2>
        <SchedulerHeaderBadges status={status ?? null} isStale={isStale} />
      </div>

      {status === undefined ? (
        <p className='field-hint scheduler-compact__hint'>Loading scheduler…</p>
      ) : status === null ? (
        <p className='field-hint scheduler-compact__hint'>
          No scheduler status yet — start the worker to populate this panel.
        </p>
      ) : (
        <div className='scheduler-compact'>
          <div className='scheduler-compact__row'>
            <span title={`Interval: ${status.intervalMs} ms`}>
              <span className='scheduler-compact__label'>Interval</span> every{' '}
              <span className='scheduler-compact__time'>{status.intervalMinutes} min</span>
            </span>
            <span className='scheduler-compact__sep' aria-hidden='true'>
              ·
            </span>
            <QueueBadges snapshot={status.lastTickQueueSnapshot} />
            <span className='scheduler-compact__sep' aria-hidden='true'>
              ·
            </span>
            <span
              className={isStale ? 'scheduler-compact__live scheduler-compact__live--stale' : 'scheduler-compact__live'}
              title={
                isStale
                  ? `No heartbeat for ${STALE_THRESHOLD_MS / 1000}s+ · last: ${formatDateTime(status.heartbeatAt)}`
                  : `Last heartbeat: ${formatDateTime(status.heartbeatAt)} · stale label after ${STALE_THRESHOLD_MS / 1000}s without ping`
              }
            >
              {isStale ? (
                <>last hb {formatRelativePast(status.heartbeatAt, nowTick)}</>
              ) : (
                <>live</>
              )}
            </span>
          </div>

          <div className='scheduler-compact__row scheduler-compact__row--muted'>
            <span title={`Scheduler started: ${formatDateTime(status.schedulerStartedAt)}`}>
              Started <span className='scheduler-compact__time'>{formatCompactClock(status.schedulerStartedAt, nowTick)}</span>
            </span>
            <span className='scheduler-compact__sep' aria-hidden='true'>
              ·
            </span>
            <span title={`Last interval callback: ${formatDateTime(status.lastIntervalRingAt)}`}>
              Ring <span className='scheduler-compact__time'>{formatCompactClock(status.lastIntervalRingAt, nowTick)}</span>
            </span>
            <span className='scheduler-compact__sep' aria-hidden='true'>
              ·
            </span>
            <span
              title={`Next interval tick: ${formatDateTime(status.nextIntervalTickAt)}`}
            >
              Next{' '}
              <span className='scheduler-compact__time'>
                {formatCompactClock(status.nextIntervalTickAt, nowTick)}
              </span>
              {status.nextIntervalTickAt !== null ? (
                <span className='scheduler-compact__paren'>
                  {' '}
                  ({formatRelativeFuture(status.nextIntervalTickAt, nowTick)})
                </span>
              ) : null}
            </span>
            <span className='scheduler-compact__sep' aria-hidden='true'>
              ·
            </span>
            <span
              title={`Last tick: ${formatDateTime(status.lastTickCompletedAt)} · ${status.lastTickTrigger ?? ''} · ${status.lastTickDurationMs ?? ''} ms`}
            >
              Tick{' '}
              <span className='scheduler-compact__time'>
                {formatCompactClock(status.lastTickCompletedAt, nowTick)}
              </span>
              {status.lastTickTrigger !== null && status.lastTickTrigger !== '' ? (
                <span className='scheduler-compact__paren'>
                  {' '}
                  ({formatTriggerShort(status.lastTickTrigger)}
                  {status.lastTickDurationMs !== null ? ` · ${status.lastTickDurationMs}ms` : ''})
                </span>
              ) : status.lastTickDurationMs !== null ? (
                <span className='scheduler-compact__paren'> ({status.lastTickDurationMs}ms)</span>
              ) : null}
            </span>
          </div>

          {status.lastTickError ? (
            <p className='scheduler-compact__error status-text' title={status.lastTickError}>
              Tick error {formatCompactClock(status.lastTickFailedAt, nowTick)}: {status.lastTickError}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

/**
 * Renders the timer/tick/stale badges at the top of the panel so users get a
 * single-glance view even when the body is dense.
 */
function SchedulerHeaderBadges(props: {
  status: WorkerSchedulerStatusRow | null;
  isStale: boolean;
}) {
  const { status, isStale } = props;
  if (!status) {
    return null;
  }

  /**
   * Stale wins over running: if heartbeat is old, the persisted `timerActive`
   * is unreliable (worker may have died with the timer "on").
   */
  const timerBadge = isStale ? (
    <span className='status-badge scheduler-timer-stale' title='Worker heartbeat is stale.'>
      stale
    </span>
  ) : status.timerActive ? (
    <span className='status-badge scheduler-timer-on'>running</span>
  ) : (
    <span className='status-badge scheduler-timer-off'>stopped</span>
  );

  const tickBadge =
    !isStale && status.tickInFlight ? (
      <span className='status-badge scheduler-tick-active'>tick</span>
    ) : null;

  return (
    <div className='scheduler-header-badges'>
      {timerBadge}
      {tickBadge}
    </div>
  );
}

/**
 * Two color-coded badges for queue state. Renders an em dash when the worker
 * has not completed a tick yet (snapshot is null).
 */
function QueueBadges(props: { snapshot: { queued: number; running: number } | null }) {
  const { snapshot } = props;
  if (!snapshot) {
    return <span className='field-hint'>—</span>;
  }
  return (
    <span className='scheduler-queue-badges'>
      <span className='status-badge status-queued'>{snapshot.queued} queued</span>
      <span className='status-badge status-running'>{snapshot.running} running</span>
    </span>
  );
}
