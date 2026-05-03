import { Navigate, Route, Routes } from 'react-router-dom';

import { AppLayout } from './components/AppLayout';
import { CriteriaEditor } from './components/CriteriaEditor';
import { HistoryViewer } from './components/HistoryViewer';
import { PostingViewer } from './components/PostingViewer';
import { DashboardHome } from './pages/DashboardHome';

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<DashboardHome />} />
        <Route path='criteria' element={<CriteriaEditor />} />
        <Route path='postings' element={<PostingViewer />} />
        <Route path='history' element={<HistoryViewer />} />
        <Route path='*' element={<Navigate to='/' replace />} />
      </Route>
    </Routes>
  );
}
