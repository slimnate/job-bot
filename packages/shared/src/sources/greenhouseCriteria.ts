/**
 * Greenhouse Job Board API criteria helpers.
 * @see https://developers.greenhouse.io/job-board.html
 */

export const GREENHOUSE_BOARDS_API_BASE = 'https://boards-api.greenhouse.io/v1';

export type GreenhouseNamedEntity = {
  id?: number;
  name?: string;
};

export type GreenhouseJobListItem = {
  id: number;
  internal_job_id: number | null;
  title: string;
  updated_at?: string;
  location?: { name?: string };
  absolute_url: string;
  language?: string;
  content?: string;
  departments?: GreenhouseNamedEntity[];
  offices?: GreenhouseNamedEntity[];
};

export type GreenhouseSearchCriteria = {
  boardToken: string;
  keyword: string;
  department: string;
  office: string;
  includeProspects: boolean;
};

/**
 * Extracts and normalizes a board token from a slug or pasted Greenhouse URL.
 */
/**
 * Returns a normalized board token or throws when missing/blank after normalization.
 */
export function requireGreenhouseBoardToken(raw: string | undefined): string {
  const token = normalizeGreenhouseBoardToken(raw);
  if (!token) {
    throw new Error(
      'Greenhouse requires a board token (e.g. stripe from https://boards.greenhouse.io/stripe).'
    );
  }
  return token;
}

export function normalizeGreenhouseBoardToken(raw: string | undefined): string {
  if (!raw?.trim()) {
    return '';
  }
  let value = raw.trim();

  const embedFor = value.match(/[?&]for=([^&]+)/i);
  if (embedFor?.[1]) {
    value = decodeURIComponent(embedFor[1]);
  }

  const boardsApiMatch = value.match(/boards-api\.greenhouse\.io\/v1\/boards\/([^/?#]+)/i);
  if (boardsApiMatch?.[1]) {
    value = boardsApiMatch[1];
  } else {
    const boardsHostMatch = value.match(/boards\.greenhouse\.io\/([^/?#]+)/i);
    if (boardsHostMatch?.[1]) {
      value = boardsHostMatch[1];
    } else if (/^https?:\/\//i.test(value)) {
      try {
        const pathname = new URL(value).pathname.replace(/^\/+/, '');
        const segment = pathname.split('/')[0];
        if (segment) {
          value = segment;
        }
      } catch {
        // keep value as-is
      }
    }
  }

  return value.trim().toLowerCase();
}

/**
 * True when the criteria string enables prospect posts (`internal_job_id` null).
 */
export function parseGreenhouseIncludeProspects(raw: string | undefined): boolean {
  if (!raw?.trim()) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

/**
 * Resolves normalized scrape criteria from stored sourceCriteria.
 */
export function resolveGreenhouseSearchCriteria(
  sourceCriteria?: Record<string, string>
): GreenhouseSearchCriteria {
  return {
    boardToken: normalizeGreenhouseBoardToken(sourceCriteria?.boardToken),
    keyword: sourceCriteria?.keyword?.trim() ?? '',
    department: sourceCriteria?.department?.trim() ?? '',
    office: sourceCriteria?.office?.trim() ?? '',
    includeProspects: parseGreenhouseIncludeProspects(sourceCriteria?.includeProspects),
  };
}

function matchesSubstring(haystack: string, needle: string): boolean {
  if (!needle) {
    return true;
  }
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function entityNames(entities: GreenhouseNamedEntity[] | undefined): string[] {
  if (!entities?.length) {
    return [];
  }
  return entities.map((e) => e.name?.trim() ?? '').filter(Boolean);
}

/**
 * Client-side filters for jobs returned from `GET .../jobs?content=true`.
 */
export function filterGreenhouseJobs(
  jobs: GreenhouseJobListItem[],
  criteria: GreenhouseSearchCriteria,
  options?: { plainContentByJobId?: Map<number, string> }
): GreenhouseJobListItem[] {
  return jobs.filter((job) => {
    if (!criteria.includeProspects && job.internal_job_id == null) {
      return false;
    }

    if (criteria.department) {
      const names = entityNames(job.departments);
      if (!names.some((name) => matchesSubstring(name, criteria.department))) {
        return false;
      }
    }

    if (criteria.office) {
      const names = entityNames(job.offices);
      if (!names.some((name) => matchesSubstring(name, criteria.office))) {
        return false;
      }
    }

    if (criteria.keyword) {
      const locationName = job.location?.name ?? '';
      const plainContent = options?.plainContentByJobId?.get(job.id) ?? job.content ?? '';
      const blob = `${job.title}\n${locationName}\n${plainContent}`;
      if (!matchesSubstring(blob, criteria.keyword)) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Formats Greenhouse criteria for queue/history display.
 */
export function formatGreenhouseCriteriaForDisplay(
  sourceCriteria: Record<string, string> | undefined
): string {
  const resolved = resolveGreenhouseSearchCriteria(sourceCriteria);
  if (!resolved.boardToken) {
    return '—';
  }
  const parts = [`board: ${resolved.boardToken}`];
  if (resolved.keyword) {
    parts.push(`keyword: ${resolved.keyword}`);
  }
  if (resolved.department) {
    parts.push(`dept: ${resolved.department}`);
  }
  if (resolved.office) {
    parts.push(`office: ${resolved.office}`);
  }
  if (resolved.includeProspects) {
    parts.push('prospects');
  }
  return parts.join(' | ');
}
