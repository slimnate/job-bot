import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { normalizeLlmMarkdown } from '../lib/normalizeLlmMarkdown.js';

type MarkdownContentProps = {
  value?: string | null;
  className?: string;
  emptyFallback?: string;
};

/**
 * Renders GitHub-flavored markdown (lists, tables, code fences) for LLM output.
 */
export function MarkdownContent({
  value,
  className,
  emptyFallback = '-',
}: MarkdownContentProps) {
  const content = value ? normalizeLlmMarkdown(value) : '';
  if (!content) {
    return <span className={className}>{emptyFallback}</span>;
  }
  return (
    <div className={className}>
      <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
    </div>
  );
}
