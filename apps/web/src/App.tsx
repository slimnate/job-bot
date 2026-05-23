import { Navigate, Route, Routes, useParams } from 'react-router-dom';

import { AppLayout } from './components/AppLayout';
import { EvaluatorsEditor } from './components/EvaluatorsEditor';
import { HistoryViewer } from './components/HistoryViewer';
import { PostingViewer } from './components/PostingViewer';
import { SourcesManager } from './components/SourcesManager';
import { DashboardHome } from './pages/DashboardHome';
import { RunDetailPage } from './pages/RunDetailPage';
import {
  SettingsIndexRedirect,
  SettingsLayout,
} from './pages/SettingsLayout';
import { SettingsOverviewPage } from './pages/SettingsOverviewPage';
import { SettingsSectionPage } from './pages/SettingsSectionPage';

function LegacyRunRedirect() {
  const { runId } = useParams<{ runId: string }>();
  return <Navigate to={runId ? `/workers/runs/${runId}` : '/workers'} replace />;
}

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardHome />} />
        <Route path='evaluators' element={<EvaluatorsEditor />} />
        <Route path='settings' element={<SettingsLayout />}>
          <Route index element={<SettingsIndexRedirect />} />
          <Route path='overview' element={<SettingsOverviewPage />} />
          <Route path=':sectionSlug' element={<SettingsSectionPage />} />
        </Route>
        <Route path='criteria' element={<Navigate to='/evaluators' replace />} />
        <Route path='sources' element={<SourcesManager />} />
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
