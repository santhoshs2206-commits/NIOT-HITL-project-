import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Layout from './components/layout/Layout';
import Dashboard from './pages/Dashboard';
import Upload from './pages/Upload';
import Workspace from './pages/Workspace';
import DatasetStatus from './pages/DatasetStatus';
import YoloTraining from './pages/YoloTraining';
import DetectionPage from './pages/DetectionPage';
import NotFound from './pages/NotFound';

// Initialize React Query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="upload" element={<Upload />} />
            <Route path="workspace" element={<Workspace />} />
            <Route path="status" element={<DatasetStatus />} />
            <Route path="training" element={<YoloTraining />} />
            <Route path="detection" element={<DetectionPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
};

export default App;
