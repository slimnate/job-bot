import { getSystemDefault, resolveSettingRaw, type AppSettingKey } from '@job-bot/shared';

/** Settings used for Ask panel provider/model defaults (subset of full app settings). */
const QA_EFFECTIVE_KEYS = [
  'LLM_QA_PROVIDER',
  'LLM_QA_MODEL',
  'LLM_RANKING_PROVIDER',
  'LLM_RANKING_MODEL',
  'LLM_RANKING_CURSOR_MODEL',
] as const satisfies readonly AppSettingKey[];

export type QaLlmCatalogProvider = {
  key: string;
  displayName: string;
  surface: 'convex_http' | 'worker_cursor';
  models: Array<{ apiModelId: string; displayName: string }>;
};

const STORAGE_PROVIDER_KEY = 'postingAskProviderKey';
const STORAGE_MODEL_KEY = 'postingAskApiModelId';

/**
 * Maps ranking provider setting (`http` / `cursor`) to a catalog provider key.
 */
export function rankingProviderToCatalogKey(
  catalog: QaLlmCatalogProvider[],
  rankingProvider: string
): string | undefined {
  const normalized = rankingProvider.trim().toLowerCase();
  if (normalized === 'http') {
    return catalog.find((p) => p.surface === 'convex_http')?.key;
  }
  if (normalized === 'cursor') {
    return (
      catalog.find((p) => p.key === 'cursor' || p.surface === 'worker_cursor')?.key ??
      catalog.find((p) => p.surface === 'worker_cursor')?.key
    );
  }
  return catalog.find((p) => p.key === normalized)?.key;
}

/**
 * Default catalog provider for the Ask panel from effective settings.
 */
export function resolveDefaultQaProviderKey(
  catalog: QaLlmCatalogProvider[],
  effective: Record<string, string>
): string {
  const fromQa = effective.LLM_QA_PROVIDER?.trim();
  if (fromQa && catalog.some((p) => p.key === fromQa)) {
    return fromQa;
  }
  const fromRanking = rankingProviderToCatalogKey(catalog, effective.LLM_RANKING_PROVIDER ?? '');
  if (fromRanking && catalog.some((p) => p.key === fromRanking)) {
    return fromRanking;
  }
  const cursor = catalog.find((p) => p.key === 'cursor' || p.surface === 'worker_cursor');
  return cursor?.key ?? catalog[0]?.key ?? '';
}

/**
 * Default model id for the selected provider from effective settings.
 */
export function resolveDefaultQaModelId(
  provider: QaLlmCatalogProvider | undefined,
  effective: Record<string, string>
): string {
  if (!provider?.models.length) {
    return '';
  }
  const fromQa = effective.LLM_QA_MODEL?.trim();
  if (fromQa && provider.models.some((m) => m.apiModelId === fromQa)) {
    return fromQa;
  }
  const fallbackKey =
    provider.surface === 'worker_cursor' ? 'LLM_RANKING_CURSOR_MODEL' : 'LLM_RANKING_MODEL';
  const fallback = effective[fallbackKey]?.trim();
  if (fallback && provider.models.some((m) => m.apiModelId === fallback)) {
    return fallback;
  }
  return provider.models[0]!.apiModelId;
}

export function readStoredQaProviderKey(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_PROVIDER_KEY)?.trim();
    return raw || null;
  } catch {
    return null;
  }
}

export function readStoredQaModelId(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_MODEL_KEY)?.trim();
    return raw || null;
  } catch {
    return null;
  }
}

export function persistQaLlmSelection(providerKey: string, apiModelId: string): void {
  try {
    localStorage.setItem(STORAGE_PROVIDER_KEY, providerKey);
    localStorage.setItem(STORAGE_MODEL_KEY, apiModelId);
  } catch {
    // ignore storage errors
  }
}

/**
 * Resolves Ask-related settings in the browser without requiring every `APP_SETTING_KEYS` row
 * to exist in Convex (unlike `resolveAllSettingsRaw`, which throws on missing keys).
 */
export function resolveQaPanelEffectiveSettings(
  stored: Record<string, string> | undefined
): Record<string, string> {
  const env: Record<string, string | undefined> = {};
  const storedWithDefaults: Record<string, string> = {};
  for (const key of QA_EFFECTIVE_KEYS) {
    const fromStored = stored?.[key];
    storedWithDefaults[key] = fromStored !== undefined ? fromStored : getSystemDefault(key);
  }
  const effective: Record<string, string> = {};
  for (const key of QA_EFFECTIVE_KEYS) {
    effective[key] = resolveSettingRaw(key, { env, stored: storedWithDefaults }).value;
  }
  return effective;
}
