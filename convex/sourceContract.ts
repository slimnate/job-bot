import { v } from 'convex/values';

export const LINKEDIN_SOURCE = 'linkedin';

export const sourceDefinitions = {
  linkedin: {
    displayName: 'LinkedIn',
    /** Optional `search` (empty → preferences hub); optional `location` only when `search` is set. */
    acceptedCriteriaFields: ['search', 'location'],
  },
} as const;

export const sourceKeyValidator = v.string();

export type SourceKey = keyof typeof sourceDefinitions;

export type SourceCriteria = Partial<Record<(typeof sourceDefinitions)[SourceKey]['acceptedCriteriaFields'][number], string>>;

/**
 * Returns only allowed non-empty criteria fields for a source.
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

  if (normalizedSource === 'linkedin' && next.location && !next.search) {
    delete next.location;
  }

  return next;
}
