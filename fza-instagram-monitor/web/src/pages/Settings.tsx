import { useEffect, useState, type FormEvent } from 'react';
import { Async, Badge, Modal } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime, fmtInt, relative } from '../lib/format';
import { useApi } from '../lib/hooks';
import type { ProviderInfo, Settings, SystemStatus } from '../lib/types';

type FieldDef = [keyof Settings, string, string?, { min?: number; max?: number; step?: number; nullable?: boolean }?];

const GROUPS: { title: string; fields: FieldDef[] }[] = [
  {
    title: 'Coleta',
    fields: [
      ['followersIntervalMinutes', 'Intervalo de coleta de seguidores (min)', 'Padrão 60. Respeite o limite da fonte.', { min: 15, max: 1440 }],
      ['mediaIntervalMinutes', 'Intervalo de coleta de publicações (min)', undefined, { min: 15, max: 1440 }],
      ['mediaFetchLimit', 'Publicações recentes por coleta', 'Máx. 50', { min: 1, max: 50 }],
      ['maxConcurrency', 'Coletas simultâneas', undefined, { min: 1, max: 10 }],
      ['maxRequestsPerHour', 'Máximo de requisições por hora', 'Meta: 200/h por usuário do app; deixe margem.', { min: 1, max: 5000 }],
    ],
  },
  {
    title: 'Tentativas',
    fields: [
      ['retryBaseSeconds', 'Espera inicial após erro temporário (s)', 'Dobra a cada falha, com variação aleatória', { min: 5, max: 3600 }],
      ['retryMaxMinutes', 'Espera máxima entre tentativas (min)', undefined, { min: 1, max: 1440 }],
      ['maxPermanentFailures', 'Erros permanentes até parar a coleta', 'Ex.: perfil não encontrado', { min: 1, max: 20 }],
      ['permanentRetryHours', 'Intervalo entre tentativas após erro permanente (h)', undefined, { min: 1, max: 168 }],
    ],
  },
  {
    title: 'Alertas (padrões)',
    fields: [
      ['defaultInactivityDays', 'Dias sem publicar para alertar', undefined, { min: 1, max: 365 }],
      ['defaultNegativeChangeThreshold', 'Variação negativa em 7 dias para alertar (seguidores)', undefined, { min: 1 }],
      ['defaultPostingGoalPerWeek', 'Meta de publicações por semana', 'Vazio = sem meta', { min: 0, max: 100, step: 0.5, nullable: true }],
      ['defaultGrowthGoalPct30d', 'Meta de crescimento em 30 dias (%)', 'Vazio = sem meta', { step: 0.1, nullable: true }],
      ['alertFailureThreshold', 'Falhas seguidas para alerta de coleta', undefined, { min: 1, max: 50 }],
      ['staleAfterIntervals', 'Desatualizado após N intervalos sem sucesso', undefined, { min: 2, max: 48 }],
      ['alertCooldownHours', 'Silêncio após resolução manual (h)', undefined, { min: 0, max: 720 }],
    ],
  },
  {
    title: 'Retenção e interface',
    fields: [
      ['archivedClientRetentionDays', 'Manter clientes arquivados por (dias)', 'Após o prazo, exclusão definitiva', { min: 7, max: 3650 }],
      ['collectionRunRetentionDays', 'Manter registros de execução por (dias)', undefined, { min: 7, max: 3650 }],
      ['snapshotRetentionDays', 'Manter histórico de seguidores por (dias)', 'Vazio = para sempre (recomendado)', { min: 30, max: 36500, nullable: true }],
      ['pageSize', 'Itens por página nas tabelas', undefined, { min: 10, max: 200 }],
    ],
  },
];

export function SettingsPage() {
  const { can } = useAuth();
  const q = useApi<{ settings: Settings; providers: ProviderInfo[] }>('/api/settings');
  const status = useApi<SystemStatus>('/api/system/status', 30_000);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Configurações</h1>
          <p className="muted">{can('admin') ? 'Somente administradores podem alterar.' : 'Visualização. Somente administradores podem alterar.'}</p>
        </div>
      </div>
      <Async q={status}>{(s) => <WorkerCard s={s} onChange={status.reload} />}</Async>
      <Async q={q}>{(d) => <SettingsForm data={d} onSaved={() => { q.reload(); status.reload(); }} />}</Async>
      {can('admin') && <Diagnostics />}
      {can('admin') && <Users />}
    </div>
  );
}

function WorkerCard({ s, onChange }: { s: SystemStatus; onChange: () => void }) {
  const { can } = useAuth();
  return (
    <section className="card">
      <h2>Estado da coleta</h2>
      <dl className="facts facts-3">
        <dt>Fonte ativa</dt>
        <dd>{s.provider ? s.provider.displayName : 'Nenhuma'} {s.provider && (s.provider.config.configured ? <Badge tone="good">Configurada</Badge> : <Badge tone="critical">Não configurada</Badge>)}</dd>
        <dt>Worker</dt>
        <dd>
          {s.workerAlive ? <Badge tone="good">Ativo</Badge> : <Badge tone="critical">Sem sinal</Badge>}
          {s.workers[0] && <small className="block muted">último sinal {relative(s.workers[0].last_heartbeat_at)} · {s.workers[0].info.status}</small>}
        </dd>
        <dt>Pausa da fonte</dt>
        <dd>
          {s.providerPause ? `${s.providerPause.reason} até ${fmtDateTime(s.providerPause.paused_until)}` : 'Nenhuma'}
          {s.providerPause && can('admin') && (
            <button className="btn btn-sm" onClick={() => api('/api/system/provider/resume', { method: 'POST' }).then(onChange)}>Retomar agora</button>
          )}
        </dd>
        <dt>Requisições na última hora</dt>
        <dd>{s.requestsLastHour} de {s.maxRequestsPerHour}</dd>
        <dt>Última execução</dt>
        <dd>{s.lastRun ? `${fmtDateTime(s.lastRun.started_at)} (${s.lastRun.status})` : '—'}</dd>
        <dt>Próxima execução prevista</dt>
        <dd>{s.queue.due > 0 ? `${s.queue.due} perfil(is) na fila agora` : s.queue.next_scheduled ? fmtDateTime(s.queue.next_scheduled) : '—'}</dd>
        <dt>Última coleta bem-sucedida</dt>
        <dd>{fmtDateTime(s.lastSuccessAt)}</dd>
        <dt>Pedidos manuais pendentes</dt>
        <dd>{s.queue.manual_pending}</dd>
        <dt>Perfis com coleta parada</dt>
        <dd>{s.queue.stopped}</dd>
      </dl>
      <p className="footnote">{s.effectiveFrequency.note}</p>
      {s.provider && !s.provider.config.configured && (
        <div className="banner banner-critical">
          <div>
            <strong>Fonte não configurada — nenhum dado está sendo coletado.</strong> Faltam as variáveis: {s.provider.config.missing.join(', ')}.
            <ol>{s.provider.config.instructions.map((i) => <li key={i}>{i}</li>)}</ol>
            As chaves ficam só nas variáveis de ambiente do servidor; nunca são exibidas nem enviadas ao navegador.
          </div>
        </div>
      )}
    </section>
  );
}

function SettingsForm({ data, onSaved }: { data: { settings: Settings; providers: ProviderInfo[] }; onSaved: () => void }) {
  const { can } = useAuth();
  const editable = can('admin');
  const [v, setV] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string>();
  useEffect(() => {
    setV(Object.fromEntries(Object.entries(data.settings).map(([k, x]) => [k, x == null ? '' : String(x)])));
  }, [data]);

  async function save(e: FormEvent) {
    e.preventDefault();
    const patch: Record<string, unknown> = { activeProvider: v.activeProvider, displayTimezone: v.displayTimezone };
    for (const g of GROUPS) for (const [k, , , o] of g.fields) patch[k] = v[k] === '' && o?.nullable ? null : Number(v[k]);
    try {
      await api('/api/settings', { method: 'PATCH', body: patch });
      setMsg('Configurações salvas. O worker usa os novos valores no próximo ciclo.');
      onSaved();
    } catch (err) {
      const ae = err as ApiError;
      setMsg(`${ae.message} ${(ae.body.issues ?? []).map((i) => `${i.path}: ${i.message}`).join('; ')}`);
    }
  }

  const active = data.providers.find((p) => p.id === data.settings.activeProvider);
  return (
    <form onSubmit={save}>
      <section className="card">
        <h2>Fonte de dados</h2>
        <label>
          Fonte ativa
          <select disabled={!editable} value={v.activeProvider ?? ''} onChange={(e) => setV({ ...v, activeProvider: e.target.value })}>
            {data.providers.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
        </label>
        {active && (
          <>
            <p>
              Chave/token: {active.config.configured ? <Badge tone="good">configurado no servidor</Badge> : <Badge tone="critical">ausente</Badge>}
            </p>
            <h3>O que esta fonte oferece</h3>
            <ul className="caps">
              <li>Seguidores atuais: {active.capabilities.followersCount ? 'sim' : 'não'}</li>
              <li>Total de publicações: {active.capabilities.mediaCount ? 'sim' : 'não'}</li>
              <li>Publicações recentes com data: {active.capabilities.recentMedia ? 'sim' : 'não'}</li>
              <li>Separa Reels de vídeos: {active.capabilities.distinguishesReels ? 'sim' : 'não'}</li>
              <li>Seguidores ganhos e perdidos separadamente: <strong>{active.capabilities.followerGainsAndLosses ? 'sim' : 'não — só variação líquida'}</strong></li>
              <li>Histórico anterior ao cadastro: {active.capabilities.followerBackfill ? 'sim' : 'não'}</li>
              <li>Tipos de perfil: {active.capabilities.supportedAccountTypes}</li>
              {active.capabilities.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          </>
        )}
      </section>
      {GROUPS.map((g) => (
        <section className="card" key={g.title}>
          <h2>{g.title}</h2>
          <div className="form-grid">
            {g.fields.map(([k, label, hint, o]) => (
              <label key={k}>
                {label}
                <input type="number" disabled={!editable} value={v[k] ?? ''} min={o?.min} max={o?.max} step={o?.step ?? 1} required={!o?.nullable} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
                {hint && <small className="muted">{hint}</small>}
              </label>
            ))}
            {g.title === 'Retenção e interface' && (
              <label>
                Fuso horário de apresentação
                <input disabled={!editable} value={v.displayTimezone ?? ''} onChange={(e) => setV({ ...v, displayTimezone: e.target.value })} />
                <small className="muted">Os dados são armazenados em UTC.</small>
              </label>
            )}
          </div>
        </section>
      ))}
      {msg && <div className="banner banner-info">{msg}</div>}
      {editable && <button className="btn btn-primary">Salvar configurações</button>}
    </form>
  );
}

interface Diag {
  errorsByCode: { error_code: string; label: string; n: number; last_at: string }[];
  recentErrors: { id: number; started_at: string; error_code: string; error_message: string; username: string; client_name: string }[];
  runStats24h: { status: string; n: number; avg_ms: number }[];
  stoppedProfiles: { client_name: string; username: string; last_error_message: string }[];
  database: { size_bytes: number; snapshots: number; media: number; runs: number; last_migration: string };
}

function Diagnostics() {
  const q = useApi<Diag>('/api/system/diagnostics', 60_000);
  return (
    <section className="card">
      <h2>Diagnóstico técnico</h2>
      <Async q={q}>
        {(d) => (
          <>
            <dl className="facts facts-3">
              <dt>Banco de dados</dt>
              <dd>{(d.database.size_bytes / 1_048_576).toFixed(1)} MB · migração {d.database.last_migration}</dd>
              <dt>Registros</dt>
              <dd>{fmtInt(d.database.snapshots)} snapshots · {fmtInt(d.database.media)} publicações · {fmtInt(d.database.runs)} execuções</dd>
              <dt>Execuções (24 h)</dt>
              <dd>{d.runStats24h.map((r) => `${r.status}: ${r.n}`).join(' · ') || '—'}</dd>
            </dl>
            <h3>Erros nos últimos 7 dias</h3>
            {d.errorsByCode.length === 0 ? <p className="muted">Nenhum erro.</p> : (
              <ul>{d.errorsByCode.map((e) => <li key={e.error_code}>{e.label}: {e.n} (último {fmtDateTime(e.last_at)})</li>)}</ul>
            )}
            {d.stoppedProfiles.length > 0 && (
              <>
                <h3>Perfis com coleta interrompida</h3>
                <ul>{d.stoppedProfiles.map((p) => <li key={p.username}>{p.client_name} (@{p.username}): {p.last_error_message}</li>)}</ul>
              </>
            )}
            <h3>Erros recentes</h3>
            <div className="table-wrap">
              <table className="compact">
                <thead><tr><th>Quando</th><th>Perfil</th><th>Código</th><th>Mensagem</th></tr></thead>
                <tbody>
                  {d.recentErrors.slice(0, 20).map((e) => (
                    <tr key={e.id}><td>{fmtDateTime(e.started_at)}</td><td>@{e.username}</td><td>{e.error_code}</td><td><small>{e.error_message}</small></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Async>
    </section>
  );
}

function Users() {
  const q = useApi<{ items: { id: string; email: string; name: string; role: string; status: string; last_login_at: string | null }[] }>('/api/users');
  const [form, setForm] = useState(false);
  const [msg, setMsg] = useState<string>();
  const toggle = async (id: string, status: string) => {
    try {
      await api(`/api/users/${id}`, { method: 'PATCH', body: { status: status === 'active' ? 'disabled' : 'active' } });
      q.reload();
    } catch (err) {
      setMsg((err as Error).message);
    }
  };
  return (
    <section className="card">
      <div className="card-head">
        <h2>Usuários</h2>
        <button className="btn btn-sm" onClick={() => setForm(true)}>Adicionar usuário</button>
      </div>
      {msg && <p className="form-error">{msg}</p>}
      <Async q={q}>
        {(d) => (
          <div className="table-wrap">
            <table className="compact">
              <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Situação</th><th>Último acesso</th><th /></tr></thead>
              <tbody>
                {d.items.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td><td>{u.email}</td>
                    <td>{u.role === 'admin' ? 'Administrador' : u.role === 'analyst' ? 'Analista' : 'Visualização'}</td>
                    <td>{u.status === 'active' ? 'Ativo' : 'Desativado'}</td>
                    <td>{fmtDateTime(u.last_login_at)}</td>
                    <td><button className="btn btn-sm" onClick={() => toggle(u.id, u.status)}>{u.status === 'active' ? 'Desativar' : 'Reativar'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Async>
      {form && <UserForm onClose={() => setForm(false)} onSaved={() => { setForm(false); q.reload(); }} />}
    </section>
  );
}

function UserForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({ name: '', email: '', role: 'analyst', password: '' });
  const [error, setError] = useState<string>();
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/api/users', { method: 'POST', body: v });
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <Modal title="Adicionar usuário" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" form="user-form">Salvar</button></>}>
      <form id="user-form" className="form-grid" onSubmit={submit}>
        <label>Nome<input required value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></label>
        <label>E-mail<input type="email" required value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} /></label>
        <label>Papel
          <select value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}>
            <option value="viewer">Visualização (somente leitura)</option>
            <option value="analyst">Analista (gerencia clientes e alertas)</option>
            <option value="admin">Administrador</option>
          </select>
        </label>
        <label>Senha inicial<input type="password" required minLength={12} autoComplete="new-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} /><small className="muted">Mínimo de 12 caracteres, com letras e números.</small></label>
        {error && <p className="form-error span-2">{error}</p>}
      </form>
    </Modal>
  );
}
