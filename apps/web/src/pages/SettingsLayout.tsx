import { useMemo } from 'react';
import { NavLink, Outlet, Navigate } from 'react-router-dom';

import { SettingsProvider, useSettingsContext } from '../settings/SettingsContext.js';
import {
  SETTINGS_NAV_ITEMS,
  SETTINGS_OVERVIEW_PATH,
} from '../settings/settingsSections.js';

function navLinkClass({ isActive }: { isActive: boolean }) {
  return isActive ? 'settings-nav-link settings-nav-link--active' : 'settings-nav-link';
}

/** Match scheduler staleness threshold in `WorkerSchedulerPanel`. */
const WORKER_ENV_STALE_MS = 90_000;

function SettingsLayoutInner() {
  const { ui, saving, message, onSubmit } = useSettingsContext();

  const workerEnvStale = useMemo(() => {
    if (!ui?.workerEnvReportedAt) {
      return true;
    }
    return Date.now() - ui.workerEnvReportedAt > WORKER_ENV_STALE_MS;
  }, [ui?.workerEnvReportedAt]);

  if (ui === undefined) {
    return (
      <div className='panel'>
        <p className='muted'>Loading settings…</p>
      </div>
    );
  }

  return (
    <div className='panel settings-layout'>
      <header className='settings-header'>
        <h1>Settings</h1>
        <p className='muted'>
          Configure worker, scraping, and ranking behavior. Values are stored in Convex; non-empty
          environment variables in <code>.env.local</code> or your shell always take precedence.
          Env override badges for worker settings reflect the last report from worker{' '}
          <code>{ui.workerId}</code>
          {ui.workerEnvReportedAt ? (
            <>
              {' '}
              ({new Date(ui.workerEnvReportedAt).toLocaleString()}
              ).
            </>
          ) : (
            ' (not reported yet — start the worker).'
          )}
        </p>
        {workerEnvStale ? (
          <p className='settings-worker-env-stale' role='status'>
            Worker env overrides may be out of date — the worker has not reported in the last 90
            seconds. Env override badges show the last known worker <code>.env.local</code> snapshot.
          </p>
        ) : null}
      </header>

      <div className='settings-layout-body'>
        <nav className='settings-sidebar' aria-label='Settings sections'>
          <ul className='settings-nav-list'>
            <li>
              <NavLink className={navLinkClass} to={SETTINGS_OVERVIEW_PATH} end>
                Overview
              </NavLink>
            </li>
            {SETTINGS_NAV_ITEMS.map((item) => (
              <li key={item.section}>
                <NavLink className={navLinkClass} to={item.to}>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className='settings-main'>
          <form className='settings-main-form' onSubmit={(e) => void onSubmit(e)}>
            <Outlet />
            <div className='settings-actions'>
              <button type='submit' disabled={saving}>
                {saving ? 'Saving…' : 'Save settings'}
              </button>
              {message ? <p className='settings-message'>{message}</p> : null}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export function SettingsLayout() {
  return (
    <SettingsProvider>
      <SettingsLayoutInner />
    </SettingsProvider>
  );
}

/** Default `/settings` → overview. */
export function SettingsIndexRedirect() {
  return <Navigate to={SETTINGS_OVERVIEW_PATH} replace />;
}
