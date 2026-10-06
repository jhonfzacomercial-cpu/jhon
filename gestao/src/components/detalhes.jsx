import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Trash2, Paperclip, Plus, X, BellRing, ListTodo, CheckCircle2, Download } from 'lucide-react';
import { useStore, useAcao, useDados } from '../lib/store.jsx';
import { api, arquivoParaBase64 } from '../lib/api.js';
import * as f from '../lib/formato.js';
import { Modal, Status, Prioridade, Prazo, Badge, Select, Confirmar, Timeline, Campo, Vazio } from './ui.jsx';
import { STATUS_TAREFA, STATUS_COBRANCA, hoje, addDias } from '../../shared/constantes.js';

const ORIGEM = { manual: 'Manual', daily: 'Daily', one_a_one: 'One a One', cobranca: 'Cobrança' };

function Linha({ rotulo, children }) {
  return (
    <div className="row top" style={{ padding: '7px 0', borderBottom: '1px solid var(--rule)' }}>
      <span className="muted small" style={{ width: 130, flex: 'none' }}>{rotulo}</span>
      <div className="grow">{children}</div>
    </div>
  );
}

// =============== TAREFA ===============
export function TarefaDetalhe({ id, onClose }) {
  const { abrir, toast } = useStore();
  const acao = useAcao();
  const { dados: t } = useDados(`/tarefas/${id}`);
  const [novoItem, setNovoItem] = useState('');
  const arquivo = useRef(null);
  if (!t) return null;
  const mudarStatus = (status) => acao(() => api.put(`/tarefas/${id}`, { status }), status === 'Concluído' ? 'Tarefa concluída ✓' : `Status: ${status}`);
  const addItem = async (e) => {
    e.preventDefault();
    if (!novoItem.trim()) return;
    if (await acao(() => api.post(`/tarefas/${id}/checklist`, { texto: novoItem }))) setNovoItem('');
  };
  const anexar = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) return toast('Arquivo maior que 15 MB', 'erro');
    const base64 = await arquivoParaBase64(file);
    await acao(() => api.post(`/tarefas/${id}/anexos`, { nome: file.name, tipo: file.type, base64 }), 'Anexo adicionado');
  };
  const concluido = t.status === 'Concluído';
  return (
    <Modal drawer onClose={onClose} icone={<ListTodo size={18} />} titulo={<span className={concluido ? 'item-title done' : ''}>{t.titulo}</span>}
      rodape={<>
        <Confirmar onConfirm={() => { onClose(); acao(() => api.del(`/tarefas/${id}`), 'Tarefa removida'); }}><Trash2 size={15} /> Excluir</Confirmar>
        <span className="grow" />
        <button className="btn" onClick={() => { onClose(); abrir('tarefa', t); }}><Pencil /> Editar</button>
        {concluido
          ? <button className="btn" onClick={() => mudarStatus('A fazer')}>Reabrir</button>
          : <button className="btn primary" onClick={() => mudarStatus('Concluído')}><CheckCircle2 /> Concluir</button>}
      </>}>
      <div className="stack loose">
        <div className="row wrap">
          <Status s={t.status_efetivo} />
          <Prioridade p={t.prioridade} texto />
          <Badge tom="outline">{t.categoria}</Badge>
          {t.reagendamentos > 0 && <Badge tom="orange">reagendada {t.reagendamentos}×</Badge>}
          {t.sem_atualizacao && <Badge tom="yellow">sem atualização</Badge>}
        </div>
        <div>
          <Linha rotulo="Responsável">{t.colaborador_id ? <Link className="strong" to={`/equipe/${t.colaborador_id}`} onClick={onClose}>{t.colaborador_nome}</Link> : 'Eu (Jhonatas)'}</Linha>
          <Linha rotulo="Prazo"><Prazo data={t.prazo} fechado={concluido} />{t.hora && <span className="mono small" style={{ marginLeft: 8 }}>{t.hora}</span>}</Linha>
          <Linha rotulo="Status">
            <Select valor={t.status} onChange={mudarStatus} opcoes={STATUS_TAREFA} style={{ maxWidth: 220, minHeight: 32, padding: '4px 8px' }} />
          </Linha>
          {t.job_id && <Linha rotulo="JOB"><Link className="strong" to={`/jobs/${t.job_id}`} onClick={onClose}>JOB {t.job_numero} — {t.job_titulo}</Link></Linha>}
          <Linha rotulo="Origem">{ORIGEM[t.origem] || t.origem}{t.daily_id ? ' (combinado em Daily)' : ''}</Linha>
          <Linha rotulo="Criada em">{f.dataHora(t.criado_em)}</Linha>
          <Linha rotulo="Última atualização">{f.dataHora(t.atualizado_em)}</Linha>
          {t.concluido_em && <Linha rotulo="Concluída em">{f.dataHora(t.concluido_em)}</Linha>}
        </div>
        {t.descricao && <div><div className="label">Descrição</div><p className="pre" style={{ margin: '4px 0 0' }}>{t.descricao}</p></div>}
        {t.observacoes && <div><div className="label">Observações</div><p className="pre" style={{ margin: '4px 0 0' }}>{t.observacoes}</p></div>}

        <div>
          <div className="row between"><span className="label">Checklist</span>{t.checklist.length > 0 && <span className="muted small mono">{t.checklist.filter((c) => c.feito).length}/{t.checklist.length}</span>}</div>
          <div className="list" style={{ marginTop: 6 }}>
            {t.checklist.map((c) => (
              <div key={c.id} className="daily-item">
                <input type="checkbox" className="check" checked={!!c.feito} onChange={(e) => acao(() => api.put(`/checklist/${c.id}`, { feito: e.target.checked }))} />
                <span className={`grow ${c.feito ? 'item-title done' : ''}`}>{c.texto}</span>
                <button className="btn ghost icon sm" aria-label="Remover item" onClick={() => acao(() => api.del(`/checklist/${c.id}`))}><X size={14} /></button>
              </div>
            ))}
          </div>
          <form className="quick-add" style={{ marginTop: 6 }} onSubmit={addItem}>
            <Plus size={16} className="muted" />
            <input className="input" value={novoItem} onChange={(e) => setNovoItem(e.target.value)} placeholder="Adicionar item ao checklist" />
          </form>
        </div>

        <div>
          <div className="row between">
            <span className="label">Anexos</span>
            <button className="btn sm" onClick={() => arquivo.current.click()}><Paperclip /> Anexar</button>
            <input type="file" ref={arquivo} hidden onChange={anexar} />
          </div>
          {t.anexos.length === 0 ? <p className="muted small">Nenhum anexo.</p> : (
            <div className="list" style={{ marginTop: 6 }}>
              {t.anexos.map((a) => (
                <div key={a.id} className="daily-item">
                  <Paperclip size={15} className="muted" />
                  <a className="grow ellipsis strong" href={`/api/anexos/${a.id}`} target="_blank" rel="noreferrer">{a.nome}</a>
                  <span className="muted tiny">{f.tamanho(a.tamanho)}</span>
                  <a className="btn ghost icon sm" href={`/api/anexos/${a.id}`} download={a.nome} aria-label="Baixar"><Download size={14} /></a>
                  <button className="btn ghost icon sm" aria-label="Remover anexo" onClick={() => acao(() => api.del(`/anexos/${a.id}`), 'Anexo removido')}><X size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// =============== COBRANÇA ===============
export function CobrancaDetalhe({ id, onClose }) {
  const { abrir } = useStore();
  const acao = useAcao();
  const { dados: c } = useDados(`/cobrancas/${id}`);
  const [contato, setContato] = useState({ texto: '', status: 'Cobrado', proximo_followup: addDias(hoje(), 1) });
  if (!c) return null;
  const registrar = async (e) => {
    e?.preventDefault();
    const r = await acao(() => api.post(`/cobrancas/${id}/contato`, contato), contato.status === 'Resolvido' ? 'Cobrança resolvida ✓' : 'Cobrança registrada');
    if (r) setContato({ texto: '', status: 'Cobrado', proximo_followup: addDias(hoje(), 1) });
  };
  const resolvido = c.status === 'Resolvido';
  return (
    <Modal drawer onClose={onClose} icone={<BellRing size={18} />} titulo={c.descricao}
      rodape={<>
        <Confirmar onConfirm={() => { onClose(); acao(() => api.del(`/cobrancas/${id}`), 'Cobrança removida'); }}><Trash2 size={15} /> Excluir</Confirmar>
        <span className="grow" />
        <button className="btn" onClick={() => { onClose(); abrir('cobranca', c); }}><Pencil /> Editar</button>
        {resolvido
          ? <button className="btn" onClick={() => acao(() => api.put(`/cobrancas/${id}`, { status: 'Pendente', proximo_followup: hoje() }), 'Cobrança reaberta')}>Reabrir</button>
          : <button className="btn primary" onClick={() => acao(() => api.post(`/cobrancas/${id}/contato`, { status: 'Resolvido', texto: 'Resolvido' }), 'Cobrança resolvida ✓')}><CheckCircle2 /> Resolvido</button>}
      </>}>
      <div className="stack loose">
        <div className="row wrap">
          <Status s={c.status} />
          {c.vencida && <Badge tom="red">prazo vencido</Badge>}
          {c.cobrar_hoje && <Badge tom="orange">cobrar hoje</Badge>}
        </div>
        <div>
          <Linha rotulo="Pessoa">{c.colaborador_id ? <Link className="strong" to={`/equipe/${c.colaborador_id}`} onClick={onClose}>{c.pessoa_nome}</Link> : c.pessoa_nome}</Linha>
          <Linha rotulo="Criada em">{f.data(c.data)}</Linha>
          <Linha rotulo="Prazo esperado">{c.prazo ? <Prazo data={c.prazo} fechado={resolvido} /> : '—'}</Linha>
          <Linha rotulo="Último contato">{c.ultimo_contato ? `${f.data(c.ultimo_contato)} (${f.relativo(c.ultimo_contato)})` : 'ainda não cobrado'}</Linha>
          <Linha rotulo="Próximo follow-up">{c.proximo_followup ? <Prazo data={c.proximo_followup} /> : '—'}</Linha>
          {c.job_id && <Linha rotulo="JOB"><Link className="strong" to={`/jobs/${c.job_id}`} onClick={onClose}>JOB {c.job_numero} — {c.job_titulo}</Link></Linha>}
          {c.observacao && <Linha rotulo="Observação"><span className="pre">{c.observacao}</span></Linha>}
        </div>

        {!resolvido && (
          <form className="card card-pad stack" style={{ background: 'var(--surface-2)', boxShadow: 'none' }} onSubmit={registrar}>
            <h3>Registrar cobrança feita</h3>
            <Campo rotulo="O que foi dito?">
              <input className="input" value={contato.texto} onChange={(e) => setContato({ ...contato, texto: e.target.value })} placeholder="Ex.: Prometeu entregar amanhã" />
            </Campo>
            <div className="form-grid">
              <Campo rotulo="Novo status">
                <Select valor={contato.status} onChange={(v) => setContato({ ...contato, status: v })} opcoes={STATUS_COBRANCA} />
              </Campo>
              {contato.status !== 'Resolvido' && (
                <Campo rotulo="Próximo follow-up">
                  <input type="date" className="input" value={contato.proximo_followup} onChange={(e) => setContato({ ...contato, proximo_followup: e.target.value })} />
                </Campo>
              )}
            </div>
            <div className="form-actions"><button className="btn dark" type="submit">Registrar</button></div>
          </form>
        )}

        <div>
          <div className="label" style={{ marginBottom: 10 }}>Histórico de contatos</div>
          {c.contatos.length ? (
            <Timeline itens={c.contatos.map((k) => ({ key: k.id, data: `${f.data(k.data)} · ${f.relativo(k.data)}`, corpo: k.texto || 'Cobrança realizada', tom: 'amber' }))} />
          ) : <Vazio>Nenhum contato registrado.</Vazio>}
        </div>
      </div>
    </Modal>
  );
}

export function DetalhesGlobais() {
  const { painel, fecharDetalhe } = useStore();
  if (!painel) return null;
  if (painel.tipo === 'tarefa') return <TarefaDetalhe key={painel.id} id={painel.id} onClose={fecharDetalhe} />;
  if (painel.tipo === 'cobranca') return <CobrancaDetalhe key={painel.id} id={painel.id} onClose={fecharDetalhe} />;
  return null;
}
