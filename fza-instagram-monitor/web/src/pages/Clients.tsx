import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApi } from '../lib/hooks';
import { CLIENT_STATUS, PROFILE_STATE, fmtDateTime, fmtInt, relative } from '../lib/format';
import type { Paged, ProfileSummary } from '../lib/types';
import { Async, Avatar, Badge, Change, DemoBadge, Empty, Icon, Modal, NotAvailable, Pagination, SortHeader } from '../components/ui';

export function ClientForm({ initial, onClose, onSaved }: { initial?: ProfileSummary; onClose: () => void; onSaved: (id: string) => void }) {
  const [v, setV] = useState({
    name: initial?.clientName ?? '',
    instagram: initial ? `@${initial.username}` : '',
    category: initial?.category ?? '',
    postingGoalPerWeek: initial?.postingGoalPerWeek?.toString() ?? '',
    inactivityAlertDays: initial?.inactivityAlertDays?.toString() ?? '',
    negativeChangeThreshold: initial?.negativeChangeThreshold?.toString() ?? '',
    growthGoalPct30d: initial?.growthGoalPct30d?.toString() ?? '',
    notes: initial?.notes ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    setErrors({});
    try {
      if (initial) {
        await api(`/api/clients/${initial.clientId}`, { method: 'PATCH', body: v });
        onSaved(initial.clientId);
      } else {
        const r = await api<{ id: string }>('/api/clients', { method: 'POST', body: v });
        onSaved(r.id);
      }
    } catch (err) {
      const ae = err as ApiError;
      setError(ae.message);
      setErrors(Object.fromEntries((ae.body?.issues ?? []).map((i) => [i.path, i.message])));
    } finally {
      setBusy(false);
    }
  }

  const field = (k: keyof typeof v, label: string, props: Record<string, unknown> = {}, hint?: string) => (
    <label className={errors[k] ? 'has-error' : ''}>
      {label}
      <input value={v[k]} onChange={set(k)} {...props} />
      {hint && <small className="muted">{hint}</small>}
      {errors[k] && <small className="field-error">{errors[k]}</small>}
    </label>
  );

  return (
    <Modal
      title={initial ? 'Editar cliente' : 'Adicionar cliente'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} type="button">
            Cancelar
          </button>
          <button className="btn btn-primary" form="client-form" disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      <form id="client-form" className="form-grid" onSubmit={submit}>
        {field('name', 'Nome do cliente *', { required: true, maxLength: 120 })}
        {field('instagram', '@ do Instagram ou URL do perfil *', { required: true, placeholder: '@perfil ou https://instagram.com/perfil' },
          initial ? 'Alterar o @ mantém o histórico (use quando o perfil mudar de nome).' : 'Precisa ser conta profissional (Business ou Creator) para a fonte oficial da Meta.')}
        {field('category', 'Categoria', { maxLength: 60, placeholder: 'Ex.: Saúde, Varejo' })}
        {field('postingGoalPerWeek', 'Meta de publicações por semana', { type: 'number', min: 0, max: 100, step: 0.5 })}
        {field('inactivityAlertDays', 'Alerta após X dias sem publicar', { type: 'number', min: 1, max: 365 }, 'Vazio = padrão das Configurações')}
        {field('negativeChangeThreshold', 'Alerta de variação negativa (seguidores em 7 dias)', { type: 'number', min: 1 }, 'Vazio = padrão das Configurações')}
        {field('growthGoalPct30d', 'Meta de crescimento em 30 dias (%)', { type: 'number', step: 0.1 })}
        <label className="span-2">
          Observações internas
          <textarea rows={3} maxLength={2000} value={v.notes} onChange={set('notes')} />
        </label>
        {error && (
          <p className="form-error span-2" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

export function stateBadge(s: ProfileSummary) {
  if (s.clientStatus !== 'active') return <Badge tone="neutral">{CLIENT_STATUS[s.clientStatus].label}</Badge>;
  const st = PROFILE_STATE[s.profileState] ?? { label: s.profileState, tone: 'neutral' as const };
  if (s.profileState === 'ok' && s.stale) return <Badge tone="warning">Desatualizado</Badge>;
  if (s.profileState === 'ok' && s.consecutiveFailures > 0) return <Badge tone="warning">Falha recente</Badge>;
  return <Badge tone={st.tone}>{st.label}</Badge>;
}

export function ClientsPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [debounced, setDebounced] = useState(search);
  const status = params.get('status') ?? 'all';
  const [sort, setSort] = useState('name');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<ProfileSummary | 'new' | null>(null);
  const [archive, setArchive] = useState<ProfileSummary | null>(null);
  const [msg, setMsg] = useState<string>();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(1), [debounced, status, sort, dir]);

  const q = useApi<Paged<ProfileSummary>>(`/api/clients${qs({ search: debounced, status, sort, dir, page })}`, 60_000);
  const onSort = (k: string) => {
    if (k === sort) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setSort(k);
      setDir(k === 'name' ? 'asc' : 'desc');
    }
  };

  async function action(s: ProfileSummary, path: string, done: string) {
    try {
      const r = await api<{ message?: string }>(`/api/clients/${s.clientId}/${path}`, { method: 'POST' });
      setMsg(r.message ?? done);
      q.reload();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Clientes</h1>
          <p className="muted">Cadastro, status e coleta dos perfis monitorados.</p>
        </div>
        <div className="actions">
          <a className="btn" href="/api/export/clients.csv">
            <Icon name="download" /> CSV
          </a>
          {can('analyst') && (
            <button className="btn btn-primary" onClick={() => setForm('new')}>
              <Icon name="plus" /> Adicionar cliente
            </button>
          )}
        </div>
      </div>

      <div className="filter-bar">
        <input type="search" placeholder="Buscar por nome ou @" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar" />
        <div className="seg" role="group" aria-label="Status">
          {[
            ['all', 'Todos'],
            ['active', 'Ativos'],
            ['attention', 'Precisam de atenção'],
            ['paused', 'Pausados'],
            ['archived', 'Arquivados'],
          ].map(([k, l]) => (
            <button key={k} className={status === k ? 'on' : ''} onClick={() => setParams(k === 'all' ? {} : { status: k })}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {msg && (
        <div className="banner banner-info" role="status">
          {msg} <button className="link" onClick={() => setMsg(undefined)}>fechar</button>
        </div>
      )}

      <Async q={q}>
        {(d) =>
          d.total === 0 ? (
            <Empty title={debounced || status !== 'all' ? 'Nenhum cliente encontrado com esses filtros.' : 'Nenhum cliente cadastrado.'} />
          ) : (
            <div className="card table-card">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <SortHeader label="Cliente" k="name" sort={sort} dir={dir} onSort={onSort} />
                      <th>Estado</th>
                      <SortHeader label="Seguidores" k="followers" sort={sort} dir={dir} onSort={onSort} />
                      <SortHeader label="7 dias" k="change7d" sort={sort} dir={dir} onSort={onSort} />
                      <SortHeader label="30 dias" k="change30d" sort={sort} dir={dir} onSort={onSort} />
                      <SortHeader label="Última coleta ok" k="lastSuccess" sort={sort} dir={dir} onSort={onSort} />
                      <th>Próxima coleta</th>
                      <SortHeader label="Alertas" k="alerts" sort={sort} dir={dir} onSort={onSort} />
                      <th aria-label="Ações" />
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((s) => (
                      <tr key={s.clientId}>
                        <td>
                          <Link to={`/clientes/${s.clientId}`} className="client-cell">
                            <Avatar url={s.profilePictureUrl} name={s.clientName} />
                            <span>
                              <strong>{s.clientName}</strong> {s.isDemo && <DemoBadge />}
                              <small>@{s.username}{s.category ? ` · ${s.category}` : ''}</small>
                            </span>
                          </Link>
                        </td>
                        <td>
                          {stateBadge(s)}
                          {s.lastErrorCode && <small className="err-line" title={s.lastErrorMessage ?? ''}>{s.lastErrorMessage}</small>}
                        </td>
                        <td className="num">{s.currentFollowers == null ? <NotAvailable reason="Sem coleta" /> : fmtInt(s.currentFollowers)}</td>
                        <td className="num"><Change c={s.change7d} showPct={false} /></td>
                        <td className="num"><Change c={s.change30d} showPct={false} /></td>
                        <td title={fmtDateTime(s.lastSuccessAt)}>{relative(s.lastSuccessAt)}</td>
                        <td>
                          {s.clientStatus !== 'active'
                            ? '—'
                            : s.manualRequestedAt
                              ? 'Na fila (manual)'
                              : s.nextCollectionAt
                                ? <span title={fmtDateTime(s.nextCollectionAt)}>{relative(s.nextCollectionAt)}</span>
                                : <span className="neg-text" title="Erro permanente: use “Coletar agora” para tentar de novo">Parada</span>}
                        </td>
                        <td className="num">{s.openAlerts || '—'}</td>
                        <td className="row-actions">
                          {can('analyst') && s.clientStatus === 'active' && (
                            <button className="btn btn-sm" onClick={() => action(s, 'collect', 'Coleta solicitada.')} title="Coletar agora">
                              <Icon name="refresh" size={15} /> Coletar
                            </button>
                          )}
                          {can('analyst') && (
                            <details className="menu">
                              <summary className="btn btn-sm" aria-label="Mais ações">⋯</summary>
                              <div className="menu-list">
                                {s.clientStatus !== 'archived' && <button onClick={() => setForm(s)}>Editar</button>}
                                {s.clientStatus === 'active' && <button onClick={() => action(s, 'pause', 'Monitoramento pausado.')}>Pausar monitoramento</button>}
                                {s.clientStatus === 'paused' && <button onClick={() => action(s, 'resume', 'Monitoramento reativado.')}>Reativar monitoramento</button>}
                                {s.clientStatus === 'archived' && <button onClick={() => action(s, 'restore', 'Cliente restaurado (pausado).')}>Restaurar</button>}
                                {s.clientStatus !== 'archived' && <button className="danger" onClick={() => setArchive(s)}>Excluir…</button>}
                                <a href={`/api/export/snapshots.csv?clientId=${s.clientId}`}>Exportar histórico (CSV)</a>
                              </div>
                            </details>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPage={setPage} />
            </div>
          )
        }
      </Async>

      {form && (
        <ClientForm
          initial={form === 'new' ? undefined : form}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            setMsg(form === 'new' ? 'Cliente cadastrado. A primeira coleta foi colocada na fila.' : 'Cliente atualizado.');
            q.reload();
          }}
        />
      )}
      {archive && <ArchiveDialog s={archive} onClose={() => setArchive(null)} onDone={(m) => { setArchive(null); setMsg(m); q.reload(); }} />}
    </div>
  );
}

function ArchiveDialog({ s, onClose, onDone }: { s: ProfileSummary; onClose: () => void; onDone: (msg: string) => void }) {
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string>();
  const settings = useApi<{ settings: { archivedClientRetentionDays: number } }>('/api/settings');
  const days = settings.data?.settings.archivedClientRetentionDays;
  async function go() {
    try {
      await api(`/api/clients/${s.clientId}/archive`, { method: 'POST', body: { confirmUsername: confirm } });
      onDone(`${s.clientName} arquivado. O histórico será mantido por ${days} dias e pode ser restaurado nesse prazo.`);
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <Modal
      title={`Excluir ${s.clientName}?`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn btn-danger" disabled={confirm.replace(/^@/, '').toLowerCase() !== s.username} onClick={go}>
            Arquivar cliente
          </button>
        </>
      }
    >
      <p>
        O monitoramento será interrompido e o cliente sairá das listas. <strong>O histórico não é apagado agora</strong>: ele fica guardado
        por {days ?? '…'} dias (política de retenção) e pode ser restaurado. Após esse prazo, os dados são excluídos definitivamente.
      </p>
      <label>
        Para confirmar, digite <strong>@{s.username}</strong>
        <input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoFocus />
      </label>
      {error && <p className="form-error">{error}</p>}
    </Modal>
  );
}
