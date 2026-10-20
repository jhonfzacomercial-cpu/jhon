import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Async, Badge, Empty, Pagination } from '../components/ui';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ALERT_TYPE, fmtDateTime } from '../lib/format';
import { useApi } from '../lib/hooks';
import type { Alert, Paged } from '../lib/types';

const SEV = { critical: { tone: 'critical', label: 'Crítico' }, warning: { tone: 'warning', label: 'Atenção' }, info: { tone: 'info', label: 'Informativo' } } as const;
const STATUS = { open: 'Aberto', acknowledged: 'Reconhecido', resolved: 'Resolvido' } as const;

export function AlertsPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState('active');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [status, category]);
  const q = useApi<Paged<Alert> & { counts: Record<string, number> }>(`/api/alerts${qs({ status, category, page })}`, 60_000);
  const [msg, setMsg] = useState<string>();

  async function act(a: Alert, action: 'acknowledge' | 'resolve') {
    try {
      const r = await api<{ silencedHours?: number }>(`/api/alerts/${a.id}/${action}`, { method: 'POST' });
      setMsg(action === 'resolve' ? `Alerta resolvido. O mesmo tipo fica silenciado por ${r.silencedHours} h para este perfil.` : 'Alerta reconhecido.');
      q.reload();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Alertas</h1>
          <p className="muted">Alertas são gerados pelas coletas e pela verificação periódica; não há envio por WhatsApp ou e-mail sem uma integração configurada.</p>
        </div>
      </div>
      <div className="filter-bar">
        <div className="seg" role="group" aria-label="Status">
          {[
            ['active', `Ativos (${(q.data?.counts.open ?? 0) + (q.data?.counts.acknowledged ?? 0)})`],
            ['open', 'Abertos'],
            ['acknowledged', 'Reconhecidos'],
            ['resolved', 'Resolvidos'],
            ['all', 'Todos'],
          ].map(([k, l]) => (
            <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{l}</button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Origem">
          {[
            ['', 'Todas as origens'],
            ['profile', 'Problema do perfil'],
            ['collector', 'Problema do coletor'],
          ].map(([k, l]) => (
            <button key={k} className={category === k ? 'on' : ''} onClick={() => setCategory(k)}>{l}</button>
          ))}
        </div>
      </div>
      {msg && <div className="banner banner-info">{msg}</div>}
      <Async q={q}>
        {(d) =>
          d.total === 0 ? (
            <Empty title="Nenhum alerta com esses filtros." />
          ) : (
            <div className="alert-list">
              {d.items.map((a) => (
                <article key={a.id} className={`card alert-card sev-${a.severity}`}>
                  <div className="alert-top">
                    <Badge tone={SEV[a.severity].tone}>{SEV[a.severity].label}</Badge>
                    <span className="tag">{ALERT_TYPE[a.type] ?? a.type}</span>
                    <span className="tag">{a.category === 'profile' ? 'Perfil' : 'Coletor'}</span>
                    <span className="tag">{STATUS[a.status]}</span>
                    {a.reopened_from && <span className="tag">Reaberto</span>}
                  </div>
                  <h3>{a.title}</h3>
                  <p>{a.message}</p>
                  <small className="muted">
                    <Link to={`/clientes/${a.client_id}`}>{a.client_name}</Link> · criado {fmtDateTime(a.created_at)} · última ocorrência {fmtDateTime(a.last_triggered_at)} · {a.occurrences}× verificado
                    {a.acknowledged_at && ` · reconhecido por ${a.acknowledged_by_name ?? '—'} em ${fmtDateTime(a.acknowledged_at)}`}
                    {a.resolved_at && ` · resolvido ${a.resolution === 'auto' ? 'automaticamente' : `por ${a.resolved_by_name ?? '—'}`} em ${fmtDateTime(a.resolved_at)}`}
                  </small>
                  {can('analyst') && a.status !== 'resolved' && (
                    <div className="alert-actions">
                      {a.status === 'open' && <button className="btn btn-sm" onClick={() => act(a, 'acknowledge')}>Reconhecer</button>}
                      <button className="btn btn-sm" onClick={() => act(a, 'resolve')}>Resolver</button>
                    </div>
                  )}
                </article>
              ))}
              <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
            </div>
          )
        }
      </Async>
    </div>
  );
}
