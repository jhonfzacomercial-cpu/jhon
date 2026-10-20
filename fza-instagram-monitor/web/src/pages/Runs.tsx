import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Async, Badge, Empty, Pagination } from '../components/ui';
import { qs } from '../lib/api';
import { RUN_STATUS, fmtDateTime } from '../lib/format';
import { useApi } from '../lib/hooks';
import type { Paged, Run } from '../lib/types';

export function RunsPage() {
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [status]);
  const q = useApi<Paged<Run> & { errorLabels: Record<string, string> }>(`/api/runs${qs({ status, page })}`, 30_000);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Histórico de coletas</h1>
          <p className="muted">Cada tentativa de coleta, com resultado, erro e duração. Atualiza a cada 30 s.</p>
        </div>
      </div>
      <div className="filter-bar">
        <div className="seg" role="group" aria-label="Resultado">
          {[['all', 'Todas'], ['success', 'Sucesso'], ['partial', 'Parciais'], ['failed', 'Falhas'], ['abandoned', 'Interrompidas'], ['running', 'Em execução']].map(([k, l]) => (
            <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{l}</button>
          ))}
        </div>
      </div>
      <Async q={q}>
        {(d) =>
          d.total === 0 ? (
            <Empty title="Nenhuma execução registrada.">As coletas aparecem aqui quando o worker estiver em execução e houver uma fonte configurada.</Empty>
          ) : (
            <div className="card table-card">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Início</th><th>Cliente</th><th>Origem</th><th>Resultado</th><th>Tentativa</th><th>Registros</th><th>Duração</th><th>Erro</th></tr>
                  </thead>
                  <tbody>
                    {d.items.map((r) => (
                      <tr key={r.id}>
                        <td>{fmtDateTime(r.started_at)}</td>
                        <td><Link to={`/clientes/${r.client_id}`}>{r.client_name}</Link><small className="block muted">@{r.username}</small></td>
                        <td>{r.trigger === 'manual' ? 'Manual' : 'Agendada'}<small className="block muted">{r.source}</small></td>
                        <td><Badge tone={RUN_STATUS[r.status]?.tone ?? 'neutral'}>{RUN_STATUS[r.status]?.label ?? r.status}</Badge></td>
                        <td className="num">{r.attempt}</td>
                        <td className="num">{r.records_processed}{r.media_new ? <small> (+{r.media_new})</small> : null}{r.media_requested ? '' : <small className="block muted">só seguidores</small>}</td>
                        <td className="num">{r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1).replace('.', ',')} s` : '—'}</td>
                        <td>{r.error_code && <strong>{d.errorLabels[r.error_code] ?? r.error_code}</strong>}<small className="block">{r.error_message}</small></td>
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
    </div>
  );
}
