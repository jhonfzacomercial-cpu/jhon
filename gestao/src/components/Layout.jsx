import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Sun, Moon, Monitor, LayoutDashboard, CalendarCheck, ListTodo, Briefcase, BellRing, Users, MessagesSquare, History,
  Settings, Search, Plus, Menu as MenuIcon, Sunrise, UserPlus,
} from 'lucide-react';
import { useStore, useDados } from '../lib/store.jsx';
import { Busca } from './Busca.jsx';
import { ModaisGlobais } from './forms.jsx';
import { DetalhesGlobais } from './detalhes.jsx';
import { Menu } from './ui.jsx';
import * as f from '../lib/formato.js';
import { hoje } from '../../shared/constantes.js';

function lerTema() {
  try { return localStorage.getItem('fza-tema') || 'auto'; } catch { return 'auto'; }
}
function aplicarTema(t) {
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try { localStorage.setItem('fza-tema', t); } catch { /* sem storage */ }
}

export function Layout() {
  const { abrir, toasts, semNuvem } = useStore();
  const nav = useNavigate();
  const loc = useLocation();
  const [busca, setBusca] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);
  const [tema, setTema] = useState(lerTema);
  const { dados: resumo } = useDados('/resumo');

  useEffect(() => aplicarTema(tema), [tema]);
  useEffect(() => setMenuAberto(false), [loc.pathname]);

  useEffect(() => {
    const tecla = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setBusca(true); return; }
      const alvo = e.target;
      if (alvo.closest('input, textarea, select, [contenteditable], .overlay') || e.ctrlKey || e.metaKey || e.altKey) return;
      const acoes = { '/': () => setBusca(true), t: () => abrir('tarefa'), c: () => abrir('cobranca'), j: () => abrir('job'), d: () => nav('/daily') };
      const fn = acoes[e.key.toLowerCase()];
      if (fn) { e.preventDefault(); fn(); }
    };
    document.addEventListener('keydown', tecla);
    return () => document.removeEventListener('keydown', tecla);
  }, [abrir, nav]);

  const k = resumo?.kpis;
  const dailysPendentes = resumo?.dailys.filter((d) => !d.daily).length;
  const oooPendentes = resumo?.oooProximos.filter((o) => o.data <= hoje()).length;
  const links = [
    ['Principal'],
    ['/', 'Meu Dia', Sunrise],
    ['/painel', 'Painel gerencial', LayoutDashboard, k?.atrasados],
    ['Rotina'],
    ['/daily', 'Daily', CalendarCheck, dailysPendentes],
    ['/agenda', 'Minha Agenda', ListTodo],
    ['/jobs', 'JOBs', Briefcase, resumo?.jobsAtrasados.length],
    ['/cobrancas', 'Cobranças', BellRing, k?.cobrar],
    ['Pessoas'],
    ['/equipe', 'Equipe', Users],
    ['/one-a-one', 'One a One', MessagesSquare, oooPendentes],
    ['Registro'],
    ['/historico', 'Histórico', History],
    ['/config', 'Configurações', Settings],
  ];
  const proxTema = { auto: 'light', light: 'dark', dark: 'auto' };
  const IconeTema = { auto: Monitor, light: Sun, dark: Moon }[tema];

  return (
    <div className="app">
      <aside className={`sidebar ${menuAberto ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div className="brand-name">FZA Gestão<small>Painel do gerente</small></div>
        </div>
        {links.map(([to, rot, Ic, n]) => (Ic ? (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <Ic />{rot}{n > 0 && <span className="nav-count">{n}</span>}
          </NavLink>
        ) : <div key={to} className="nav-sec">{to}</div>))}
        <div className="sidebar-foot">
          <span>Jhonatas · Gerente</span>
          <button onClick={() => setTema(proxTema[tema])} title={`Tema: ${tema === 'auto' ? 'automático' : tema === 'light' ? 'claro' : 'escuro'}`} aria-label="Alternar tema"><IconeTema size={16} /></button>
        </div>
      </aside>
      {menuAberto && <div className="sidebar-backdrop" onClick={() => setMenuAberto(false)} />}

      <div className="main">
        <header className="topbar">
          <button className="btn ghost icon menu-btn" onClick={() => setMenuAberto(true)} aria-label="Abrir menu"><MenuIcon /></button>
          <button className="search-trigger" onClick={() => setBusca(true)}>
            <Search size={16} /><span className="ellipsis">Buscar JOB, pessoa, tarefa…</span><kbd>Ctrl K</kbd>
          </button>
          <span className="topbar-date">{f.dataLonga(hoje())}</span>
          <Menu botao={(toggle) => <button className="btn primary" onClick={toggle}><Plus /> <span className="hide-mobile">Novo</span></button>}>
            <button onClick={() => abrir('tarefa')}><ListTodo /> Tarefa <kbd>T</kbd></button>
            <button onClick={() => abrir('cobranca')}><BellRing /> Cobrança <kbd>C</kbd></button>
            <button onClick={() => abrir('job')}><Briefcase /> JOB <kbd>J</kbd></button>
            <button onClick={() => nav('/daily')}><CalendarCheck /> Daily <kbd>D</kbd></button>
            <button onClick={() => abrir('colaborador')}><UserPlus /> Colaborador</button>
          </Menu>
        </header>
        <main className="content">
          {semNuvem && <div className="card card-pad small" style={{ marginBottom: 16, borderColor: 'var(--orange)', background: 'var(--orange-soft)' }}>⚠️ Esta visualização não consegue salvar na nuvem. O que você fizer aqui some ao fechar a página. Abra o sistema pelo link do claude.ai, logado na sua conta.</div>}
          <Outlet />
        </main>
      </div>

      {busca && <Busca onClose={() => setBusca(false)} />}
      <ModaisGlobais />
      <DetalhesGlobais />
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.tipo}`}>{t.texto}</div>)}
      </div>
    </div>
  );
}
