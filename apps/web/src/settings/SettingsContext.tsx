import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useMutation, useQuery } from 'convex/react';

import { api } from '../../../../convex/_generated/api.js';
import type { Id } from '../../../../convex/_generated/dataModel.js';

import type { SettingsFieldMeta } from '../components/SettingsField.js';

export type SettingsUiData = {
  values: Record<string, string>;
  updatedAt: number;
  workerId: string;
  workerEnvReportedAt: number | null;
  sections: Array<{
    section: string;
    sectionLabel: string;
    fields: SettingsFieldMeta[];
  }>;
  envOnlyBanner: Array<{ key: string; where: string }>;
};

type SettingsContextValue = {
  ui: SettingsUiData | undefined;
  draft: Record<string, string>;
  onChange: (key: string, value: string) => void;
  saving: boolean;
  message: string;
  onSubmit: (event: FormEvent) => void;
  evaluatorOptions: Array<{ id: Id<'job_evaluators'>; name: string }>;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const seedMissingSettings = useMutation(api.appSettings.seedMissingSettings);
  const ui = useQuery(api.appSettings.getForUi, {});
  const upsert = useMutation(api.appSettings.upsert);
  const evaluators = useQuery(api.evaluators.list, { limit: 100 });

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [seedDone, setSeedDone] = useState(false);

  useEffect(() => {
    if (seedDone) {
      return;
    }
    void seedMissingSettings({})
      .then(() => setSeedDone(true))
      .catch(() => {
        /* getForUi still works; worker will seed on boot */
      });
  }, [seedDone, seedMissingSettings]);

  useEffect(() => {
    if (ui?.values) {
      setDraft({ ...ui.values });
    }
  }, [ui?.values, ui?.updatedAt]);

  const evaluatorOptions = useMemo(
    () =>
      (evaluators ?? []).map((row) => ({
        id: row._id as Id<'job_evaluators'>,
        name: row.name,
      })),
    [evaluators]
  );

  const onChange = useCallback((key: string, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setMessage('');
  }, []);

  const onSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      if (!ui) {
        return;
      }
      setSaving(true);
      setMessage('');
      try {
        const patch: Record<string, string> = {};
        for (const section of ui.sections) {
          for (const field of section.fields) {
            const next = draft[field.key] ?? field.storedValue;
            if (next !== field.storedValue) {
              patch[field.key] = next;
            }
          }
        }
        if (Object.keys(patch).length === 0) {
          setMessage('No changes to save.');
          return;
        }
        await upsert({ values: patch });
        setMessage('Settings saved. The worker picks up changes within about 30 seconds.');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Could not save settings.');
      } finally {
        setSaving(false);
      }
    },
    [draft, ui, upsert]
  );

  const value = useMemo(
    () => ({
      ui: ui as SettingsUiData | undefined,
      draft,
      onChange,
      saving,
      message,
      onSubmit,
      evaluatorOptions,
    }),
    [ui, draft, onChange, saving, message, onSubmit, evaluatorOptions]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettingsContext(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error('useSettingsContext must be used within SettingsProvider');
  }
  return ctx;
}
