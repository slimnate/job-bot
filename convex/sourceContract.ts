import {
  normalizeRemotiveCategoriesCriteria,
  parseGreenhouseIncludeProspects,
  requireGreenhouseBoardToken,
} from '@job-bot/shared';
import { v } from 'convex/values';

export const LINKEDIN_SOURCE = 'linkedin';
export const REMOTIVE_SOURCE = 'remotive';
export const GREENHOUSE_SOURCE = 'greenhouse';

export type CriteriaFieldMeta = {
  label: string;
  hint?: string;
  required?: boolean;
  placeholder?: string;
};

export const sourceDefinitions = {
  linkedin: {
    displayName: 'LinkedIn',
    /** Optional `search` (empty → preferences hub); optional `location` only when `search` is set. */
    acceptedCriteriaFields: ['search', 'location'],
  },
  remotive: {
    displayName: 'Remotive',
    /** Comma-separated category slugs; empty → all-jobs RSS feed. */
    acceptedCriteriaFields: ['categories'],
  },
  greenhouse: {
    displayName: 'Greenhouse',
    acceptedCriteriaFields: [
      'boardToken',
      'keyword',
      'department',
      'office',
      'includeProspects',
    ],
    criteriaFieldMeta: {
      boardToken: {
        label: 'Board token',
        hint: 'From boards.greenhouse.io/TOKEN (required). Paste a full URL to extract the token.',
        required: true,
        placeholder: 'stripe',
      },
      keyword: {
        label: 'Keyword',
        hint: 'Optional; filters title, location, and description after fetch.',
        placeholder: 'engineer',
      },
      department: {
        label: 'Department',
        hint: 'Optional; case-insensitive match on department names.',
        placeholder: 'Engineering',
      },
      office: {
        label: 'Office',
        hint: 'Optional; case-insensitive match on office names.',
        placeholder: 'San Francisco',
      },
      includeProspects: {
        label: 'Include prospect posts',
        hint: 'Set to true, yes, or 1 to include general prospect postings.',
        placeholder: 'false',
      },
    } satisfies Record<string, CriteriaFieldMeta>,
  },
} as const;

export const sourceKeyValidator = v.string();

export type SourceKey = keyof typeof sourceDefinitions;

export type SourceCriteria = Partial<
  Record<(typeof sourceDefinitions)[SourceKey]['acceptedCriteriaFields'][number], string>
>;

/**
 * Returns criteria field metadata when defined for a source (e.g. Greenhouse labels/hints).
 */
export function getCriteriaFieldMeta(
  source: string
): Record<string, CriteriaFieldMeta> | undefined {
  const normalizedSource = source.trim().toLowerCase() as SourceKey;
  const definition = sourceDefinitions[normalizedSource];
  if (!definition || !('criteriaFieldMeta' in definition)) {
    return undefined;
  }
  return definition.criteriaFieldMeta;
}

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

  if (normalizedSource === 'remotive' && typeof sourceCriteria?.categories === 'string') {
    const normalizedCategories = normalizeRemotiveCategoriesCriteria(sourceCriteria.categories);
    if (normalizedCategories) {
      next.categories = normalizedCategories;
    } else {
      delete next.categories;
    }
  }

  if (normalizedSource === 'greenhouse') {
    next.boardToken = requireGreenhouseBoardToken(sourceCriteria?.boardToken ?? next.boardToken);

    if (next.keyword) {
      next.keyword = next.keyword.trim();
      if (!next.keyword) {
        delete next.keyword;
      }
    }
    if (next.department) {
      next.department = next.department.trim();
      if (!next.department) {
        delete next.department;
      }
    }
    if (next.office) {
      next.office = next.office.trim();
      if (!next.office) {
        delete next.office;
      }
    }

    if (parseGreenhouseIncludeProspects(sourceCriteria?.includeProspects ?? next.includeProspects)) {
      next.includeProspects = 'true';
    } else {
      delete next.includeProspects;
    }
  }

  return next;
}
