/** Options for HTTP inline ranking prompts (description truncation). */
export type RankingPromptOptions = {
  descriptionMaxChars: number;
  omitUrl?: boolean;
};

export const DEFAULT_DESCRIPTION_MAX_CHARS = 4096;
