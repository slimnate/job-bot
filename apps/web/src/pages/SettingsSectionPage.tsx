import { Navigate, useParams } from 'react-router-dom';

import { SettingsField } from '../components/SettingsField.js';
import { useSettingsContext } from '../settings/SettingsContext.js';
import {
  SETTINGS_NAV_ITEMS,
  SETTINGS_OVERVIEW_PATH,
  settingsSectionFromSlug,
} from '../settings/settingsSections.js';

/**
 * One settings section (sidebar route), e.g. `/settings/scheduler`.
 */
export function SettingsSectionPage() {
  const { sectionSlug } = useParams<{ sectionSlug: string }>();
  const section = settingsSectionFromSlug(sectionSlug);
  const { ui, draft, onChange, evaluatorOptions } = useSettingsContext();

  if (!ui) {
    return null;
  }

  if (!section) {
    return <Navigate to={SETTINGS_OVERVIEW_PATH} replace />;
  }

  const group = ui.sections.find((s) => s.section === section);
  if (!group) {
    return <Navigate to={SETTINGS_OVERVIEW_PATH} replace />;
  }

  const navLabel = SETTINGS_NAV_ITEMS.find((item) => item.section === section)?.label ?? group.sectionLabel;

  return (
    <div className='settings-section-page'>
      <h2 className='settings-section-title'>{navLabel}</h2>
      <section className='settings-section'>
        {group.fields.map((field) => (
          <SettingsField
            key={field.key}
            field={field}
            draftValue={draft[field.key] ?? field.storedValue}
            onChange={onChange}
            evaluators={evaluatorOptions}
            clientEnvOverride={
              field.key === 'VITE_WORKER_TRIGGER_URL' &&
              Boolean((import.meta.env.VITE_WORKER_TRIGGER_URL as string | undefined)?.trim())
            }
          />
        ))}
      </section>
    </div>
  );
}
