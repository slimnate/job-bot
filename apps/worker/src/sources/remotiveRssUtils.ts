import {
  buildRemotiveFeedUrls,
  parseRemotiveCategorySlugs,
  REMOTIVE_ALL_JOBS_FEED_URL,
} from '@job-bot/shared';

/**
 * Resolves RSS feed URLs from run criteria (empty categories → all-jobs feed).
 */
export function resolveRemotiveFeedUrls(sourceCriteria?: Record<string, string>): string[] {
  const slugs = parseRemotiveCategorySlugs(sourceCriteria?.categories);
  if (slugs.length === 0) {
    return [REMOTIVE_ALL_JOBS_FEED_URL];
  }
  return buildRemotiveFeedUrls(slugs);
}

/**
 * Strips HTML to plain text with paragraph breaks preserved.
 */
export function htmlToPlainText(html: string): string {
  let text = html;
  text = text.replace(/<\/(p|div|li|h[1-6]|br)\s*>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<[^>]+>/g, '');
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line, index, arr) => line.length > 0 || (index > 0 && arr[index - 1]?.length > 0))
    .join('\n')
    .trim();
}

export function textContent(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof value === 'object' && value !== null && '#text' in value) {
    return textContent((value as { '#text': unknown })['#text']);
  }
  return '';
}

export function extractJobIdFromUrl(url: string): string | null {
  const match = url.match(/-(\d+)\/?$/);
  return match?.[1] ?? null;
}

export function feedSlugFromUrl(feedUrl: string): string | null {
  const match = feedUrl.match(/remote-jobs\/([^/]+)\/feed$/);
  return match?.[1] ?? null;
}
