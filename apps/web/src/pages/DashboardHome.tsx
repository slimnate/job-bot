import { Link } from 'react-router-dom';
import { usePaginatedQuery, useQuery } from 'convex/react';

import { api } from '../../../../convex/_generated/api.js';
import { PostingTable } from '../components/PostingTable';

export function DashboardHome() {
  const totalPostings = useQuery(api.postings.count);
  const { results: previewPostings, isLoading: previewLoading } = usePaginatedQuery(
    api.postings.listPage,
    { sort: 'scoreDesc', pageSize: 10 },
    { initialNumItems: 10 }
  );

  return (
    <>
      <section className='panel dashboard-intro'>
        <p className='dashboard-lede'>
          Overview of your highest-scored job postings.{' '}
          {totalPostings !== undefined ? (
            <span className='dashboard-count'>
              <strong>{totalPostings}</strong> total {totalPostings === 1 ? 'posting' : 'postings'} in the database.
            </span>
          ) : (
            <span className='dashboard-count-muted'>Loading count…</span>
          )}
        </p>
        <ul className='dashboard-links'>
          <li>
            <Link to='/postings'>All ranked postings</Link>
            <span className='dashboard-links-hint'>Search, filter, and sort the full list.</span>
          </li>
          <li>
            <Link to='/evaluators'>Evaluators</Link>
            <span className='dashboard-links-hint'>
              Multiple evaluator profiles, resume context, and ranking instructions for the LLM.
            </span>
          </li>
          <li>
            <Link to='/sources'>Sources</Link>
            <span className='dashboard-links-hint'>Manage enabled sources and reusable source presets.</span>
          </li>
          <li>
            <Link to='/workers'>Workers</Link>
            <span className='dashboard-links-hint'>Runs, stats, and manual triggers.</span>
          </li>
        </ul>
      </section>

      <section className='panel'>
        <div className='panel-heading'>
          <h2>Top postings by score</h2>
        </div>
        <p className='panel-subtitle'>Showing up to 10. Visit ranked postings for the full list.</p>
        <PostingTable
          postings={previewPostings}
          emptyMessage={previewLoading && !previewPostings.length ? 'Loading…' : 'No postings yet.'}
        />
        <p className='dashboard-more'>
          <Link to='/postings'>View all ranked postings →</Link>
        </p>
      </section>
    </>
  );
}
