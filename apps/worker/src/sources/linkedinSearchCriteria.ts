export type LinkedInSearchCriteria = {
  search: string;
  location: string;
  /** Single keyword-box query for LinkedIn UI search (`search in location` when both set). */
  uiQuery: string;
};

/**
 * Builds the jobs keyword-box query. Requires a non-empty search term; location is optional.
 * When both are set, uses `"<search> in <location>"`. Location alone returns an empty string.
 */
export function buildLinkedInUiSearchQuery(search: string, location: string): string {
  const trimmedSearch = search.trim();
  if (!trimmedSearch) {
    return '';
  }
  const trimmedLocation = location.trim();
  if (trimmedLocation) {
    return `${trimmedSearch} in ${trimmedLocation}`;
  }
  return trimmedSearch;
}

/**
 * Resolves LinkedIn run criteria. Search is optional (empty → preferences hub).
 * Location is only applied when search is non-empty; otherwise it is ignored.
 */
export function resolveLinkedInSearchCriteria(
  sourceCriteria?: Record<string, string>
): LinkedInSearchCriteria {
  const search = sourceCriteria?.search?.trim() ?? '';
  const locationRaw = sourceCriteria?.location?.trim() ?? '';
  const location = search.length > 0 ? locationRaw : '';
  return {
    search,
    location,
    uiQuery: buildLinkedInUiSearchQuery(search, location),
  };
}
