import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FilterBar, useRangeFilter } from '../components/Filters';
import { CountBars } from '../components/charts';
import { Async, DemoBadge, Empty, Icon, Pagination } from '../components/ui';
import { qs } from '../lib/api';
import { MEDIA_TYPE, fmtDateTime, fmtInt, fmtPeriod } from '../lib/format';
import { useApi } from '../lib/hooks';
import type { MediaItem, Paged } from '../lib/types';
import type { OverviewData } from './Overview';

export function PostsPage() {
  const [f, setF] = useRangeFilter(30);
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [f, type]);
  const clientId = f.clientIds[0];
  const ov = useApi<OverviewData>(`/api/overview${qs({ from: f.from, to: f.to, clientIds: f.clientIds })}`);
  const media = useApi<Paged<MediaItem>>(`/api/media${qs({ from: f.from, to: f.to, clientId, type, page })}`);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Publicações</h1>
          <p className="muted">Publicações observadas pelo sistema, ordenadas pela data de publicação.</p>
        </div>
        <a className="btn" href={`/api/export/media.csv${qs({ clientId })}`}>
          <Icon name="download" /> CSV
        </a>
      </div>
      <FilterBar value={f} onChange={setF} />
      <Async q={ov}>
        {(d) => (
          <section className="grid-2">
            <div className="card">
              <h2>Quantidade por semana</h2>
              <CountBars data={d.charts.postsPerWeek} xKey="week" xFormat={fmtPeriod} label="Publicações" />
            </div>
            <div className="card table-card">
              <h2>Frequência por cliente</h2>
              <div className="table-wrap">
                <table className="compact">
                  <thead>
                    <tr><th>Cliente</th><th>Por semana</th><th>Meta</th><th>30 dias</th><th>Dias sem publicar</th></tr>
                  </thead>
                  <tbody>
                    {d.charts.postingByClient.map((p) => (
                      <tr key={p.clientId}>
                        <td><Link to={`/clientes/${p.clientId}`}>{p.clientName}</Link></td>
                        <td className="num">{!p.available ? <span className="na">Não coletado</span> : p.postsPerWeek == null ? <span className="na" title="Mínimo de 7 dias de cobertura">Insuficiente</span> : p.postsPerWeek.toFixed(1).replace('.', ',')}</td>
                        <td className="num">{p.goal ?? '—'}</td>
                        <td className="num">{p.last30 ? `${p.last30.complete ? '' : '≥ '}${p.last30.count}` : '—'}</td>
                        <td className="num">{p.daysSinceLatest ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="footnote">“≥” indica cobertura parcial: a fonte só devolve as publicações mais recentes e o monitoramento começou depois do início da janela.</p>
            </div>
          </section>
        )}
      </Async>

      <div className="filter-bar">
        <label className="inline">
          Tipo
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(MEDIA_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
      </div>
      <Async q={media}>
        {(m) =>
          m.total === 0 ? (
            <Empty title="Nenhuma publicação no período." >As publicações aparecem após a primeira coleta de mídia bem-sucedida.</Empty>
          ) : (
            <div className="card table-card">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Miniatura</th><th>Cliente</th><th>Tipo</th><th>Publicada em</th><th>Descoberta pelo sistema</th><th>Curtidas</th><th>Comentários</th><th>Link</th></tr>
                  </thead>
                  <tbody>
                    {m.items.map((it) => (
                      <tr key={it.id}>
                        <td>{it.thumbnail_url ? <img className="thumb" src={it.thumbnail_url} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="thumb thumb-ph">{MEDIA_TYPE[it.media_type].slice(0, 3)}</span>}</td>
                        <td><Link to={`/clientes/${it.client_id}`}>{it.client_name}</Link> {it.source === 'demo' && <DemoBadge />}<small className="block muted">@{it.username}</small></td>
                        <td>{MEDIA_TYPE[it.media_type]}</td>
                        <td>{fmtDateTime(it.published_at)}</td>
                        <td><small>{fmtDateTime(it.first_seen_at)}</small></td>
                        <td className="num">{fmtInt(it.like_count)}</td>
                        <td className="num">{fmtInt(it.comments_count)}</td>
                        <td>{it.permalink ? <a href={it.permalink} target="_blank" rel="noopener noreferrer">Abrir <Icon name="external" size={13} /></a> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={m.page} pageSize={m.pageSize} total={m.total} onPage={setPage} />
            </div>
          )
        }
      </Async>
    </div>
  );
}
