export type LinkedInSearchCriteria = {
  search: string;
  location: string;
  geoId: string;
};

/**
 * Resolves LinkedIn run criteria for scraping. When both `geoId` and `location` are set,
 * `geoId` wins and `location` is ignored so URL/search navigation stays consistent.
 */
export function resolveLinkedInSearchCriteria(
  sourceCriteria?: Record<string, string>
): LinkedInSearchCriteria {
  const search = sourceCriteria?.search?.trim() ?? '';
  const geoId = sourceCriteria?.geoId?.trim() ?? '';
  const location = geoId.length > 0 ? '' : (sourceCriteria?.location?.trim() ?? '');
  return { search, location, geoId };
}
