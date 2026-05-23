import type { Id } from '../../../../convex/_generated/dataModel.js';

export type SettingsFieldMeta = {
  key: string;
  label: string;
  hint: string;
  type: 'boolean' | 'number' | 'string' | 'enum' | 'evaluator_id';
  /** Factory default from systemSettingDefaults.ts (reference only). */
  systemDefault: string;
  storedValue: string;
  effectiveValue: string;
  source: 'env' | 'convex';
  envOverrideActive: boolean;
  /** Where the overriding env var is set (`worker` = worker `.env.local`). */
  envSource: 'worker' | 'convex' | null;
  workerEnvReportedAt: number | null;
  min?: number;
  max?: number;
  optional?: boolean;
  enumOptions?: { value: string; label: string }[];
};

type EvaluatorOption = { id: Id<'job_evaluators'>; name: string };

type SettingsFieldProps = {
  field: SettingsFieldMeta;
  draftValue: string;
  onChange: (key: string, value: string) => void;
  evaluators?: EvaluatorOption[];
  /** Browser/Vite env override (not reported by worker or Convex). */
  clientEnvOverride?: boolean;
};

function formatInUseDisplay(
  field: SettingsFieldMeta,
  evaluators: EvaluatorOption[],
  clientEnvOverride: boolean
): string {
  let raw = field.effectiveValue;
  if (clientEnvOverride && field.key === 'VITE_WORKER_TRIGGER_URL') {
    const vite = (import.meta.env.VITE_WORKER_TRIGGER_URL as string | undefined)?.trim();
    if (vite) {
      raw = vite;
    }
  }

  if (field.type === 'boolean') {
    return raw === 'true' || raw === '1' ? 'On' : 'Off';
  }
  if (field.type === 'enum') {
    const option = field.enumOptions?.find((opt) => opt.value === raw);
    return option?.label ?? (raw.trim() === '' ? '(empty)' : raw);
  }
  if (field.type === 'evaluator_id') {
    if (raw.trim() === '') {
      return 'None';
    }
    const match = evaluators.find((ev) => ev.id === raw);
    return match?.name ?? raw;
  }
  return raw.trim() === '' ? '(empty)' : raw;
}

function formatInUseValue(
  field: SettingsFieldMeta,
  evaluators: EvaluatorOption[],
  clientEnvOverride: boolean
): string {
  return formatInUseDisplay(field, evaluators, clientEnvOverride).toLowerCase();
}

function envOverrideTooltip(
  field: SettingsFieldMeta,
  envVarName: string,
  clientEnvOverride: boolean,
  evaluators: EvaluatorOption[]
): string {
  const inUse = formatInUseValue(field, evaluators, clientEnvOverride);
  if (clientEnvOverride) {
    return `${envVarName} is set in the browser environment (Vite / import.meta.env) and overrides this saved value. In use: ${inUse}.`;
  }
  if (field.envSource === 'worker') {
    return `${envVarName} is set on the worker host (e.g. .env.local) and overrides this saved value. In use: ${inUse}.`;
  }
  if (field.envSource === 'convex') {
    return `${envVarName} is set in the Convex deployment environment and overrides this saved value. In use: ${inUse}.`;
  }
  return `${envVarName} overrides this saved value. In use: ${inUse}.`;
}

export function SettingsField({
  field,
  draftValue,
  onChange,
  evaluators = [],
  clientEnvOverride = false,
}: SettingsFieldProps) {
  const hintId = `settings-hint-${field.key}`;
  const isEnvOverride = field.envOverrideActive || clientEnvOverride;
  const isChanged = draftValue !== field.storedValue;
  const envVarName = field.key;
  const inUseDisplay = formatInUseDisplay(field, evaluators, clientEnvOverride);

  const control = (() => {
    switch (field.type) {
      case 'boolean':
        return (
          <label className='settings-field-checkbox'>
            <input
              type='checkbox'
              checked={draftValue === 'true' || draftValue === '1'}
              onChange={(e) => onChange(field.key, e.target.checked ? 'true' : 'false')}
              aria-describedby={hintId}
            />
            <span>{field.label}</span>
          </label>
        );
      case 'enum':
        return (
          <label className='settings-field-label'>
            <span>{field.label}</span>
            <select
              className='settings-field-control'
              value={draftValue}
              onChange={(e) => onChange(field.key, e.target.value)}
              aria-describedby={hintId}
            >
              {(field.enumOptions ?? []).map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        );
      case 'evaluator_id':
        return (
          <label className='settings-field-label'>
            <span>{field.label}</span>
            <select
              className='settings-field-control'
              value={draftValue}
              onChange={(e) => onChange(field.key, e.target.value)}
              aria-describedby={hintId}
            >
              <option value=''>— None —</option>
              {evaluators.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.name}
                </option>
              ))}
            </select>
          </label>
        );
      case 'number':
        return (
          <label className='settings-field-label'>
            <span>{field.label}</span>
            <input
              className='settings-field-control'
              type='number'
              value={draftValue}
              min={field.min}
              max={field.max}
              placeholder={field.optional ? 'Optional' : undefined}
              onChange={(e) => onChange(field.key, e.target.value)}
              aria-describedby={hintId}
            />
          </label>
        );
      default:
        return (
          <label className='settings-field-label'>
            <span>{field.label}</span>
            <input
              className='settings-field-control'
              type='text'
              value={draftValue}
              onChange={(e) => onChange(field.key, e.target.value)}
              aria-describedby={hintId}
            />
          </label>
        );
    }
  })();

  return (
    <div className='settings-field'>
      {isEnvOverride || isChanged ? (
        <div className='settings-field-badges' aria-label='Setting status'>
          {isEnvOverride ? (
            <span
              className='settings-status-badge settings-status-badge--env'
              title={envOverrideTooltip(field, envVarName, clientEnvOverride, evaluators)}
            >
              <span className='settings-status-badge__label'>ENV Override</span>
              <span className='settings-status-badge__sep' aria-hidden>
                {' - '}
              </span>
              <span className='settings-status-badge__value'>{inUseDisplay}</span>
            </span>
          ) : null}
          {isChanged ? (
            <span
              className='settings-status-badge settings-status-badge--changed'
              title='Unsaved change — save settings to apply.'
            >
              Changed
            </span>
          ) : null}
        </div>
      ) : null}
      <div className='settings-field-body'>{control}</div>
      <p id={hintId} className='settings-field-hint'>
        {field.hint}
      </p>
    </div>
  );
}
