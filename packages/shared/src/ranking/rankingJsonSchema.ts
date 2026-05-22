/** OpenAI `response_format.json_schema` for per-posting score arrays (no rank field). */
export const rankingJsonSchema = {
  name: 'job_scoring_results',
  schema: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['postingId', 'scoreOverall', 'reasoningSummary', 'criteriaMatch', 'redFlags'],
      properties: {
        postingId: { type: 'string' },
        scoreOverall: { type: 'number', minimum: 0, maximum: 100 },
        reasoningSummary: { type: 'string' },
        criteriaMatch: { type: 'object', additionalProperties: true },
        redFlags: {
          type: 'array',
          items: { type: 'string' },
        },
      },
    },
  },
  strict: true,
} as const;

export const RANKING_SYSTEM_MESSAGE =
  'You score job postings independently for one user profile. Return valid JSON matching the schema. scoreOverall is 0-100 per posting; do not compare postings or assign global ranks.';
