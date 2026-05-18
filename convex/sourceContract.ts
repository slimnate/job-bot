import { v } from 'convex/values';

export const LINKEDIN_SOURCE = 'linkedin';

export const sourceDefinitions = {
  linkedin: {
    displayName: 'LinkedIn',
    /** `location` (free text) and `geoId` (LinkedIn numeric geo) are mutually exclusive; when both are sent, `geoId` wins. */
    acceptedCriteriaFields: ['search', 'location', 'geoId'],
  },
} as const;

export const sourceKeyValidator = v.string();

export type SourceKey = keyof typeof sourceDefinitions;

export type SourceCriteria = Partial<Record<(typeof sourceDefinitions)[SourceKey]['acceptedCriteriaFields'][number], string>>;

/**
 * Returns only allowed non-empty criteria fields for a source.
 *
 * For LinkedIn, prefers `geoId` over `location` when both are present and validates `geoId` as digits-only.
 */
export function normalizeSourceCriteria(
  source: string,
  sourceCriteria: Record<string, string | null | undefined> | undefined
): Record<string, string> {
  const normalizedSource = source.trim().toLowerCase() as SourceKey;
  const definition = sourceDefinitions[normalizedSource];
  if (!definition) {
    throw new Error(`Unsupported source '${source}'.`);
  }

  const next: Record<string, string> = {};
  for (const key of definition.acceptedCriteriaFields) {
    const value = sourceCriteria?.[key];
    if (typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      continue;
    }
    next[key] = trimmed;
  }

  if (normalizedSource === 'linkedin') {
    const gid = next.geoId;
    if (gid) {
      if (!/^\d+$/.test(gid)) {
        throw new Error('LinkedIn "geoId" must be a non-empty numeric id (digits only).');
      }
      delete next.location;
    }
  }

  return next;
}
