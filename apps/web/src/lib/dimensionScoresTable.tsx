import { RANKING_DIMENSION_KEYS, RANKING_DIMENSION_MAX, type RankingDimensionKey } from '@job-bot/shared';

const DIMENSION_LABELS: Record<RankingDimensionKey, string> = {
  technicalFit: 'Technical',
  levelRealism: 'Level',
  workStyleScope: 'Work style',
  compensationTransparency: 'Comp',
  locationLogistics: 'Location',
  missionResonance: 'Mission',
  processRedFlags: 'Process',
};

export type DimensionScoresRecord = Partial<Record<RankingDimensionKey, number>>;

/**
 * Returns dimension keys present on a scores object in canonical rubric order.
 */
export function orderedDimensionKeys(scores: DimensionScoresRecord | undefined | null): RankingDimensionKey[] {
  if (!scores) {
    return [];
  }
  return RANKING_DIMENSION_KEYS.filter((key) => typeof scores[key] === 'number');
}

/**
 * Compact horizontal rubric strip from `dimensionScoresJson` (list view, no reasoning fetch).
 */
export function DimensionScoresCompactTable({
  scores,
  getScoreColorClass,
}: {
  scores: DimensionScoresRecord;
  getScoreColorClass: (score?: number | null) => string;
}) {
  const keys = orderedDimensionKeys(scores);
  if (!keys.length) {
    return null;
  }

  const scoreCellToPercent = (earned: number, max: number): number | null => {
    if (max > 0 && !Number.isNaN(earned)) {
      return (earned / max) * 100;
    }
    return null;
  };

  return (
    <div className='posting-score-table-scroll'>
      <table className='posting-score-table posting-score-table--compact'>
        <thead>
          <tr>
            {keys.map((key) => (
              <th key={key} scope='col'>
                {DIMENSION_LABELS[key]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {keys.map((key) => {
              const earned = scores[key]!;
              const max = RANKING_DIMENSION_MAX[key];
              const label = `${earned}/${max}`;
              return (
                <td key={key} className={getScoreColorClass(scoreCellToPercent(earned, max))}>
                  {label}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
