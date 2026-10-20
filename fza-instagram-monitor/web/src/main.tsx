import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { LoginPage } from './pages/Login';
import { OverviewPage } from './pages/Overview';
import { ClientsPage } from './pages/Clients';
import { ClientDetailPage } from './pages/ClientDetail';
import { GrowthPage } from './pages/Growth';
import { PostsPage } from './pages/Posts';
import { AlertsPage } from './pages/Alerts';
import { RunsPage } from './pages/Runs';
import { SettingsPage } from './pages/Settings';
import './styles.css';

function Protected() {
  const { user, ready } = useAuth();
  if (!ready) return <Loading label="Verificando sessão…" />;
  if (!user) return <Navigate to="/login" replace />;
  return <Layout />;
}

function App() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route element={<Protected />}>
        <Route index element={<OverviewPage />} />
        <Route path="clientes" element={<ClientsPage />} />
        <Route path="clientes/:id" element={<ClientDetailPage />} />
        <Route path="crescimento" element={<GrowthPage />} />
        <Route path="publicacoes" element={<PostsPage />} />
        <Route path="alertas" element={<AlertsPage />} />
        <Route path="coletas" element={<RunsPage />} />
        <Route path="configuracoes" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
