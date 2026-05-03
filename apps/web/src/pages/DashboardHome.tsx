import { Link } from 'react-router-dom';
import { useQuery } from 'convex/react';

import { api } from '../../../../convex/_generated/api.js';
import { PostingTable } from '../components/PostingTable';

export function DashboardHome() {
  const totalPostings = useQuery(api.postings.count);
  const previewPostings = useQuery(api.postings.list, {
    sort: 'scoreDesc',
    limit: 10,
  });

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
            <Link to='/criteria'>Criteria</Link>
            <span className='dashboard-links-hint'>Keywords, locations, and ranking preferences.</span>
          </li>
          <li>
            <Link to='/history'>Scrape history</Link>
            <span className='dashboard-links-hint'>Runs, stats, and manual triggers.</span>
          </li>
        </ul>
      </section>

      <section className='panel'>
        <div className='panel-heading'>
          <h2>Top postings by score</h2>
        </div>
        <p className='panel-subtitle'>Showing up to 10. Visit ranked postings for the full table.</p>
        <PostingTable
          postings={previewPostings}
          emptyMessage={previewPostings === undefined ? 'Loading…' : 'No postings yet.'}
        />
        <p className='dashboard-more'>
          <Link to='/postings'>View all ranked postings →</Link>
        </p>
      </section>
    </>
  );
}
