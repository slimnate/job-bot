import { Link } from 'react-router-dom';

import { useSettingsContext } from '../settings/SettingsContext.js';
import { SETTINGS_NAV_ITEMS } from '../settings/settingsSections.js';

/**
 * Settings landing page: env-only keys and links to each section.
 */
export function SettingsOverviewPage() {
  const { ui } = useSettingsContext();

  if (!ui) {
    return null;
  }

  return (
    <div className='settings-overview'>
      <h2 className='settings-section-title'>Overview</h2>
      <p className='muted settings-overview-intro'>
        Choose a section in the sidebar to edit worker, LinkedIn, ranking, and related options.
        Unsaved changes persist while you move between sections; use Save settings when done.
      </p>

      <aside className='settings-env-banner' aria-label='Environment-only configuration'>
        <h3 className='settings-env-banner-title'>Configure in environment only</h3>
        <ul className='settings-env-banner-list'>
          {ui.envOnlyBanner.map((item) => (
            <li key={item.key}>
              <strong>{item.key}</strong> — {item.where}
            </li>
          ))}
        </ul>
      </aside>

      <nav className='settings-overview-links' aria-label='Jump to settings section'>
        <h3 className='settings-overview-links-title'>Sections</h3>
        <ul className='settings-overview-section-list'>
          {SETTINGS_NAV_ITEMS.map((item) => (
            <li key={item.section} className='settings-overview-section'>
              <Link to={item.to} className='posting-external-link settings-overview-section-link'>
                {item.label}
              </Link>
              <p className='settings-overview-section-desc muted'>{item.description}</p>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
