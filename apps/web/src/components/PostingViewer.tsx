import { useMemo, useState } from 'react';
import { useQuery } from 'convex/react';

import { api } from '../../../../convex/_generated/api.js';

type PostingSort = 'discoveredAtDesc' | 'postedAtDesc' | 'scoreDesc';

const formatDateTime = (timestamp?: number): string => {
  if (!timestamp) {
    return '-';
  }
  return new Date(timestamp).toLocaleString();
};

export function PostingViewer() {
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
        <h2>Ranked Postings</h2>
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
      <div className='table-wrapper'>
        <table>
          <thead>
            <tr>
              <th>Score</th>
              <th>Role</th>
              <th>Company</th>
              <th>Source</th>
              <th>Location</th>
              <th>Posted</th>
              <th>Discovered</th>
            </tr>
          </thead>
          <tbody>
            {postings?.length ? (
              postings.map((posting) => (
                <tr key={posting._id}>
                  <td>{posting.latestRanking?.scoreOverall ?? '-'}</td>
                  <td>
                    <a href={posting.url} target='_blank' rel='noreferrer'>
                      {posting.title}
                    </a>
                  </td>
                  <td>{posting.company}</td>
                  <td>{posting.source}</td>
                  <td>{posting.location ?? '-'}</td>
                  <td>{formatDateTime(posting.postedAt)}</td>
                  <td>{formatDateTime(posting.discoveredAt)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7}>No postings match these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
