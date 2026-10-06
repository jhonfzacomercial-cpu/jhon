import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Table2, Columns3, Plus, Search } from 'lucide-react';
import { useStore, useDados, useAcao } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import * as f from '../lib/formato.js';
import { PageHead, Card, Vazio, Seg, Chips, Select, Prioridade, Prazo, Status, Badge } from '../components/ui.jsx';
import { Kanban } from '../components/Kanban.jsx';
import { hoje, addDias, normalizar, STATUS_JOB, PRIORIDADES, PRIORIDADE_PESO, JOB_FECHADO, DIAS_PROXIMOS } from '../../shared/constantes.js';

const aberto = (j) => !JOB_FECHADO.includes(j.status);
const FILTROS = {
  todos: aberto,
  atrasados: (j) => j.atrasado,
  hoje: (j) => aberto(j) && j.prazo === hoje(),
  proximos: (j) => aberto(j) && j.prazo > hoje() && j.prazo <= addDias(hoje(), DIAS_PROXIMOS),
  aguardando: (j) => j.status.startsWith('Aguardando'),
  fechados: (j) => !aberto(j),
};

export function Jobs() {
  const { abrir, ativos } = useStore();
  const acao = useAcao();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [filtro, setFiltro] = useState(params.get('filtro') || 'todos');
  const [visao, setVisao] = useState('tabela');
  const [resp, setResp] = useState('');
  const [cliente, setCliente] = useState('');
  const [status, setStatus] = useState('');
  const [prioridade, setPrioridade] = useState('');
  const [texto, setTexto] = useState('');
  const { dados } = useDados('/jobs', { inicial: [] });
  const jobs = dados || [];
  const clientes = useMemo(() => [...new Set(jobs.map((j) => j.cliente).filter(Boolean))].sort(), [jobs]);

  const base = jobs.filter((j) => (!resp || String(j.colaborador_id) === resp) && (!cliente || j.cliente === cliente)
    && (!status || j.status === status) && (!prioridade || j.prioridade === prioridade)
    && (!texto || normalizar(`${j.numero} ${j.titulo} ${j.cliente} ${j.proxima_acao}`).includes(normalizar(texto).replace(/^job\s*/, ''))));
  const lista = base.filter(FILTROS[filtro]).sort((a, b) => (b.atrasado - a.atrasado) || (b.dias_atraso - a.dias_atraso)
    || (a.prazo || '9999').localeCompare(b.prazo || '9999') || PRIORIDADE_PESO[a.prioridade] - PRIORIDADE_PESO[b.prioridade]);
  const cont = (k) => base.filter(FILTROS[k]).length;

  return (
    <>
      <PageHead eyebrow="Controle de JOBs" titulo="JOBs da agência" sub="Onde estão os problemas, sem abrir outros sistemas.">
        <Seg valor={visao} onChange={setVisao} opcoes={[['tabela', 'Tabela', Table2], ['kanban', 'Kanban', Columns3]]} />
        <button className="btn primary" onClick={() => abrir('job')}><Plus /> Novo JOB</button>
      </PageHead>
      <div className="toolbar">
        <Chips valor={filtro} onChange={setFiltro} opcoes={[
          ['todos', 'Em aberto', cont('todos')], ['atrasados', '🔴 Atrasados', cont('atrasados')], ['hoje', 'Hoje', cont('hoje')],
          ['proximos', 'Próximos 7 dias', cont('proximos')], ['aguardando', 'Aguardando', cont('aguardando')], ['fechados', 'Concluídos/cancelados', cont('fechados')],
        ]} />
      </div>
      <div className="toolbar">
        <div className="search-input"><Search /><input className="input" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Nº, nome, cliente…" /></div>
        <Select valor={resp} onChange={setResp} vazio="Todos os responsáveis" opcoes={ativos.map((c) => [String(c.id), c.nome])} />
        <Select valor={cliente} onChange={setCliente} vazio="Todos os clientes" opcoes={clientes} />
        <Select valor={status} onChange={setStatus} vazio="Todos os status" opcoes={STATUS_JOB} />
        <Select valor={prioridade} onChange={setPrioridade} vazio="Todas as prioridades" opcoes={PRIORIDADES} />
      </div>

      {visao === 'tabela' ? (
        <Card>
          {lista.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Nº</th><th>JOB</th><th>Responsável</th><th>Prazo</th><th>Status</th><th>Próxima ação</th><th>Última atualização</th></tr>
                </thead>
                <tbody>
                  {lista.map((j) => (
                    <tr key={j.id} className={`clickable ${j.atrasado ? 'alerta' : ''}`} onClick={() => nav(`/jobs/${j.id}`)}>
                      <td><span className="badge dark mono">{j.numero}</span></td>
                      <td style={{ minWidth: 200 }}>
                        <div className="row"><Prioridade p={j.prioridade} /><span className="strong">{j.titulo}</span></div>
                        <div className="tiny muted">{[j.cliente, j.setor].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="nowrap">{j.colaborador_nome || <span className="muted">—</span>}</td>
                      <td className="nowrap"><Prazo data={j.prazo} fechado={!aberto(j)} /></td>
                      <td className="nowrap"><div className="row" style={{ gap: 4 }}><Status s={j.status} />{j.atrasado && j.status !== 'Atrasado' && <Badge tom="red">atrasado</Badge>}</div></td>
                      <td style={{ minWidth: 180 }}>
                        {j.proxima_acao ? <><div className="small">{j.proxima_acao}</div><div className="tiny muted">{j.proxima_acao_responsavel}</div></> : <span className="muted small">—</span>}
                      </td>
                      <td className="nowrap small">
                        <span className={j.sem_atualizacao ? 'num-red' : ''}>{f.relativo(j.atualizado_em.slice(0, 10))}</span>
                        {j.ultimo_registro && <div className="tiny muted ellipsis" style={{ maxWidth: 180 }}>{j.ultimo_registro}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Vazio big>Nenhum JOB neste filtro.</Vazio>}
        </Card>
      ) : (
        <Kanban
          colunas={STATUS_JOB.filter((s) => s !== 'Atrasado' && (filtro === 'fechados' || !JOB_FECHADO.includes(s)))}
          itens={filtro === 'fechados' ? lista : base.filter(aberto)}
          colunaDe={(j) => (j.status === 'Atrasado' ? 'Em produção' : j.status)}
          onMover={(j, s) => acao(() => api.put(`/jobs/${j.id}`, { status: s }), `JOB ${j.numero} → ${s}`)}
          onAbrir={(j) => nav(`/jobs/${j.id}`)}
          renderCard={(j) => (
            <>
              <div className="row" style={{ marginBottom: 4 }}><span className="badge dark mono">{j.numero}</span><Prioridade p={j.prioridade} /><span className="tiny muted ellipsis">{j.cliente}</span></div>
              <div className="kcard-title">{j.titulo}</div>
              <div className="row"><span className="small muted grow ellipsis">{j.colaborador_nome || '—'}</span><Prazo data={j.prazo} fechado={!aberto(j)} /></div>
            </>
          )}
        />
      )}
    </>
  );
}
