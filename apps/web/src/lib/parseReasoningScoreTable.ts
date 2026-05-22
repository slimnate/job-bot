/**
 * Normalizes unknown arrays into display-ready string items.
 */
export function toPillItems(value: unknown): string[] {
  let rawValue = value;
  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        rawValue = JSON.parse(trimmed);
      } catch {
        return [];
      }
    } else {
      return [];
    }
  }
  if (!Array.isArray(rawValue)) {
    return [];
  }
  return rawValue
    .map((item) => {
      if (typeof item === 'string') {
        return item.trim();
      }
      if (item === null || item === undefined) {
        return '';
      }
      return String(item).trim();
    })
    .filter(Boolean);
}

export type ReasoningScoreTableRow = {
  score: string;
  name: string;
  details?: string;
};

/**
 * Parses rubric cell scores like "18/20" into a 0–100 percentage for color coding.
 */
export function scoreCellToPercent(scoreText: string): number | null {
  const trimmed = scoreText.trim();
  const fractionMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (fractionMatch) {
    const earned = Number(fractionMatch[1]);
    const max = Number(fractionMatch[2]);
    if (max > 0 && !Number.isNaN(earned) && !Number.isNaN(max)) {
      return (earned / max) * 100;
    }
  }
  const soloMatch = trimmed.match(/^(\d+(?:\.\d+)?)/);
  if (soloMatch) {
    const value = Number(soloMatch[1]);
    if (!Number.isNaN(value) && value >= 0 && value <= 100) {
      return value;
    }
  }
  return null;
}

export type ParsedReasoningScoreTable = {
  rows: ReasoningScoreTableRow[];
  remainderMarkdown: string;
};

const TABLE_ROW_RE = /^\s*\|(.+)\|\s*$/;

/**
 * Splits a GFM table row into trimmed cell strings.
 */
function parseTableCells(line: string): string[] {
  const match = line.match(TABLE_ROW_RE);
  if (!match) {
    return [];
  }
  return match[1]!.split('|').map((cell) => cell.trim());
}

/**
 * True when the row is a separator like |---|---|.
 */
function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

/**
 * True when a table row or line is the rubric total (shown in the meta score instead).
 */
function isTotalLabel(text: string): boolean {
  const normalized = text.replace(/\*+/g, '').trim();
  return /^total\s*:/i.test(normalized) || /^total\b/i.test(normalized);
}

/**
 * Removes TOTAL lines from markdown left after the score table is stripped.
 */
function stripTotalFromRemainder(markdown: string): string {
  if (!markdown.trim()) {
    return '';
  }
  return markdown
    .split('\n')
    .filter((line) => !isTotalLabel(line.trim()))
    .join('\n')
    .trim();
}

/**
 * Finds the first GFM table block in LLM reasoning markdown (rubric format).
 * Returns parsed rows and markdown with that table removed.
 */
export function parseReasoningScoreTable(markdown: string): ParsedReasoningScoreTable | null {
  const lines = markdown.split('\n');
  let tableStart = -1;
  let tableEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    const cells = parseTableCells(lines[i]!);
    if (cells.length < 2) {
      if (tableStart >= 0 && tableEnd > tableStart) {
        break;
      }
      continue;
    }
    if (tableStart < 0) {
      tableStart = i;
      tableEnd = i + 1;
      continue;
    }
    if (isSeparatorRow(cells)) {
      tableEnd = i + 1;
      continue;
    }
    tableEnd = i + 1;
  }

  if (tableStart < 0 || tableEnd <= tableStart + 1) {
    return null;
  }

  const tableLines = lines.slice(tableStart, tableEnd);
  const headerCells = parseTableCells(tableLines[0]!);
  if (headerCells.length < 2) {
    return null;
  }

  const dataLines = tableLines.filter((line, index) => {
    if (index === 0) {
      return false;
    }
    const cells = parseTableCells(line);
    return cells.length >= 2 && !isSeparatorRow(cells);
  });

  if (dataLines.length === 0) {
    return null;
  }

  const scoreCol = headerCells.findIndex((h) => /score/i.test(h));
  const nameCol = headerCells.findIndex((h) => /criteria|ranking/i.test(h));
  const detailsCol = headerCells.findIndex((h) => /detail/i.test(h));

  const resolvedScoreCol = scoreCol >= 0 ? scoreCol : 0;
  const resolvedNameCol = nameCol >= 0 ? nameCol : scoreCol >= 0 && headerCells.length > 1 ? 1 : 0;
  const resolvedDetailsCol = detailsCol >= 0 ? detailsCol : -1;

  const rows: ReasoningScoreTableRow[] = [];
  for (const line of dataLines) {
    const cells = parseTableCells(line);
    const score = cells[resolvedScoreCol]?.trim() ?? '';
    const name = cells[resolvedNameCol]?.trim() ?? '';
    if (!score && !name) {
      continue;
    }
    if (isTotalLabel(name) || isTotalLabel(score)) {
      continue;
    }
    const details =
      resolvedDetailsCol >= 0 ? cells[resolvedDetailsCol]?.trim() : undefined;
    rows.push({
      score,
      name,
      details: details && details.length > 0 ? details : undefined,
    });
  }

  if (rows.length === 0) {
    return null;
  }

  const remainderLines = [...lines.slice(0, tableStart), ...lines.slice(tableEnd)];
  const remainderMarkdown = stripTotalFromRemainder(remainderLines.join('\n'));

  return { rows, remainderMarkdown };
}

/** Rubric dimension keys stored redundantly in criteriaMatchJson. */
export const CRITERIA_DIMENSION_SCORE_KEYS = new Set([
  'compensation',
  'hiringProcess',
  'location',
  'mission',
  'roleLevel',
  'technicalFit',
  'workStyle',
]);

/**
 * Whether a criteriaMatchJson entry is a redundant numeric dimension score.
 */
export function isDimensionScoreEntry(key: string, value: unknown): boolean {
  if (CRITERIA_DIMENSION_SCORE_KEYS.has(key)) {
    return true;
  }
  return typeof value === 'number' && !Number.isNaN(value);
}
