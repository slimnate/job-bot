import { CriteriaEditor } from './components/CriteriaEditor';
import { HistoryViewer } from './components/HistoryViewer';
import { PostingViewer } from './components/PostingViewer';

export function App() {
  return (
    <main className='page'>
      <header className='page-header'>
        <h1>Job Bot Dashboard</h1>
        <p>Manage criteria, browse ranked postings, and track scraping runs.</p>
      </header>
      <CriteriaEditor />
      <PostingViewer />
      <HistoryViewer />
    </main>
  );
}
