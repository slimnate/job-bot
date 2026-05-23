import {
  APP_SETTING_SECTION_DESCRIPTIONS,
  APP_SETTING_SECTION_LABELS,
  APP_SETTING_SECTION_ORDER,
  type AppSettingSection,
} from '@job-bot/shared';

/** URL slug per settings section (nested under `/settings/`). */
export const SETTINGS_SECTION_SLUG: Record<AppSettingSection, string> = {
  scheduler: 'scheduler',
  linkedin: 'linkedin',
  ranking: 'ranking',
  http_openai: 'http-openai',
  cursor_cli: 'cursor-cli',
  web: 'web',
  advanced: 'advanced',
};

const slugToSection = new Map(
  (Object.entries(SETTINGS_SECTION_SLUG) as [AppSettingSection, string][]).map(([section, slug]) => [
    slug,
    section,
  ])
);

export function settingsSectionFromSlug(slug: string | undefined): AppSettingSection | undefined {
  if (!slug) {
    return undefined;
  }
  return slugToSection.get(slug);
}

export const SETTINGS_NAV_ITEMS = APP_SETTING_SECTION_ORDER.map((section) => ({
  section,
  slug: SETTINGS_SECTION_SLUG[section],
  label: APP_SETTING_SECTION_LABELS[section],
  description: APP_SETTING_SECTION_DESCRIPTIONS[section],
  to: `/settings/${SETTINGS_SECTION_SLUG[section]}`,
}));

export const SETTINGS_OVERVIEW_PATH = '/settings/overview';
