/**
 * Extracts a JSON array of ranking results from Cursor CLI or model stdout.
 */
export function extractRankingJsonFromText(stdout: string): unknown | null {
  const text = stdout.trim();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    // continue
  }

  const envelope = tryParseCliJsonEnvelope(text);
  if (envelope != null) {
    try {
      return JSON.parse(envelope) as unknown;
    } catch {
      const fromFence = extractJsonArrayFromMarkdown(envelope);
      if (fromFence != null) {
        return fromFence;
      }
    }
  }

  return extractJsonArrayFromMarkdown(text);
}

function tryParseCliJsonEnvelope(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { type?: string; subtype?: string; result?: string };
    if (parsed.type === 'result' && typeof parsed.result === 'string') {
      return parsed.result.trim();
    }
  } catch {
    // not envelope
  }
  return null;
}

function extractJsonArrayFromMarkdown(text: string): unknown | null {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1]!.trim() : text;

  const arrayStart = candidate.indexOf('[');
  const arrayEnd = candidate.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    try {
      return JSON.parse(candidate.slice(arrayStart, arrayEnd + 1)) as unknown;
    } catch {
      return null;
    }
  }

  return null;
}
