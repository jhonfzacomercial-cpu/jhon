import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useApi } from '../lib/hooks';
import { MEDIA_TYPE, RUN_STATUS, fmtDate, fmtDateTime, fmtDayKey, fmtDayKeyFull, fmtInt, fmtSigned, relative, todayKey, addDaysKey } from '../lib/format';
import type { ClientDetail, DailyPoint, MediaItem, Paged, Run } from '../lib/types';
import { Async, Avatar, Badge, Change, DemoBadge, Empty, Icon, Kpi, NotAvailable } from '../components/ui';
import { ChangeBars, FollowersLine } from '../components/charts';
import { ClientForm, stateBadge } from './Clients';

const LEVEL_TONE = { positive: 'good', neutral: 'info', attention: 'warning', insufficient: 'neutral' } as const;

export function ClientDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const q = useApi<ClientDetail>(`/api/clients/${id}`, 2 * 60_000);
  const [days, setDays] = useState(30);
  const to = todayKey();
  const series = useApi<{ series: DailyPoint[]; bestWorst: { best: { day: string; change: number } | null; worst: { day: string; change: number } | null; daysWithData: number } }>(
    `/api/clients/${id}/series${qs({ from: addDaysKey(to, -(days - 1)), to })}`,
  );
  const media = useApi<Paged<MediaItem>>(`/api/media${qs({ clientId: id, pageSize: 12 })}`);
  const runs = useApi<Paged<Run> & { errorLabels: Record<string, string> }>(`/api/runs${qs({ clientId: id, pageSize: 15 })}`, 60_000);
  const snaps = useApi<{ items: { id: number; followers_count: number | null; observed_at: string; collected_at: string; source: string; validity: string; validity_reason: string | null }[] }>(
    `/api/clients/${id}/snapshots?limit=30`,
  );
  const history = useApi<{ items: { id: number; action: string; created_at: string; user_name: string | null; details: Record<string, unknown> }[] }>(`/api/clients/${id}/history`);
  const [edit, setEdit] = useState(false);
  const [msg, setMsg] = useState<string>();

  async function collect() {
    try {
      const r = await api<{ message: string }>(`/api/clients/${id}/collect`, { method: 'POST' });
      setMsg(r.message);
      q.reload();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  return (
    <div className="page">
      <Link to="/clientes" className="back">← Clientes</Link>
      <Async q={q}>
        {(d) => {
          const s = d.summary;
          const caps = d.provider?.capabilities;
          const g = d.growth;
          const p = d.posting;
          return (
            <>
              <div className="profile-head card">
                <Avatar url={s.profilePictureUrl} name={s.clientName} />
                <div className="profile-id">
                  <h1>
                    {s.clientName} {s.isDemo && <DemoBadge />}
                  </h1>
                  <div className="muted">
                    @{s.username}
                    {s.fullName && ` · ${s.fullName}`}
                    {s.category && ` · ${s.category}`}
                  </div>
                  <div className="profile-badges">
                    {stateBadge(s)}
                    <a className="link-ext" href={s.canonicalUrl ?? `https://www.instagram.com/${s.username}/`} target="_blank" rel="noopener noreferrer">
                      Abrir no Instagram <Icon name="external" size={14} />
                    </a>
                  </div>
                  {s.stateReason && <p className="err-line">{s.stateReason}</p>}
                  {s.notes && <p className="notes">{s.notes}</p>}
                </div>
                <div className="actions">
                  {can('analyst') && s.clientStatus === 'active' && (
                    <button className="btn btn-primary" onClick={collect}>
                      <Icon name="refresh" /> Coletar agora
                    </button>
                  )}
                  {can('analyst') && s.clientStatus !== 'archived' && (
                    <button className="btn" onClick={() => setEdit(true)}>Editar</button>
                  )}
                  <a className="btn" href={`/api/export/snapshots.csv?clientId=${s.clientId}`}><Icon name="download" /> Histórico CSV</a>
                </div>
              </div>
              {msg && <div className="banner banner-info">{msg}</div>}
              {d.collection.permanentlyStopped && (
                <div className="banner banner-critical">
                  A coleta automática deste perfil foi interrompida após erros permanentes ({s.lastErrorMessage}). Corrija o @ se necessário e use “Coletar agora”.
                </div>
              )}

              <section className="kpi-grid">
                <Kpi label="Seguidores (última coleta)" accent value={s.currentFollowers == null ? <NotAvailable reason="Sem coleta válida" /> : fmtInt(s.currentFollowers)} hint={d.latestSnapshot ? `Observado em ${fmtDateTime(d.latestSnapshot.observedAt)}` : 'Aguardando a primeira coleta'} />
                <Kpi label="Coleta anterior" value={g.lastVsPrevious.from ? fmtInt(g.lastVsPrevious.from.followers) : <NotAvailable reason="Sem coleta anterior" />} hint={g.lastVsPrevious.from ? fmtDateTime(g.lastVsPrevious.from.observedAt) : undefined} />
                <Kpi label="Variação desde a anterior" value={<Change c={g.lastVsPrevious} />} hint={g.lastVsPrevious.hoursCovered != null ? `Intervalo de ${g.lastVsPrevious.hoursCovered.toFixed(1).replace('.', ',')} h` : undefined} />
                <Kpi label="Últimos 7 dias" value={<Change c={g.change7d} />} hint={g.change7d.from ? `Desde ${fmtDateTime(g.change7d.from.observedAt)}` : undefined} />
                <Kpi label="Últimos 30 dias" value={<Change c={g.change30d} />} hint={g.change30d.from ? `Desde ${fmtDateTime(g.change30d.from.observedAt)}` : undefined} />
                <Kpi
                  label="Publicações (total no perfil)"
                  value={s.currentMediaCount == null ? <NotAvailable reason="Não disponível" /> : fmtInt(s.currentMediaCount)}
                />
              </section>
              <p className="footnote">
                <Icon name="info" size={14} /> Variação líquida = total atual − total anterior. A fonte não informa quantos seguidores foram ganhos ou perdidos separadamente; uma variação de +10 pode ser, por exemplo, 30 novos e 20 que deixaram de seguir.
              </p>

              <section className="card">
                <div className="card-head">
                  <h2>Histórico diário de seguidores</h2>
                  <div className="seg">
                    {[30, 90, 365].map((n) => (
                      <button key={n} className={days === n ? 'on' : ''} onClick={() => setDays(n)}>
                        {n === 365 ? '12 meses' : `${n} dias`}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="card-sub">
                  Fechamento diário = última coleta válida de cada dia (Campo Grande).
                  {g.historyStartedAt ? ` Histórico próprio desde ${fmtDateTime(g.historyStartedAt)}; não há dados anteriores à primeira coleta.` : ''}
                </p>
                <Async q={series}>
                  {(sd) => (
                    <>
                      <FollowersLine data={sd.series} />
                      <h3>Variação líquida por dia</h3>
                      <ChangeBars data={sd.series} xKey="day" xFormat={fmtDayKey} height={200} />
                      <p className="muted">
                        Melhor dia: {sd.bestWorst.best ? `${fmtSigned(sd.bestWorst.best.change)} em ${fmtDayKeyFull(sd.bestWorst.best.day)}` : '—'} · Pior dia:{' '}
                        {sd.bestWorst.worst ? `${fmtSigned(sd.bestWorst.worst.change)} em ${fmtDayKeyFull(sd.bestWorst.worst.day)}` : '—'} · considerando {sd.bestWorst.daysWithData} dia(s) com coleta no dia e no anterior.
                      </p>
                    </>
                  )}
                </Async>
              </section>

              <section className="grid-2">
                <div className="card">
                  <h2>Publicações</h2>
                  {!p.available ? (
                    <p className="na-block">Não disponível nesta fonte no momento: {p.unavailableReason}</p>
                  ) : (
                    <>
                      <dl className="facts">
                        <dt>Publicação mais recente</dt>
                        <dd>{p.latestPublishedAt ? fmtDateTime(p.latestPublishedAt) : 'Nenhuma publicação observada'}</dd>
                        <dt>Dias desde a última</dt>
                        <dd>{p.daysSinceLatest ?? '—'}</dd>
                        {p.windows.map((w) => (
                          <span key={w.days} className="contents">
                            <dt>Últimos {w.days} dias</dt>
                            <dd>
                              {w.complete ? w.count : `pelo menos ${w.count}`}
                              {!w.complete && <small className="muted"> (cobertura parcial)</small>}
                            </dd>
                          </span>
                        ))}
                        <dt>Média semanal</dt>
                        <dd>
                          {p.postsPerWeek != null ? `${p.postsPerWeek.toFixed(1).replace('.', ',')} por semana (base: ${p.postsPerWeekBasisDays} dias)` : 'Cobertura insuficiente (mínimo 7 dias)'}
                          {s.postingGoalPerWeek != null && ` · meta: ${s.postingGoalPerWeek}`}
                        </dd>
                        <dt>Por tipo (30 dias)</dt>
                        <dd>
                          {Object.entries(p.byType)
                            .filter(([, n]) => n > 0)
                            .map(([t, n]) => `${MEDIA_TYPE[t]}: ${n}`)
                            .join(' · ') || '—'}
                        </dd>
                      </dl>
                      <p className="footnote">
                        Cobertura: {p.coverageStart ? (Date.parse(p.coverageStart) === 0 ? 'todas as publicações do perfil' : `publicações desde ${fmtDate(p.coverageStart)}`) : 'desconhecida'}.
                        {caps && !caps.distinguishesReels && ' Esta fonte não separa Reels de vídeos: ambos aparecem como “Vídeo”.'} A data exibida é a de publicação, não a data em que o sistema a descobriu.
                      </p>
                    </>
                  )}
                </div>
                <div className="card">
                  <h2>Diagnóstico automatizado</h2>
                  {d.diagnosis.length === 0 ? (
                    <p className="muted">Sem dados suficientes.</p>
                  ) : (
                    <ul className="findings">
                      {d.diagnosis.map((f) => (
                        <li key={f.key}>
                          <Badge tone={LEVEL_TONE[f.level]}>{f.title}</Badge>
                          <p>{f.text}</p>
                          <small className="muted">
                            Período: {f.period.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, (m) => fmtDateTime(m))} · Dados: {f.dataPoints}
                          </small>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="footnote">O diagnóstico descreve os dados; não atribui causa às variações.</p>
                </div>
              </section>

              <section className="card">
                <h2>Publicações recentes</h2>
                <Async q={media}>
                  {(m) =>
                    m.items.length === 0 ? (
                      <Empty title="Nenhuma publicação observada ainda." />
                    ) : (
                      <div className="media-grid">
                        {m.items.map((it) => (
                          <a key={it.id} className="media-card" href={it.permalink ?? '#'} target="_blank" rel="noopener noreferrer">
                            {it.thumbnail_url ? (
                              <img src={it.thumbnail_url} alt="" loading="lazy" referrerPolicy="no-referrer" />
                            ) : (
                              <span className="media-ph">{MEDIA_TYPE[it.media_type]}</span>
                            )}
                            <span className="media-meta">
                              <strong>{MEDIA_TYPE[it.media_type]}</strong>
                              <span>{fmtDateTime(it.published_at)}</span>
                            </span>
                          </a>
                        ))}
                      </div>
                    )
                  }
                </Async>
              </section>

              <section className="card">
                <h2>Qualidade dos dados e integração</h2>
                <dl className="facts facts-3">
                  <dt>Fonte</dt>
                  <dd>{d.latestSnapshot?.source ?? s.source ?? '—'} {d.provider && `(${d.provider.displayName})`}</dd>
                  <dt>Observado em</dt>
                  <dd>{fmtDateTime(d.latestSnapshot?.observedAt)}</dd>
                  <dt>Coletado em</dt>
                  <dd>{fmtDateTime(d.latestSnapshot?.collectedAt)}</dd>
                  <dt>Validade</dt>
                  <dd>{d.latestSnapshot ? (d.latestSnapshot.validity === 'valid' ? 'Válido' : `Suspeito: ${d.latestSnapshot.validityReason}`) : '—'}</dd>
                  <dt>Desatualizado</dt>
                  <dd>{s.stale ? <Badge tone="warning">Sim</Badge> : 'Não'}</dd>
                  <dt>Próxima coleta prevista</dt>
                  <dd>{s.clientStatus !== 'active' ? 'Monitoramento pausado' : s.nextCollectionAt ? `${fmtDateTime(s.nextCollectionAt)} (${relative(s.nextCollectionAt)})` : 'Interrompida'}</dd>
                  <dt>Frequência</dt>
                  <dd>Seguidores a cada {d.collection.followersIntervalMinutes} min; publicações a cada {d.collection.mediaIntervalMinutes} min</dd>
                  <dt>Snapshots guardados</dt>
                  <dd>{fmtInt(g.snapshotsTotal)}{g.snapshotsSuspect ? ` (${g.snapshotsSuspect} suspeitos, fora dos cálculos)` : ''}</dd>
                  <dt>Falhas seguidas</dt>
                  <dd>{s.consecutiveFailures}{s.lastErrorMessage ? ` · ${s.lastErrorMessage}` : ''}</dd>
                </dl>
                {caps && (
                  <details>
                    <summary>Limitações desta fonte</summary>
                    <ul>
                      <li>{caps.supportedAccountTypes}</li>
                      {caps.notes.map((n) => <li key={n}>{n}</li>)}
                    </ul>
                  </details>
                )}
              </section>

              <section className="grid-2">
                <div className="card table-card">
                  <h2>Execuções de coleta</h2>
                  <Async q={runs}>
                    {(r) => (
                      <div className="table-wrap">
                        <table className="compact">
                          <thead><tr><th>Início</th><th>Resultado</th><th>Registros</th><th>Erro</th></tr></thead>
                          <tbody>
                            {r.items.map((run) => (
                              <tr key={run.id}>
                                <td>{fmtDateTime(run.started_at)}{run.trigger === 'manual' && <small> · manual</small>}</td>
                                <td><Badge tone={RUN_STATUS[run.status]?.tone ?? 'neutral'}>{RUN_STATUS[run.status]?.label ?? run.status}</Badge></td>
                                <td className="num">{run.records_processed}{run.media_new ? ` (+${run.media_new} novas)` : ''}</td>
                                <td><small>{run.error_code ? `${r.errorLabels[run.error_code] ?? run.error_code}` : run.error_message ?? ''}</small></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {r.items.length === 0 && <p className="muted">Nenhuma execução ainda.</p>}
                      </div>
                    )}
                  </Async>
                </div>
                <div className="card table-card">
                  <h2>Snapshots recentes</h2>
                  <Async q={snaps}>
                    {(sn) => (
                      <div className="table-wrap snap-scroll">
                        <table className="compact">
                          <thead><tr><th>Observado em</th><th>Seguidores</th><th>Validade</th></tr></thead>
                          <tbody>
                            {sn.items.map((x) => (
                              <tr key={x.id}>
                                <td>{fmtDateTime(x.observed_at)}</td>
                                <td className="num">{fmtInt(x.followers_count)}</td>
                                <td>{x.validity === 'valid' ? 'Válido' : <span title={x.validity_reason ?? ''}>Suspeito</span>}{x.source === 'demo' && <> <DemoBadge /></>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {sn.items.length === 0 && <p className="muted">Nenhum snapshot ainda.</p>}
                      </div>
                    )}
                  </Async>
                </div>
              </section>

              <section className="card">
                <h2>Histórico de alterações</h2>
                <Async q={history}>
                  {(h) =>
                    h.items.length === 0 ? <p className="muted">Sem registros.</p> : (
                      <ul className="timeline">
                        {h.items.map((x) => (
                          <li key={x.id}>
                            <strong>{ACTION[x.action] ?? x.action}</strong> · {fmtDateTime(x.created_at)} · {x.user_name ?? 'sistema'}
                          </li>
                        ))}
                      </ul>
                    )
                  }
                </Async>
              </section>

              {edit && <ClientForm initial={s} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); q.reload(); history.reload(); }} />}
            </>
          );
        }}
      </Async>
    </div>
  );
}

const ACTION: Record<string, string> = {
  create: 'Cadastro',
  update: 'Edição',
  pause: 'Monitoramento pausado',
  resume: 'Monitoramento reativado',
  archive: 'Arquivado',
  restore: 'Restaurado',
  manual_collect: 'Coleta manual solicitada',
  purge: 'Excluído definitivamente',
};
