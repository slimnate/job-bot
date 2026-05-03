import { useMemo, useState } from 'react';
import { useQuery } from 'convex/react';

import { api } from '../../../../convex/_generated/api.js';
import { PostingTable } from './PostingTable';

type PostingSort = 'discoveredAtDesc' | 'postedAtDesc' | 'scoreDesc';

export function PostingViewer() {
  const totalPostings = useQuery(api.postings.count);
  const [postingQuery, setPostingQuery] = useState('');
  const [postingSource, setPostingSource] = useState('');
  const [postingSort, setPostingSort] = useState<PostingSort>('scoreDesc');
  const [postingMinScore, setPostingMinScore] = useState('');

  const postings = useQuery(api.postings.list, {
    query: postingQuery.trim() || undefined,
    source: postingSource.trim() || undefined,
    minScore: postingMinScore.trim() ? Number(postingMinScore) : undefined,
    sort: postingSort,
    limit: 100,
  });

  const postingSources = useMemo(() => {
    if (!postings) {
      return [];
    }
    return Array.from(new Set(postings.map((posting) => posting.source))).sort();
  }, [postings]);

  return (
    <section className='panel'>
      <div className='panel-heading'>
        <div>
          <h2>Ranked Postings</h2>
          {totalPostings !== undefined ? (
            <p className='panel-subtitle tight'>{totalPostings} total in database</p>
          ) : null}
        </div>
      </div>
      <div className='filters'>
        <input
          value={postingQuery}
          onChange={(event) => setPostingQuery(event.target.value)}
          placeholder='Search title, company, location'
        />
        <select value={postingSource} onChange={(event) => setPostingSource(event.target.value)}>
          <option value=''>All sources</option>
          {postingSources.map((source) => (
            <option value={source} key={source}>
              {source}
            </option>
          ))}
        </select>
        <input
          value={postingMinScore}
          onChange={(event) => setPostingMinScore(event.target.value)}
          placeholder='Min score'
          type='number'
          min={0}
          max={100}
        />
        <select value={postingSort} onChange={(event) => setPostingSort(event.target.value as PostingSort)}>
          <option value='scoreDesc'>Score (desc)</option>
          <option value='discoveredAtDesc'>Discovered (newest)</option>
          <option value='postedAtDesc'>Posted (newest)</option>
        </select>
      </div>
      <PostingTable
        postings={postings}
        emptyMessage={postings === undefined ? 'Loading…' : 'No postings match these filters.'}
      />
    </section>
  );
}
