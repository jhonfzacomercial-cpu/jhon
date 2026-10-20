import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FilterBar, useRangeFilter } from '../components/Filters';
import { ClientBars, FollowersLine } from '../components/charts';
import { Async, Change, DemoBadge, NotAvailable, SortHeader } from '../components/ui';
import { qs } from '../lib/api';
import { fmtDayKey, fmtInt, fmtPct, fmtSigned } from '../lib/format';
import { useApi } from '../lib/hooks';
import type { Paged, ProfileSummary } from '../lib/types';
import type { OverviewData } from './Overview';

type Key = 'name' | 'followers' | 'c24' | 'c7' | 'c30' | 'p7' | 'p30';

export function GrowthPage() {
  const [f, setF] = useRangeFilter(30);
  const ov = useApi<OverviewData>(`/api/overview${qs({ from: f.from, to: f.to, clientIds: f.clientIds })}`);
  const list = useApi<Paged<ProfileSummary>>('/api/clients?pageSize=200&status=active');
  const [sort, setSort] = useState<Key>('c7');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');

  const rows = useMemo(() => {
    const val = (s: ProfileSummary): number | string | null =>
      ({
        name: s.clientName.toLowerCase(),
        followers: s.currentFollowers,
        c24: s.change24h.absolute,
        c7: s.change7d.absolute,
        c30: s.change30d.absolute,
        p7: s.change7d.percent,
        p30: s.change30d.percent,
      })[sort];
    return [...(list.data?.items ?? [])].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va == null) return vb == null ? 0 : 1;
      if (vb == null) return -1;
      return (va < vb ? -1 : va > vb ? 1 : 0) * (dir === 'asc' ? 1 : -1);
    });
  }, [list.data, sort, dir]);

  const onSort = (k: string) => {
    if (k === sort) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setSort(k as Key);
      setDir(k === 'name' ? 'asc' : 'desc');
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Crescimento</h1>
          <p className="muted">Variação líquida de seguidores por cliente. Não representa ganhos e perdas separadamente.</p>
        </div>
      </div>
      <FilterBar value={f} onChange={setF} />
      <Async q={ov}>
        {(d) => (
          <section className="grid-2">
            <div className="card">
              <h2>Seguidores {f.clientIds.length ? 'do cliente' : 'da carteira'}</h2>
              <FollowersLine data={d.charts.portfolio.map((p) => ({ day: p.day, followers: p.followers, note: `${p.profiles} de ${p.expectedProfiles} perfis` }))} />
            </div>
            <div className="card">
              <h2>Variação percentual no período</h2>
              <p className="card-sub">Primeiro x último fechamento disponível no período.</p>
              <ClientBars
                diverging
                valueKey="Variação"
                format={(n) => fmtPct(n)}
                emptyLabel="Sem dois dias de coleta no período."
                data={d.charts.growthByClient.map((g) => ({
                  label: g.clientName,
                  value: g.percent,
                  extra: [
                    ['Absoluta', fmtSigned(g.change)],
                    ['Período real', g.fromDay ? `${fmtDayKey(g.fromDay)} a ${fmtDayKey(g.toDay!)}` : '—'],
                  ],
                }))}
              />
            </div>
          </section>
        )}
      </Async>

      <Async q={list}>
        {() => (
          <div className="card table-card">
            <h2>Comparativo por cliente</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <SortHeader label="Cliente" k="name" sort={sort} dir={dir} onSort={onSort} />
                    <SortHeader label="Seguidores" k="followers" sort={sort} dir={dir} onSort={onSort} />
                    <SortHeader label="24 h" k="c24" sort={sort} dir={dir} onSort={onSort} />
                    <SortHeader label="7 dias" k="c7" sort={sort} dir={dir} onSort={onSort} />
                    <SortHeader label="% 7 dias" k="p7" sort={sort} dir={dir} onSort={onSort} />
                    <SortHeader label="30 dias" k="c30" sort={sort} dir={dir} onSort={onSort} />
                    <SortHeader label="% 30 dias" k="p30" sort={sort} dir={dir} onSort={onSort} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.clientId}>
                      <td>
                        <Link to={`/clientes/${s.clientId}`}>{s.clientName}</Link> {s.isDemo && <DemoBadge />}
                        <small className="block muted">@{s.username}</small>
                      </td>
                      <td className="num">{s.currentFollowers == null ? <NotAvailable reason="Sem coleta" /> : fmtInt(s.currentFollowers)}</td>
                      <td className="num"><Change c={s.change24h} showPct={false} /></td>
                      <td className="num"><Change c={s.change7d} showPct={false} /></td>
                      <td className="num">{s.change7d.absolute == null ? '—' : fmtPct(s.change7d.percent)}</td>
                      <td className="num"><Change c={s.change30d} showPct={false} /></td>
                      <td className="num">{s.change30d.absolute == null ? '—' : fmtPct(s.change30d.percent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="footnote">Valores ausentes indicam histórico insuficiente ou falta de coleta perto do início do período; nunca são tratados como zero.</p>
          </div>
        )}
      </Async>
    </div>
  );
}
