import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { ArrowLeft, Plus, X, Flag, Lock, RotateCcw, CheckCircle2, Repeat, AlertOctagon, ListTodo, Trash2 } from 'lucide-react';
import { useStore, useDados, useAcao } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import * as f from '../lib/formato.js';
import { Card, Vazio, Status, Badge, AutoTextarea, Avatar, Campo, Confirmar } from '../components/ui.jsx';
import { Trilha } from '../components/Evolucao.jsx';
import { PERGUNTAS_FEEDBACK, RESULTADOS_CPC, RESULTADO_ICONE, TIPOS_CPC, addMeses, mesDe } from '../../shared/constantes.js';

const COLUNAS = {
  Continuar: { cls: 'continuar', dica: 'O que está fazendo bem e deve continuar.', ph: 'Ex.: Boa comunicação com os clientes' },
  Parar: { cls: 'parar', dica: 'Comportamentos ou práticas a interromper.', ph: 'Ex.: Deixar demandas sem atualização' },
  Começar: { cls: 'comecar', dica: 'Competências ou hábitos a desenvolver.', ph: 'Ex.: Ser mais analítica antes de decidir' },
};
const TOM_TIPO = { Continuar: 'green', Parar: 'red', Começar: 'amber' };

function NovoCpc({ tipo, onAdd, desabilitado }) {
  const [v, setV] = useState('');
  if (desabilitado) return null;
  return (
    <form className="quick-add" onSubmit={async (e) => { e.preventDefault(); if (v.trim() && await onAdd(tipo, v.trim())) setV(''); }}>
      <Plus size={15} className="muted" />
      <input className="input" value={v} onChange={(e) => setV(e.target.value)} placeholder={COLUNAS[tipo].ph} />
    </form>
  );
}

export function OneAOne() {
  const { id } = useParams();
  const nav = useNavigate();
  const { toast } = useStore();
  const acao = useAcao();
  const { dados: o } = useDados(`/one-a-ones/${id}`);
  const [rascunho, setRascunho] = useState(null);
  const [salvo, setSalvo] = useState('salvo');
  const [criarTarefas, setCriarTarefas] = useState(true);
  const iniciado = useRef(null);
  const timer = useRef(null);
  const atual = useRef(null);

  useEffect(() => {
    if (!o || iniciado.current === o.id) return;
    iniciado.current = o.id;
    atual.current = {
      campos: {
        data: o.data, hora: o.hora || '', pontos_positivos: o.pontos_positivos || '', pontos_atencao: o.pontos_atencao || '',
        compromissos_gestor: o.compromissos_gestor || '', compromissos_colaborador: o.compromissos_colaborador || '',
        observacoes: o.observacoes || '', proxima_avaliacao: o.proxima_avaliacao || '',
      },
      respostas: { ...o.respostas },
      avaliacoes: Object.fromEntries(Object.entries(o.avaliacoes).map(([k, a]) => [k, a ? { resultado: a.resultado, observacao: a.observacao || '', encerrar: !!a.encerrar } : null])),
    };
    setRascunho(atual.current);
  }, [o]);

  const persistir = async (r = atual.current) => {
    clearTimeout(timer.current);
    try {
      await api.put(`/one-a-ones/${id}`, { ...r.campos, respostas: r.respostas, avaliacoes: r.avaliacoes });
      setSalvo('salvo');
      return true;
    } catch (e) {
      setSalvo('erro');
      toast(e.message, 'erro');
      return false;
    }
  };
  const alterar = (fn) => {
    const novo = fn(atual.current);
    atual.current = novo;
    setRascunho(novo);
    setSalvo('pendente');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => persistir(novo), 900);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!o || !rascunho) return null;
  const fechado = o.status === 'Finalizado';
  const campo = (k) => (v) => alterar((r) => ({ ...r, campos: { ...r.campos, [k]: v } }));
  const avaliar = (cpcId, patch) => alterar((r) => {
    const atual = r.avaliacoes[cpcId] || { resultado: '', observacao: '', encerrar: false };
    const prox = { ...atual, ...patch };
    return { ...r, avaliacoes: { ...r.avaliacoes, [cpcId]: prox.resultado ? prox : null } };
  });
  const addCpc = (tipo, descricao) => acao(() => api.post('/cpc', { colaborador_id: o.colaborador_id, one_on_one_id: o.id, tipo, descricao }));
  const finalizar = async () => {
    if (!(await persistir())) return;
    const r = await acao(() => api.post(`/one-a-ones/${id}/finalizar`, { criar_tarefas: criarTarefas }), 'One a One finalizado ✓');
    if (r) {
      iniciado.current = null;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const avaliados = o.paraAvaliar.filter((p) => rascunho.avaliacoes[p.id]?.resultado).length;
  const respondidas = PERGUNTAS_FEEDBACK.filter((q) => rascunho.respostas[q.chave]?.trim()).length;
  const proximaPadrao = rascunho.campos.proxima_avaliacao || '';
  const c = o.colaborador;

  return (
    <>
      <button className="btn ghost sm" onClick={() => nav(-1)} style={{ marginBottom: 10 }}><ArrowLeft /> Voltar</button>
      <div className="page-head">
        <div className="profile-head">
          <Avatar nome={c.nome} size="lg" />
          <div>
            <div className="eyebrow">One a One — {f.mes(o.mes)}</div>
            <h1>{c.nome}</h1>
            <div className="row wrap" style={{ marginTop: 4 }}>
              <span className="muted">{c.cargo}</span>
              <Status s={o.status} />
              {fechado && <span className="small muted">finalizado em {f.dataHora(o.finalizado_em)}</span>}
              {!fechado && <span className="tiny muted">{salvo === 'salvo' ? '✓ rascunho salvo' : salvo === 'pendente' ? 'salvando…' : '⚠ erro ao salvar'}</span>}
            </div>
          </div>
        </div>
        <div className="row wrap">
          <label className="field"><span>Data</span><input type="date" className="input" disabled={fechado} value={rascunho.campos.data} onChange={(e) => campo('data')(e.target.value)} /></label>
          <label className="field"><span>Hora</span><input type="time" className="input" disabled={fechado} value={rascunho.campos.hora} onChange={(e) => campo('hora')(e.target.value)} /></label>
          {fechado && <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => acao(() => api.post(`/one-a-ones/${id}/reabrir`), 'One a One reaberto para edição')}><RotateCcw /> Reabrir</button>}
        </div>
      </div>

      <div className="steps">
        <a href="#avaliacao" className={`step ${o.paraAvaliar.length && avaliados === o.paraAvaliar.length ? 'done' : ''}`}><b>01</b> Avaliação do mês anterior {o.paraAvaliar.length ? `${avaliados}/${o.paraAvaliar.length}` : ''}</a>
        <a href="#cpc" className={`step ${o.novos.length ? 'done' : ''}`}><b>02</b> CPC do mês · {o.novos.length}</a>
        <a href="#feedback" className={`step ${respondidas ? 'done' : ''}`}><b>03</b> Feedback do colaborador · {respondidas}/{PERGUNTAS_FEEDBACK.length}</a>
        <a href="#fechamento" className={`step ${fechado ? 'done' : ''}`}><b>04</b> Fechamento</a>
      </div>

      <div className="grid grid-main" style={{ alignItems: 'start' }}>
        <div className="stack loose">
          {/* 01 — Avaliação */}
          <Card titulo={<><span className="section-num">01</span> Avaliação do que foi combinado</>} pad>
            <div id="avaliacao" />
            {o.paraAvaliar.length ? (
              <div className="stack loose">
                {o.paraAvaliar.map((p) => {
                  const av = rascunho.avaliacoes[p.id] || {};
                  return (
                    <div key={p.id} className="stack tight" style={{ paddingBottom: 14, borderBottom: '1px solid var(--rule)' }}>
                      <div className="row wrap">
                        <Badge tom={TOM_TIPO[p.tipo]}>{p.tipo}</Badge>
                        <span className="strong grow">{p.descricao}</span>
                        <Trilha avaliacoes={p.avaliacoes.filter((a) => a.one_on_one_id !== o.id)} />
                      </div>
                      <div className="tiny muted">Origem: One a One {f.mes(p.origem_mes || mesDe(p.criado_em))}{p.ultima_avaliacao && p.ultima_avaliacao.one_on_one_id !== o.id ? ` · última avaliação: ${p.ultima_avaliacao.resultado}` : ''}</div>
                      <div className="result-opts">
                        {RESULTADOS_CPC.map((r) => (
                          <button key={r} type="button" disabled={fechado} className={`result-opt ${av.resultado === r ? `on ${r.split(' ')[0]}` : ''}`} onClick={() => avaliar(p.id, { resultado: av.resultado === r ? '' : r })}>
                            {av.resultado === r ? RESULTADO_ICONE[r] : '☐'} {r}
                          </button>
                        ))}
                      </div>
                      {av.resultado && (
                        <>
                          <input className="input" disabled={fechado} value={av.observacao || ''} onChange={(e) => avaliar(p.id, { observacao: e.target.value })} placeholder="Observação da avaliação: o que mudou? exemplos concretos…" />
                          <label className="row small" style={{ cursor: 'pointer' }}>
                            <input type="checkbox" className="check" disabled={fechado} checked={!!av.encerrar} onChange={(e) => avaliar(p.id, { encerrar: e.target.checked })} />
                            Encerrar acompanhamento deste ponto {av.resultado === 'Cumpriu' ? '(meta atingida)' : ''}
                            <span className="muted">— senão, volta para avaliação em {f.mes(addMeses(o.mes, 1))}</span>
                          </label>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : <Vazio>Nenhum ponto de CPC anterior para avaliar.</Vazio>}
          </Card>

          {/* 02 — CPC */}
          <Card titulo={<><span className="section-num">02</span> CPC — Continuar, Parar, Começar</>} pad>
            <div id="cpc" />
            <div className="cpc-cols">
              {TIPOS_CPC.map((tipo) => (
                <div key={tipo} className={`cpc-col ${COLUNAS[tipo].cls}`}>
                  <h3>{tipo.toUpperCase()}</h3>
                  <div className="hint">{COLUNAS[tipo].dica}</div>
                  {o.novos.filter((p) => p.tipo === tipo).map((p) => (
                    <div key={p.id} className="cpc-item">
                      <span className="grow">{p.descricao}</span>
                      {!fechado && <button className="btn ghost icon sm" aria-label="Remover" onClick={() => acao(() => api.del(`/cpc/${p.id}`))}><X size={13} /></button>}
                    </div>
                  ))}
                  <NovoCpc tipo={tipo} onAdd={addCpc} desabilitado={fechado} />
                </div>
              ))}
            </div>
            <p className="tiny muted" style={{ margin: '10px 0 0' }}>Cada ponto vira uma meta acompanhável, avaliada no próximo One a One ({f.mes(addMeses(o.mes, 1))}).</p>
          </Card>

          {/* 03 — Feedback */}
          <Card titulo={<><span className="section-num">03</span> Feedback do colaborador</>} pad>
            <div id="feedback" />
            <div className="stack">
              {PERGUNTAS_FEEDBACK.map((q) => (
                <label key={q.chave} className="field">
                  <span style={{ textTransform: 'uppercase', letterSpacing: '.02em' }}>{q.pergunta}</span>
                  <AutoTextarea disabled={fechado} value={rascunho.respostas[q.chave] || ''} onChange={(v) => alterar((r) => ({ ...r, respostas: { ...r.respostas, [q.chave]: v } }))} />
                </label>
              ))}
            </div>
          </Card>

          {/* 04 — Fechamento */}
          <Card titulo={<><span className="section-num">04</span> Fechamento</>} pad>
            <div id="fechamento" />
            <div className="form-grid">
              <Campo rotulo="Principais pontos positivos"><AutoTextarea disabled={fechado} value={rascunho.campos.pontos_positivos} onChange={campo('pontos_positivos')} /></Campo>
              <Campo rotulo="Principais pontos de atenção"><AutoTextarea disabled={fechado} value={rascunho.campos.pontos_atencao} onChange={campo('pontos_atencao')} /></Campo>
              <Campo rotulo="Compromissos do gestor (um por linha)"><AutoTextarea disabled={fechado} value={rascunho.campos.compromissos_gestor} onChange={campo('compromissos_gestor')} placeholder="Dar retorno das aprovações em 24h" /></Campo>
              <Campo rotulo={`Compromissos de ${c.nome} (um por linha)`}><AutoTextarea disabled={fechado} value={rascunho.campos.compromissos_colaborador} onChange={campo('compromissos_colaborador')} placeholder="Atualizar status das demandas todo dia" /></Campo>
              <Campo rotulo="Observações gerais" full><AutoTextarea disabled={fechado} value={rascunho.campos.observacoes} onChange={campo('observacoes')} /></Campo>
              <Campo rotulo="Próxima avaliação (próximo One a One)" dica="Em branco: mesmo dia preferido no mês seguinte">
                <input type="date" className="input" disabled={fechado} value={proximaPadrao} onChange={(e) => campo('proxima_avaliacao')(e.target.value)} />
              </Campo>
            </div>

            <div className="card card-pad stack tight" style={{ marginTop: 16, background: 'var(--surface-2)', boxShadow: 'none' }}>
              <h3>Resumo</h3>
              <div className="small"><b>Pontos CPC definidos:</b> {o.novos.length ? o.novos.map((p) => `${p.tipo}: ${p.descricao}`).join(' · ') : '—'}</div>
              <div className="small"><b>Avaliações:</b> {o.paraAvaliar.length ? o.paraAvaliar.map((p) => `${rascunho.avaliacoes[p.id]?.resultado ? RESULTADO_ICONE[rascunho.avaliacoes[p.id].resultado] : '⚪'} ${p.descricao}`).join(' · ') : '—'}</div>
              <div className="small"><b>Feedback:</b> {respondidas}/{PERGUNTAS_FEEDBACK.length} perguntas respondidas</div>
              <div className="small"><b>Próxima avaliação:</b> {rascunho.campos.proxima_avaliacao ? f.data(rascunho.campos.proxima_avaliacao, { ano: true }) : f.mes(addMeses(o.mes, 1))}</div>
            </div>

            {!fechado ? (
              <div className="row wrap" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
                <label className="row small" style={{ cursor: 'pointer', marginRight: 'auto' }}>
                  <input type="checkbox" className="check" checked={criarTarefas} onChange={(e) => setCriarTarefas(e.target.checked)} />
                  <ListTodo size={15} /> Transformar compromissos em tarefas acompanháveis
                </label>
                <button className="btn primary lg" onClick={finalizar}><Flag /> FINALIZAR ONE A ONE</button>
              </div>
            ) : (
              <div className="row" style={{ marginTop: 16, color: 'var(--green)' }}><Lock size={16} /> Finalizado — permanece no histórico de {c.nome}. Use “Reabrir” para editar.</div>
            )}
          </Card>
        </div>

        <div className="stack loose" style={{ position: 'sticky', top: 80 }}>
          <Card titulo="Contexto do mês" pad>
            <div className="stack tight small">
              <div className="row between"><span className="muted">Tarefas abertas</span><b>{o.contexto.abertas}</b></div>
              <div className="row between"><span className="muted">Atrasadas</span><b style={{ color: o.contexto.atrasadas ? 'var(--red)' : undefined }}>{o.contexto.atrasadas}</b></div>
              <div className="row between"><span className="muted"><Repeat size={12} /> Recorrentes</span><b>{o.contexto.recorrentes}</b></div>
              {o.contexto.bloqueios.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <div className="label row"><AlertOctagon size={13} color="var(--red)" /> Bloqueios das Dailys</div>
                  {o.contexto.bloqueios.slice(0, 5).map((b) => <div key={b.data} className="small" style={{ marginTop: 4 }}><span className="mono muted">{f.data(b.data)}</span> {b.bloqueios}</div>)}
                </div>
              )}
              <Link to={`/equipe/${c.id}`} className="btn sm ghost" style={{ alignSelf: 'flex-start', marginTop: 6 }}>Perfil completo</Link>
            </div>
          </Card>
          {o.anterior && (
            <Card titulo={`One a One anterior — ${f.mes(o.anterior.mes)}`} pad>
              <div className="stack tight small">
                {o.anterior.pontos_positivos && <div><b>Positivos:</b> {o.anterior.pontos_positivos}</div>}
                {o.anterior.pontos_atencao && <div><b>Atenção:</b> {o.anterior.pontos_atencao}</div>}
                {o.anterior.compromissos_gestor && <div><b>Eu me comprometi:</b> <span className="pre">{o.anterior.compromissos_gestor}</span></div>}
                {o.anterior.compromissos_colaborador && <div><b>{c.nome} se comprometeu:</b> <span className="pre">{o.anterior.compromissos_colaborador}</span></div>}
                <Link to={`/one-a-one/${o.anterior.id}`} className="btn sm ghost" style={{ alignSelf: 'flex-start' }}>Abrir</Link>
              </div>
            </Card>
          )}
          {fechado && <Card pad><div className="row" style={{ color: 'var(--green)' }}><CheckCircle2 size={18} /> <b>One a One concluído</b></div></Card>}
          {!fechado && (
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <Confirmar texto="Excluir este One a One?" onConfirm={async () => { nav('/one-a-one'); await acao(() => api.del(`/one-a-ones/${id}`), 'One a One excluído'); }}><Trash2 size={15} /> Excluir</Confirmar>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
