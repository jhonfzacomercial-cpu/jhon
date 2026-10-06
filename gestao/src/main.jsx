import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './styles.css';
import { api, definirAoNaoAutenticado } from './lib/api.js';
import { StoreProvider } from './lib/store.jsx';
import { Layout } from './components/Layout.jsx';
import { Login } from './pages/Login.jsx';
import { MeuDia } from './pages/MeuDia.jsx';
import { Painel } from './pages/Painel.jsx';
import { Agenda } from './pages/Agenda.jsx';
import { Jobs } from './pages/Jobs.jsx';
import { JobDetalhe } from './pages/JobDetalhe.jsx';
import { Daily } from './pages/Daily.jsx';
import { Cobrancas } from './pages/Cobrancas.jsx';
import { Equipe } from './pages/Equipe.jsx';
import { Perfil } from './pages/Perfil.jsx';
import { OneAOnes } from './pages/OneAOnes.jsx';
import { OneAOne } from './pages/OneAOne.jsx';
import { Historico } from './pages/Historico.jsx';
import { Config } from './pages/Config.jsx';

function App() {
  const [meta, setMeta] = useState(null);
  const [login, setLogin] = useState(false);
  const carregar = () => api.get('/meta').then((m) => { setMeta(m); setLogin(false); }).catch(() => {});
  useEffect(() => {
    definirAoNaoAutenticado(() => setLogin(true));
    carregar();
  }, []);
  if (login) return <Login onOk={carregar} />;
  if (!meta) return null;
  return (
    <StoreProvider meta={meta}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<MeuDia />} />
            <Route path="painel" element={<Painel />} />
            <Route path="agenda" element={<Agenda />} />
            <Route path="jobs" element={<Jobs />} />
            <Route path="jobs/:id" element={<JobDetalhe />} />
            <Route path="daily" element={<Daily />} />
            <Route path="cobrancas" element={<Cobrancas />} />
            <Route path="equipe" element={<Equipe />} />
            <Route path="equipe/:id" element={<Perfil />} />
            <Route path="one-a-one" element={<OneAOnes />} />
            <Route path="one-a-one/:id" element={<OneAOne />} />
            <Route path="historico" element={<Historico />} />
            <Route path="config" element={<Config />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </StoreProvider>
  );
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
