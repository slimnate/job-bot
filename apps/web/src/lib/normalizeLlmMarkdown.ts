const TABLE_ROW_RE = /^\s*\|(.+)\|\s*$/;

function isBlank(line: string): boolean {
  return line.trim() === '';
}

function isTableRow(line: string): boolean {
  return TABLE_ROW_RE.test(line);
}

function isCodeFence(line: string): boolean {
  return /^\s*```/.test(line);
}

function isHeading(line: string): boolean {
  return /^\s{0,3}#{1,6}\s+/.test(line);
}

function isListLine(line: string): boolean {
  return /^\s{0,3}([-*+]|\d+[.)])\s+/.test(line);
}

function isBlockquote(line: string): boolean {
  return /^\s*>/.test(line);
}

/** Indented continuation line for a list item or blockquote. */
function isBlockContinuation(line: string): boolean {
  return /^\s{2,}\S/.test(line);
}

function joinProseLines(lines: string[]): string {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * Joins soft-wrapped LLM prose lines while preserving GFM block structures
 * (tables, lists, headings, code fences, blockquotes).
 */
export function normalizeLlmMarkdown(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return '';
  }

  const lines = normalized.split('\n');
  const blocks: string[] = [];
  let proseBuffer: string[] = [];

  const flushProse = () => {
    if (!proseBuffer.length) {
      return;
    }
    const joined = joinProseLines(proseBuffer);
    if (joined) {
      blocks.push(joined);
    }
    proseBuffer = [];
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;

    if (isBlank(line)) {
      flushProse();
      index += 1;
      while (index < lines.length && isBlank(lines[index]!)) {
        index += 1;
      }
      continue;
    }

    if (isCodeFence(line)) {
      flushProse();
      const start = index;
      index += 1;
      while (index < lines.length && !isCodeFence(lines[index]!)) {
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push(lines.slice(start, index).join('\n'));
      continue;
    }

    if (isTableRow(line)) {
      flushProse();
      const start = index;
      while (index < lines.length && isTableRow(lines[index]!)) {
        index += 1;
      }
      blocks.push(
        lines
          .slice(start, index)
          .map((row) => row.trim())
          .join('\n')
      );
      continue;
    }

    if (isListLine(line)) {
      flushProse();
      const start = index;
      index += 1;
      while (
        index < lines.length &&
        (isListLine(lines[index]!) ||
          (lines[index]!.trim() !== '' && isBlockContinuation(lines[index]!)))
      ) {
        index += 1;
      }
      blocks.push(lines.slice(start, index).join('\n'));
      continue;
    }

    if (isBlockquote(line)) {
      flushProse();
      const start = index;
      index += 1;
      while (
        index < lines.length &&
        (isBlockquote(lines[index]!) ||
          (lines[index]!.trim() !== '' && isBlockContinuation(lines[index]!)))
      ) {
        index += 1;
      }
      blocks.push(lines.slice(start, index).join('\n'));
      continue;
    }

    if (isHeading(line)) {
      flushProse();
      blocks.push(line.trim());
      index += 1;
      continue;
    }

    proseBuffer.push(line);
    index += 1;
  }

  flushProse();
  return blocks.join('\n\n');
}
