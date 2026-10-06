import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellRing, Check, ListChecks, Paperclip, Repeat } from 'lucide-react';
import { useStore, useAcao } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import * as f from '../lib/formato.js';
import { Prioridade, Prazo, Status, Badge } from './ui.jsx';
import { hoje, addDias } from '../../shared/constantes.js';

/** Linha de tarefa com check rápido. */
export function TarefaItem({ t, mostrarResp = true, mostrarStatus = false }) {
  const { detalhe } = useStore();
  const acao = useAcao();
  const feito = t.status === 'Concluído';
  const alternar = (e) => {
    e.stopPropagation();
    acao(() => api.put(`/tarefas/${t.id}`, { status: feito ? 'A fazer' : 'Concluído' }), feito ? 'Tarefa reaberta' : 'Concluída ✓');
  };
  return (
    <div className="item clickable" onClick={() => detalhe('tarefa', t.id)}>
      <input type="checkbox" className="check" checked={feito} onChange={() => {}} onClick={alternar} aria-label="Concluir" />
      <div className="item-main">
        <div className={`item-title ${feito ? 'done' : ''}`}>{t.titulo}</div>
        <div className="item-sub">
          <Prioridade p={t.prioridade} />
          {mostrarResp && <span>{t.colaborador_nome || 'Eu'}</span>}
          <span className={mostrarResp ? 'dot' : ''}>{t.categoria}</span>
          {t.job_numero && <span className="dot mono">JOB {t.job_numero}</span>}
          {t.checklist_total > 0 && <span className="dot row" style={{ gap: 3 }}><ListChecks size={13} />{t.checklist_feitos}/{t.checklist_total}</span>}
          {t.anexos_total > 0 && <span className="dot row" style={{ gap: 3 }}><Paperclip size={12} />{t.anexos_total}</span>}
          {t.reagendamentos >= 2 && <span className="dot row" style={{ gap: 3, color: 'var(--orange)' }} title="Pendência recorrente"><Repeat size={12} />{t.reagendamentos}×</span>}
        </div>
      </div>
      <div className="item-side">
        {t.hora && <span className="time">{t.hora}</span>}
        {mostrarStatus && !t.atrasado && t.status !== 'A fazer' && <Status s={t.status} />}
        <Prazo data={t.prazo} fechado={feito} />
      </div>
    </div>
  );
}

/** Linha de cobrança com ação "cobrei" em um clique. */
export function CobrancaItem({ c, compacto = false }) {
  const { detalhe } = useStore();
  const acao = useAcao();
  const [menu, setMenu] = useState(false);
  const cobrei = (dias) => {
    setMenu(false);
    acao(() => api.post(`/cobrancas/${c.id}/contato`, { status: 'Cobrado', proximo_followup: addDias(hoje(), dias) }), `Cobrado — próximo follow-up ${f.relativo(addDias(hoje(), dias))}`);
  };
  const resolvido = c.status === 'Resolvido';
  return (
    <div className="item clickable" onClick={() => detalhe('cobranca', c.id)}>
      <BellRing size={17} style={{ color: c.vencida ? 'var(--red)' : c.cobrar_hoje ? 'var(--orange)' : 'var(--muted)', flex: 'none' }} />
      <div className="item-main">
        <div className={`item-title ${resolvido ? 'done' : ''}`}>{c.descricao}</div>
        <div className="item-sub">
          <span className="strong" style={{ color: 'var(--ink-2)' }}>{c.pessoa_nome}</span>
          {compacto && <span className="dot">{c.status}</span>}
          <span className="dot">{c.ultimo_contato ? `último contato ${f.relativo(c.ultimo_contato)}` : 'nunca cobrado'}</span>
          {!compacto && c.job_numero && <span className="dot mono">JOB {c.job_numero}</span>}
        </div>
      </div>
      <div className="item-side" onClick={(e) => e.stopPropagation()}>
        {!compacto && <Status s={c.status} />}
        {!resolvido && c.proximo_followup && <Prazo data={c.proximo_followup} />}
        {!resolvido && (
          <div className="menu-wrap">
            <button className="btn sm" onClick={() => setMenu((m) => !m)} title="Registrar que cobrou"><Check size={14} /> Cobrei</button>
            {menu && (
              <div className="menu" style={{ minWidth: 190 }} onMouseLeave={() => setMenu(false)}>
                <div className="tiny muted" style={{ padding: '4px 10px' }}>Cobrar de novo…</div>
                <button onClick={() => cobrei(1)}>amanhã</button>
                <button onClick={() => cobrei(2)}>em 2 dias</button>
                <button onClick={() => cobrei(7)}>em 1 semana</button>
                <button onClick={() => { setMenu(false); acao(() => api.post(`/cobrancas/${c.id}/contato`, { status: 'Resolvido', texto: 'Resolvido' }), 'Resolvido ✓'); }}>✅ Já resolveu</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Linha de JOB. */
export function JobItem({ j, compacto = false }) {
  const nav = useNavigate();
  return (
    <div className="item clickable" onClick={() => nav(`/jobs/${j.id}`)}>
      <span className="badge dark mono" style={{ minWidth: 44, justifyContent: 'center' }}>{j.numero}</span>
      <div className="item-main">
        <div className="item-title">{j.titulo}</div>
        <div className="item-sub">
          <Prioridade p={j.prioridade} />
          <span>{j.cliente || 'sem cliente'}</span>
          <span className="dot">{j.colaborador_nome || 'sem responsável'}</span>
          {compacto && <span className="dot">{j.status}</span>}
          {!compacto && j.proxima_acao && <span className="dot ellipsis" style={{ maxWidth: 260 }}>→ {j.proxima_acao}</span>}
        </div>
      </div>
      <div className="item-side">
        {!compacto && <Status s={j.status} />}
        <Prazo data={j.prazo} fechado={['Concluído', 'Cancelado'].includes(j.status)} />
      </div>
    </div>
  );
}

export function AgrupadoPorPessoa({ itens, render }) {
  const grupos = itens.reduce((acc, i) => {
    const k = i.colaborador_nome || 'Eu';
    (acc[k] ||= []).push(i);
    return acc;
  }, {});
  return Object.entries(grupos).map(([nome, lista]) => (
    <div key={nome}>
      <div className="row" style={{ padding: '8px 10px 2px' }}><span className="label">{nome}</span><Badge>{lista.length}</Badge></div>
      {lista.map(render)}
    </div>
  ));
}
