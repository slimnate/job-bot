import { Navigate, Route, Routes, useParams } from 'react-router-dom';

import { AppLayout } from './components/AppLayout';
import { CriteriaEditor } from './components/CriteriaEditor';
import { HistoryViewer } from './components/HistoryViewer';
import { PostingViewer } from './components/PostingViewer';
import { DashboardHome } from './pages/DashboardHome';
import { RunDetailPage } from './pages/RunDetailPage';

function LegacyRunRedirect() {
  const { runId } = useParams<{ runId: string }>();
  return <Navigate to={runId ? `/workers/runs/${runId}` : '/workers'} replace />;
}

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardHome />} />
        <Route path='criteria' element={<CriteriaEditor />} />
        <Route path='postings' element={<PostingViewer />} />
        <Route path='workers' element={<HistoryViewer />} />
        <Route path='workers/runs/:runId' element={<RunDetailPage />} />
        <Route path='history' element={<Navigate to='/workers' replace />} />
        <Route path='history/runs/:runId' element={<LegacyRunRedirect />} />
        <Route path='*' element={<Navigate to='/' replace />} />
      </Route>
    </Routes>
  );
}
