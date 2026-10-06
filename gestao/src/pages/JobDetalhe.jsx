import { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, Pencil, Trash2, BellRing, ListTodo, History, Info, X, Send } from 'lucide-react';
import { useStore, useDados, useAcao } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import * as f from '../lib/formato.js';
import { Card, Vazio, Status, Prioridade, Prazo, Badge, Select, Confirmar } from '../components/ui.jsx';
import { TarefaItem, CobrancaItem } from '../components/itens.jsx';
import { hoje, STATUS_JOB, JOB_FECHADO } from '../../shared/constantes.js';

const ATALHOS = ['Cobrado', 'Ainda aguardando material', 'Material recebido', 'Em produção', 'Enviado para aprovação', 'Aprovado pelo cliente', 'Ajustes solicitados'];

export function JobDetalhe() {
  const { id } = useParams();
  const nav = useNavigate();
  const { abrir } = useStore();
  const acao = useAcao();
  const { dados: j } = useDados(`/jobs/${id}`);
  const [texto, setTexto] = useState('');
  const [data, setData] = useState(hoje());
  const [proxima, setProxima] = useState(null);
  if (!j) return null;

  const registrar = async (e) => {
    e?.preventDefault();
    if (!texto.trim()) return;
    if (await acao(() => api.post(`/jobs/${id}/historico`, { texto, data }), 'Acompanhamento registrado')) { setTexto(''); setData(hoje()); }
  };
  const fechado = JOB_FECHADO.includes(j.status);
  const pessoa = j.proxima_acao_responsavel || j.colaborador_nome || '';

  return (
    <>
      <button className="btn ghost sm" onClick={() => nav(-1)} style={{ marginBottom: 10 }}><ArrowLeft /> Voltar</button>
      <div className="page-head">
        <div>
          <div className="eyebrow">JOB {j.numero}{j.cliente ? ` · ${j.cliente}` : ''}</div>
          <h1>JOB {j.numero} — {j.titulo}</h1>
          <div className="row wrap" style={{ marginTop: 8 }}>
            <Status s={j.status} />
            {j.atrasado && <Badge tom="red">{j.dias_atraso}d de atraso</Badge>}
            <Prioridade p={j.prioridade} texto />
            {j.sem_atualizacao && <Badge tom="yellow">sem atualização há dias</Badge>}
          </div>
        </div>
        <div className="row wrap">
          <Select valor={j.status} onChange={(s) => acao(() => api.put(`/jobs/${id}`, { status: s }), `Status: ${s}`)} opcoes={STATUS_JOB} style={{ width: 'auto' }} />
          <button className="btn" onClick={() => abrir('cobranca', { job_id: j.id, descricao: `JOB ${j.numero}: `, pessoa })}><BellRing /> Cobrar</button>
          <button className="btn" onClick={() => abrir('tarefa', { job_id: j.id, colaborador_id: j.colaborador_id, titulo: '', categoria: 'Cliente' })}><ListTodo /> Tarefa</button>
          <button className="btn" onClick={() => abrir('job', j)}><Pencil /> Editar</button>
        </div>
      </div>

      <div className="grid grid-main">
        <Card titulo="Histórico de acompanhamento" icone={History} contagem={j.historico.length} pad>
          <form className="stack" onSubmit={registrar} style={{ marginBottom: 18 }}>
            <div className="row">
              <input type="date" className="input" style={{ width: 150 }} value={data} onChange={(e) => setData(e.target.value)} />
              <input className="input grow" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="O que aconteceu? Ex.: Cobrado Cristhopher" />
              <button className="btn dark" type="submit" aria-label="Registrar"><Send /></button>
            </div>
            <div className="chips">
              {ATALHOS.map((a) => {
                const t = a === 'Cobrado' && pessoa ? `Cobrado ${pessoa}` : a;
                return <button type="button" key={a} className="chip" onClick={() => setTexto(t)}>{t}</button>;
              })}
            </div>
          </form>
          {j.historico.length ? (
            <div className="timeline">
              {j.historico.map((h) => (
                <div key={h.id} className={`tl-item ${/atraso/i.test(h.texto) ? 'red' : /status/i.test(h.texto) ? 'purple' : /cobra/i.test(h.texto) ? 'amber' : ''}`}>
                  <div className="row between">
                    <span className="tl-date">{f.data(h.data)} · {f.diaSemana(h.data)}</span>
                    <button className="btn ghost icon sm" aria-label="Remover registro" onClick={() => acao(() => api.del(`/job-historico/${h.id}`))}><X size={13} /></button>
                  </div>
                  <div className="tl-body" style={{ color: 'var(--ink)', fontWeight: 500 }}>{h.texto}</div>
                </div>
              ))}
            </div>
          ) : <Vazio>Nenhum registro.</Vazio>}
        </Card>

        <div className="stack loose">
          <Card titulo="Informações" icone={Info} pad>
            <div className="stack tight small">
              {[
                ['Cliente', j.cliente || '—'],
                ['Responsável', j.colaborador_id ? <Link className="strong" to={`/equipe/${j.colaborador_id}`}>{j.colaborador_nome}</Link> : '—'],
                ['Setor', j.setor || '—'],
                ['Entrada', f.data(j.data_entrada)],
                ['Prazo', <Prazo data={j.prazo} fechado={fechado} />],
                ['Última atualização', `${f.dataHora(j.atualizado_em)} (${f.relativo(j.atualizado_em.slice(0, 10))})`],
              ].map(([k, v]) => <div key={k} className="row between"><span className="muted">{k}</span><span>{v}</span></div>)}
            </div>
            <div className="card card-pad" style={{ marginTop: 14, background: 'var(--amber-soft)', border: 0, boxShadow: 'none', padding: 14 }}>
              <div className="label">Próxima ação</div>
              {proxima ? (
                <form className="stack tight" style={{ marginTop: 6 }} onSubmit={async (e) => {
                  e.preventDefault();
                  if (await acao(() => api.put(`/jobs/${id}`, proxima), 'Próxima ação atualizada')) setProxima(null);
                }}>
                  <input className="input" autoFocus value={proxima.proxima_acao} onChange={(e) => setProxima({ ...proxima, proxima_acao: e.target.value })} placeholder="O que precisa acontecer" />
                  <input className="input" value={proxima.proxima_acao_responsavel} onChange={(e) => setProxima({ ...proxima, proxima_acao_responsavel: e.target.value })} placeholder="Quem" />
                  <div className="row"><button className="btn sm dark">Salvar</button><button type="button" className="btn sm ghost" onClick={() => setProxima(null)}>Cancelar</button></div>
                </form>
              ) : (
                <div style={{ marginTop: 4, cursor: 'pointer' }} onClick={() => setProxima({ proxima_acao: j.proxima_acao || '', proxima_acao_responsavel: j.proxima_acao_responsavel || '' })}>
                  <div className="strong">{j.proxima_acao || 'Definir próxima ação…'}</div>
                  {j.proxima_acao_responsavel && <div className="small">com {j.proxima_acao_responsavel}</div>}
                </div>
              )}
            </div>
            {j.observacoes && <p className="pre small" style={{ marginBottom: 0 }}>{j.observacoes}</p>}
          </Card>

          <Card titulo="Cobranças deste JOB" icone={BellRing} contagem={j.cobrancas.filter((c) => c.status !== 'Resolvido').length}>
            <div className="list">{j.cobrancas.map((c) => <CobrancaItem key={c.id} c={c} compacto />)}{!j.cobrancas.length && <Vazio>Nenhuma cobrança vinculada.</Vazio>}</div>
          </Card>
          <Card titulo="Tarefas relacionadas" icone={ListTodo} contagem={j.tarefas.filter((t) => t.status !== 'Concluído').length}>
            <div className="list">{j.tarefas.map((t) => <TarefaItem key={t.id} t={t} />)}{!j.tarefas.length && <Vazio>Nenhuma tarefa vinculada.</Vazio>}</div>
          </Card>
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <Confirmar onConfirm={async () => { nav('/jobs'); await acao(() => api.del(`/jobs/${id}`), 'JOB removido'); }}><Trash2 size={15} /> Excluir JOB</Confirmar>
          </div>
        </div>
      </div>
    </>
  );
}
