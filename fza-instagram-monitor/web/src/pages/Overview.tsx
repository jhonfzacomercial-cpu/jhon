import { Link } from 'react-router-dom';
import { useState } from 'react';
import { FilterBar, useRangeFilter } from '../components/Filters';
import { ChangeBars, ClientBars, CountBars, FollowersLine } from '../components/charts';
import { Async, DemoBadge, Empty, Kpi, NotAvailable } from '../components/ui';
import { qs } from '../lib/api';
import { fmtPeriod, fmtDateTime, fmtDayKey, fmtInt, fmtPct, fmtSigned, relative } from '../lib/format';
import { useApi } from '../lib/hooks';

interface Agg {
  absolute: number | null;
  percent: number | null;
  profilesIncluded: number;
  profilesTotal: number;
}

export interface OverviewData {
  range: { from: string; to: string; timezone: string };
  kpis: {
    clients: number;
    clientsActive: number;
    profilesMonitored: number;
    portfolioFollowers: number | null;
    portfolioFollowersProfiles: number;
    changes: { h24: Agg; d7: Agg; d30: Agg };
    growing: number;
    declining: number;
    stableOrZero: number;
    comparable7d: number;
    noPostsBeyondLimit: number;
    delayedOrError: number;
    lastSuccessAt: string | null;
  };
  collection: { provider: { id: string; displayName: string; isDemo: boolean; configured: boolean } | null; followersIntervalMinutes: number; mediaIntervalMinutes: number };
  containsDemoData: boolean;
  charts: {
    portfolio: { day: string; followers: number | null; profiles: number; expectedProfiles: number; change: number | null; changeProfiles: number; changeComplete: boolean }[];
    weekly: { period: string; change: number | null; daysWithData: number; days: number; complete: boolean }[];
    monthly: { period: string; change: number | null; daysWithData: number; days: number; complete: boolean }[];
    growthByClient: { clientId: string; clientName: string; username: string; isDemo: boolean; fromDay: string | null; toDay: string | null; change: number | null; percent: number | null }[];
    postingByClient: { clientId: string; clientName: string; username: string; available: boolean; postsPerWeek: number | null; basisDays: number | null; goal: number | null; daysSinceLatest: number | null; last30: { count: number; complete: boolean } | null }[];
    postsPerWeek: { week: string; posts: number }[];
  };
}

function AggChange({ a }: { a: Agg }) {
  if (a.absolute == null) return <NotAvailable reason="Sem dados comparáveis" />;
  const cls = a.absolute > 0 ? 'pos' : a.absolute < 0 ? 'neg' : 'zero';
  return (
    <span className={`chg ${cls}`}>
      <span className="chg-arrow" aria-hidden="true">{a.absolute > 0 ? '▲' : a.absolute < 0 ? '▼' : '●'}</span>
      {fmtSigned(a.absolute)}
      {a.percent != null && <small> ({fmtPct(a.percent)})</small>}
    </span>
  );
}

const coverage = (a: Agg) => `${a.profilesIncluded} de ${a.profilesTotal} perfis com dados comparáveis`;

export function OverviewPage() {
  const [f, setF] = useRangeFilter(30);
  const [period, setPeriod] = useState<'weekly' | 'monthly'>('weekly');
  const q = useApi<OverviewData>(`/api/overview${qs({ from: f.from, to: f.to, clientIds: f.clientIds })}`, 5 * 60_000);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Visão geral</h1>
          <p className="muted">Carteira de perfis monitorados. Datas em horário de Campo Grande (MS).</p>
        </div>
      </div>
      <FilterBar value={f} onChange={setF} />
      <Async q={q}>
        {(d) =>
          d.kpis.clients === 0 ? (
            <Empty title="Nenhum cliente cadastrado ainda.">
              <Link to="/clientes">Cadastre o primeiro cliente</Link> para iniciar o monitoramento. O histórico começa na primeira coleta bem-sucedida.
            </Empty>
          ) : (
            <>
              {d.containsDemoData && (
                <div className="banner banner-warning">
                  <DemoBadge /> Há dados de demonstração (sintéticos) nesta carteira. Eles não representam o Instagram.
                </div>
              )}
              <section className="kpi-grid">
                <Kpi label="Clientes cadastrados" value={fmtInt(d.kpis.clients)} hint={`${d.kpis.clientsActive} com monitoramento ativo`} />
                <Kpi
                  label="Total agregado da carteira"
                  accent
                  value={d.kpis.portfolioFollowers == null ? <NotAvailable reason="Sem coletas válidas" /> : fmtInt(d.kpis.portfolioFollowers)}
                  hint={`Soma dos seguidores atuais de ${d.kpis.portfolioFollowersProfiles} perfil(is) válido(s)`}
                />
                <Kpi label="Variação líquida 24 h" value={<AggChange a={d.kpis.changes.h24} />} hint={coverage(d.kpis.changes.h24)} />
                <Kpi label="Variação líquida 7 dias" value={<AggChange a={d.kpis.changes.d7} />} hint={coverage(d.kpis.changes.d7)} />
                <Kpi label="Variação líquida 30 dias" value={<AggChange a={d.kpis.changes.d30} />} hint={coverage(d.kpis.changes.d30)} />
                <Kpi
                  label="Cresceram / caíram (7 dias)"
                  value={
                    d.kpis.comparable7d ? (
                      <span>
                        <span className="chg pos">▲ {d.kpis.growing}</span> <span className="sep">/</span> <span className="chg neg">▼ {d.kpis.declining}</span>
                      </span>
                    ) : (
                      <NotAvailable reason="Sem dados comparáveis" />
                    )
                  }
                  hint={`${d.kpis.comparable7d} perfil(is) comparáveis · ${d.kpis.stableOrZero} sem variação`}
                />
                <Kpi label="Sem publicar além do prazo" value={<Link to="/alertas">{fmtInt(d.kpis.noPostsBeyondLimit)}</Link>} hint="Conforme o limite de cada cliente" />
                <Kpi label="Coleta atrasada ou com erro" value={<Link to="/clientes?status=attention">{fmtInt(d.kpis.delayedOrError)}</Link>} hint="Perfis ativos que precisam de atenção" />
                <Kpi
                  label="Última atualização bem-sucedida"
                  value={<span className="kpi-small">{fmtDateTime(d.kpis.lastSuccessAt)}</span>}
                  hint={`${relative(d.kpis.lastSuccessAt)} · coleta a cada ${d.collection.followersIntervalMinutes} min`}
                />
              </section>

              <section className="grid-2">
                <div className="card">
                  <h2>Evolução dos seguidores da carteira</h2>
                  <p className="card-sub">Soma diária (fechamento do dia). Dias em que algum perfil esperado não tem coleta ficam em branco.</p>
                  <FollowersLine
                    data={d.charts.portfolio.map((p) => ({
                      day: p.day,
                      followers: p.followers,
                      note: p.expectedProfiles ? `${p.profiles} de ${p.expectedProfiles} perfis com coleta` : 'nenhum perfil com coleta',
                    }))}
                  />
                </div>
                <div className="card">
                  <h2>Variação líquida por dia</h2>
                  <p className="card-sub">Soma das variações diárias dos perfis com coleta no dia e no dia anterior.</p>
                  <ChangeBars
                    data={d.charts.portfolio}
                    xKey="day"
                    xFormat={fmtDayKey}
                    tipExtra={(r) => [['Perfis incluídos', String(r.changeProfiles)]]}
                  />
                </div>
              </section>

              <section className="card">
                <div className="card-head">
                  <h2>Comparativo {period === 'weekly' ? 'semanal' : 'mensal'}</h2>
                  <div className="seg">
                    <button className={period === 'weekly' ? 'on' : ''} onClick={() => setPeriod('weekly')}>
                      Semanal
                    </button>
                    <button className={period === 'monthly' ? 'on' : ''} onClick={() => setPeriod('monthly')}>
                      Mensal
                    </button>
                  </div>
                </div>
                <ChangeBars
                  data={d.charts[period]}
                  xKey="period"
                  xFormat={fmtPeriod}
                  tipExtra={(r) => [
                    ['Dias com dados', `${r.daysWithData} de ${r.days}`],
                    ['Completo', r.complete ? 'sim' : 'não (há dias sem coleta)'],
                  ]}
                />
              </section>

              <section className="grid-2">
                <div className="card">
                  <h2>Crescimento por cliente no período</h2>
                  <p className="card-sub">Primeiro x último fechamento disponível dentro do período selecionado.</p>
                  <ClientBars
                    diverging
                    valueKey="Variação líquida"
                    format={fmtSigned}
                    emptyLabel="Ainda não há dois dias de coleta no período para nenhum cliente."
                    data={d.charts.growthByClient.map((g) => ({
                      label: g.clientName,
                      value: g.change,
                      extra: [
                        ['Período real', g.fromDay ? `${fmtDayKey(g.fromDay)} a ${fmtDayKey(g.toDay!)}` : '—'],
                        ['Percentual', fmtPct(g.percent)],
                      ],
                    }))}
                  />
                </div>
                <div className="card">
                  <h2>Frequência de publicações por cliente</h2>
                  <p className="card-sub">Média por semana (base de até 30 dias de cobertura).</p>
                  <ClientBars
                    valueKey="Publicações por semana"
                    format={(n) => n.toFixed(1).replace('.', ',')}
                    emptyLabel="Ainda não há cobertura de publicações suficiente (mínimo 7 dias)."
                    data={d.charts.postingByClient.map((p) => ({
                      label: p.clientName,
                      value: p.postsPerWeek,
                      extra: [
                        ['Meta', p.goal != null ? `${p.goal}/semana` : 'não definida'],
                        ['Base', p.basisDays ? `${p.basisDays} dias` : '—'],
                      ],
                    }))}
                  />
                </div>
              </section>

              <section className="card">
                <h2>Publicações por semana</h2>
                <p className="card-sub">Publicações observadas pelo sistema, pela data de publicação. Semanas anteriores ao início do monitoramento podem estar incompletas.</p>
                <CountBars data={d.charts.postsPerWeek} xKey="week" xFormat={fmtPeriod} label="Publicações" />
              </section>
            </>
          )
        }
      </Async>
    </div>
  );
}
