import { useEffect, useRef, type ReactNode } from 'react';
import { ApiError } from '../lib/api';
import { UNAVAILABLE, fmtDateTime, fmtPct, fmtSigned, type Tone } from '../lib/format';
import type { NetChange } from '../lib/types';

// Ícones discretos em traço (24×24).
const PATHS: Record<string, string> = {
  overview: 'M3 13h8V3H3zm10 8h8V11h-8zM3 21h8v-6H3zm10-18v6h8V3z',
  clients: 'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0zM4 21a8 8 0 0 1 16 0',
  growth: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  posts: 'M4 4h16v16H4zM4 15l4-4 4 4 3-3 5 5',
  alerts: 'M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6zM10 19a2 2 0 0 0 4 0',
  runs: 'M12 7v5l3 3M21 12a9 9 0 1 1-9-9',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.1a2 2 0 1 1 0 4h-.1z',
  refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  plus: 'M12 5v14M5 12h14',
  download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  menu: 'M3 6h18M3 12h18M3 18h18',
  logout: 'M15 4h4v16h-4M10 17l5-5-5-5M15 12H3',
  info: 'M12 8h.01M11 12h1v5h1M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z',
  check: 'M5 12l5 5 9-10',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  x: 'M6 6l12 12M18 6L6 18',
};

export function Icon({ name, size = 18 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? PATHS.info} />
    </svg>
  );
}

const TONE_ICON: Record<Tone, string> = { good: 'check', warning: 'alert', serious: 'alert', critical: 'alert', neutral: 'info', info: 'info' };

// Estado sempre com ícone + texto (cor nunca sozinha).
export function Badge({ tone, children, icon = true }: { tone: Tone; children: ReactNode; icon?: boolean }) {
  return (
    <span className={`badge badge-${tone}`}>
      {icon && <Icon name={TONE_ICON[tone]} size={13} />}
      {children}
    </span>
  );
}

export function DemoBadge() {
  return (
    <span className="badge badge-demo" title="Dados sintéticos de demonstração — não são do Instagram">
      DEMO
    </span>
  );
}

export function Loading({ label = 'Carregando…' }: { label?: string }) {
  return (
    <div className="state state-loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state state-empty">
      <strong>{title}</strong>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = error instanceof ApiError || error instanceof Error ? error.message : 'Erro inesperado.';
  return (
    <div className="state state-error" role="alert">
      <Icon name="alert" />
      <span>{msg}</span>
      {onRetry && (
        <button className="btn btn-sm" onClick={onRetry}>
          Tentar novamente
        </button>
      )}
    </div>
  );
}

// Guarda: carregando / erro / conteúdo.
export function Async<T>({ q, children }: { q: { data?: T; error?: unknown; loading: boolean; reload: () => void }; children: (d: T) => ReactNode }) {
  if (q.error && !q.data) return <ErrorState error={q.error} onRetry={q.reload} />;
  if (!q.data) return <Loading />;
  return <>{children(q.data)}</>;
}

export function NotAvailable({ reason }: { reason?: string }) {
  return (
    <span className="na" title={reason}>
      {reason ?? 'Não disponível'}
    </span>
  );
}

// Variação líquida com sinal; indisponibilidade nunca vira zero.
export function Change({ c, showPct = true }: { c: NetChange; showPct?: boolean }) {
  if (c.absolute == null) return <NotAvailable reason={UNAVAILABLE[c.unavailable ?? 'no_data']} />;
  const cls = c.absolute > 0 ? 'pos' : c.absolute < 0 ? 'neg' : 'zero';
  const title = c.from && c.to ? `De ${fmtDateTime(c.from.observedAt)} a ${fmtDateTime(c.to.observedAt)}` : undefined;
  return (
    <span className={`chg ${cls}`} title={title}>
      <span className="chg-arrow" aria-hidden="true">{c.absolute > 0 ? '▲' : c.absolute < 0 ? '▼' : '●'}</span>
      {fmtSigned(c.absolute)}
      {showPct && (
        <small>{c.percent != null ? ` (${fmtPct(c.percent)})` : c.percentUnavailable ? ` (${UNAVAILABLE[c.percentUnavailable]})` : ''}</small>
      )}
    </span>
  );
}

export function Kpi({ label, value, hint, accent, children }: { label: string; value: ReactNode; hint?: ReactNode; accent?: boolean; children?: ReactNode }) {
  return (
    <div className={`card kpi ${accent ? 'kpi-accent' : ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {hint && <div className="kpi-hint">{hint}</div>}
      {children}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  return (
    <nav className="pagination" aria-label="Paginação">
      <span className="muted">
        {(page - 1) * pageSize + 1}–{Math.min(total, page * pageSize)} de {total}
      </span>
      <button className="btn btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Anterior
      </button>
      <span>
        {page}/{pages}
      </span>
      <button className="btn btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Próxima
      </button>
    </nav>
  );
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={ref} className="modal" onClose={onClose} onCancel={onClose}>
      <header className="modal-head">
        <h2>{title}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Fechar">
          <Icon name="x" />
        </button>
      </header>
      <div className="modal-body">{children}</div>
      {footer && <footer className="modal-foot">{footer}</footer>}
    </dialog>
  );
}

export function SortHeader({ label, k, sort, dir, onSort }: { label: string; k: string; sort: string; dir: 'asc' | 'desc'; onSort: (k: string) => void }) {
  const active = sort === k;
  return (
    <th aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button className="th-sort" onClick={() => onSort(k)}>
        {label}
        <span aria-hidden="true">{active ? (dir === 'asc' ? ' ↑' : ' ↓') : ' ↕'}</span>
      </button>
    </th>
  );
}

export function Avatar({ url, name }: { url: string | null; name: string }) {
  return url ? (
    <img className="avatar" src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} />
  ) : (
    <span className="avatar avatar-fallback" aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
