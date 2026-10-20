import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { useApi } from '../lib/hooks';
import type { SystemStatus } from '../lib/types';
import { relative } from '../lib/format';
import { Icon } from './ui';

const NAV = [
  { to: '/', label: 'Visão geral', icon: 'overview', end: true },
  { to: '/clientes', label: 'Clientes', icon: 'clients' },
  { to: '/crescimento', label: 'Crescimento', icon: 'growth' },
  { to: '/publicacoes', label: 'Publicações', icon: 'posts' },
  { to: '/alertas', label: 'Alertas', icon: 'alerts' },
  { to: '/coletas', label: 'Histórico de coletas', icon: 'runs' },
  { to: '/configuracoes', label: 'Configurações', icon: 'settings' },
];

export function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const status = useApi<SystemStatus>('/api/system/status', 60_000);
  const alerts = useApi<{ counts: Record<string, number> }>('/api/alerts?pageSize=5', 60_000);
  useEffect(() => setOpen(false), [loc.pathname]);

  const s = status.data;
  const openAlerts = (alerts.data?.counts.open ?? 0) + (alerts.data?.counts.acknowledged ?? 0);
  const banner = !s
    ? null
    : !s.provider || !s.provider.config.configured
      ? { tone: 'critical', text: 'Nenhuma fonte de dados configurada: nenhuma coleta está sendo feita.', link: '/configuracoes' }
      : !s.workerAlive
        ? { tone: 'critical', text: 'O worker de coleta não está respondendo: os dados não estão sendo atualizados.', link: '/configuracoes' }
        : s.providerPause
          ? { tone: 'warning', text: `Coletas pausadas pela fonte (${s.providerPause.reason}) até ${new Date(s.providerPause.paused_until).toLocaleTimeString('pt-BR', { timeZone: 'America/Campo_Grande' })}.`, link: '/configuracoes' }
          : null;

  return (
    <div className={`shell ${open ? 'nav-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">FZA</span>
          <span className="brand-text">
            Instagram Monitor
            <small>Grupo FZA</small>
          </span>
        </div>
        <nav>
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
              {n.to === '/alertas' && openAlerts > 0 && <span className="nav-count">{openAlerts}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          {s && (
            <div className="worker-status" title={s.effectiveFrequency.note}>
              <span className={`dot ${s.workerAlive ? 'dot-ok' : 'dot-bad'}`} aria-hidden="true" />
              {s.workerAlive ? 'Worker ativo' : 'Worker parado'}
              <small>Última coleta ok: {relative(s.lastSuccessAt)}</small>
              <small>Coleta a cada {s.effectiveFrequency.followersIntervalMinutes} min (não é tempo real)</small>
            </div>
          )}
          <div className="user-box">
            <span>
              {user?.name}
              <small>{user?.role === 'admin' ? 'Administrador' : user?.role === 'analyst' ? 'Analista' : 'Visualização'}</small>
            </span>
            <button className="icon-btn" onClick={logout} aria-label="Sair" title="Sair">
              <Icon name="logout" />
            </button>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" onClick={() => setOpen((o) => !o)} aria-label="Abrir menu">
            <Icon name="menu" />
          </button>
          <span className="topbar-title">FZA Instagram Monitor</span>
        </header>
        {banner && (
          <div className={`banner banner-${banner.tone}`} role="alert">
            <Icon name="alert" /> {banner.text} <NavLink to={banner.link}>Ver detalhes</NavLink>
          </div>
        )}
        <main className="content">
          <Outlet />
        </main>
      </div>
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
    </div>
  );
}
