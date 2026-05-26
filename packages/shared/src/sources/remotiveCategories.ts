/**
 * Remotive RSS category catalog (slugs from GET https://remotive.com/api/remote-jobs/categories).
 * Feed URLs: https://remotive.com/remote-jobs/{slug}/feed
 */

export const REMOTIVE_ALL_JOBS_FEED_URL = 'https://remotive.com/remote-jobs/feed';

export type RemotiveCategory = {
  slug: string;
  label: string;
  feedUrl: string;
};

const REMOTIVE_CATEGORY_ROWS: ReadonlyArray<{ slug: string; label: string }> = [
  { slug: 'software-development', label: 'Software Development' },
  { slug: 'customer-service', label: 'Customer Service' },
  { slug: 'design', label: 'Design' },
  { slug: 'marketing', label: 'Marketing' },
  { slug: 'sales', label: 'Sales' },
  { slug: 'product', label: 'Product Management' },
  { slug: 'project-management', label: 'Project Management' },
  { slug: 'artificial-intelligence', label: 'Artificial Intelligence' },
  { slug: 'data', label: 'Data and Analytics' },
  { slug: 'devops', label: 'Devops' },
  { slug: 'finance', label: 'Finance' },
  { slug: 'human-resources', label: 'Human Resources' },
  { slug: 'qa', label: 'Quality Assurance' },
  { slug: 'writing', label: 'Writing' },
  { slug: 'legal', label: 'Legal' },
  { slug: 'medical', label: 'Medical' },
  { slug: 'education', label: 'Teaching' },
  { slug: 'account-management', label: 'Account Management' },
  { slug: 'business-development', label: 'Business Development' },
  { slug: 'communications', label: 'Communications' },
  { slug: 'compliance', label: 'Compliance' },
  { slug: 'engineering', label: 'Engineering' },
  { slug: 'information-technology', label: 'Information Technology' },
  { slug: 'knowledge-management', label: 'Knowledge Management' },
  { slug: 'operations', label: 'Operations' },
  { slug: 'research', label: 'Research' },
  { slug: 'strategy', label: 'Strategy' },
  { slug: 'supply-chain', label: 'Supply Chain' },
  { slug: 'travel-hospitality', label: 'Travel and Hospitality' },
  { slug: 'all-others', label: 'All others' },
];

function buildFeedUrl(slug: string): string {
  return `https://remotive.com/remote-jobs/${slug}/feed`;
}

/** All Remotive job categories with RSS feed URLs. */
export const REMOTIVE_CATEGORIES: readonly RemotiveCategory[] = REMOTIVE_CATEGORY_ROWS.map(
  (row) => ({
    ...row,
    feedUrl: buildFeedUrl(row.slug),
  })
);

const slugSet = new Set(REMOTIVE_CATEGORIES.map((c) => c.slug));

/**
 * Returns the category entry for a slug, or undefined if unknown.
 */
export function getRemotiveCategoryBySlug(slug: string): RemotiveCategory | undefined {
  const normalized = slug.trim().toLowerCase();
  return REMOTIVE_CATEGORIES.find((c) => c.slug === normalized);
}

/**
 * Builds feed URLs for the given category slugs (unknown slugs omitted).
 */
export function buildRemotiveFeedUrls(slugs: string[]): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const raw of slugs) {
    const category = getRemotiveCategoryBySlug(raw);
    if (!category || seen.has(category.feedUrl)) {
      continue;
    }
    seen.add(category.feedUrl);
    urls.push(category.feedUrl);
  }
  return urls;
}

/**
 * Parses a comma-separated categories criteria string into unique valid slugs (sorted).
 */
export function parseRemotiveCategorySlugs(categoriesRaw: string | undefined): string[] {
  if (!categoriesRaw?.trim()) {
    return [];
  }
  const parts = categoriesRaw.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
  const unique = [...new Set(parts)];
  return unique.filter((slug) => slugSet.has(slug)).sort();
}

/**
 * Normalizes categories criteria: validates slugs, throws on unknown, returns comma-separated string or empty.
 */
export function normalizeRemotiveCategoriesCriteria(
  categoriesRaw: string | undefined
): string {
  if (!categoriesRaw?.trim()) {
    return '';
  }
  const parts = categoriesRaw
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  const unique = [...new Set(parts)];
  const invalid = unique.filter((slug) => !slugSet.has(slug));
  if (invalid.length > 0) {
    throw new Error(
      `Unknown Remotive categor${invalid.length === 1 ? 'y' : 'ies'}: ${invalid.join(', ')}.`
    );
  }
  return unique.sort().join(',');
}

/**
 * Human-readable labels for a normalized categories string; empty → "All jobs".
 */
export function formatRemotiveCategoriesForDisplay(categoriesRaw: string | undefined): string {
  const slugs = parseRemotiveCategorySlugs(categoriesRaw);
  if (slugs.length === 0) {
    return 'All jobs';
  }
  return slugs
    .map((slug) => getRemotiveCategoryBySlug(slug)?.label ?? slug)
    .join(', ');
}
