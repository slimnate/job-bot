/**
 * Extracts a ranking results JSON array from Cursor CLI prose or fenced blocks.
 */
export function parseRankingResultsFromText(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const tryParseArray = (candidate: string): unknown | null => {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (Array.isArray(parsed)) {
        return parsed;
      }
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        if (Array.isArray(record.rankings)) {
          return record.rankings;
        }
        if (Array.isArray(record.results)) {
          return record.results;
        }
      }
    } catch {
      return null;
    }
    return null;
  };

  const direct = tryParseArray(trimmed);
  if (direct) {
    return direct;
  }

  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = fenceRe.exec(trimmed)) !== null) {
    const fenced = tryParseArray(fenceMatch[1]!.trim());
    if (fenced) {
      return fenced;
    }
  }

  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start >= 0 && end > start) {
    return tryParseArray(trimmed.slice(start, end + 1));
  }

  return null;
}
