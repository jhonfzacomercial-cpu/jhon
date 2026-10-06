import { useEffect, useRef, useState } from 'react';
import { X, CheckCircle2, Inbox } from 'lucide-react';
import { PRIORIDADE_ICONE } from '../../shared/constantes.js';
import * as f from '../lib/formato.js';

// ---------- badges ----------

const TOM_STATUS = {
  // tarefas
  'A fazer': '', 'Em andamento': 'blue', Aguardando: 'purple', Concluído: 'green', Atrasado: 'red',
  // jobs
  Novo: '', 'Em produção': 'amber', 'Em aprovação': 'blue', 'Aguardando cliente': 'purple', 'Aguardando equipe': 'purple', Cancelado: 'outline',
  // cobranças
  Pendente: 'orange', Cobrado: 'amber', Resolvido: 'green', 'Sem retorno': 'red',
  // one a one / cpc / colaborador
  Agendado: 'amber', Finalizado: 'green', 'Em acompanhamento': 'amber', Encerrado: 'outline',
  Ativo: 'green', Férias: 'blue', Afastado: 'orange', Desligado: 'outline',
  Cumpriu: 'green', 'Parcialmente cumpriu': 'yellow', 'Não cumpriu': 'red',
  Continuar: 'green', Parar: 'red', Começar: 'amber',
};

export function Badge({ tom = '', children, title, className = '' }) {
  return <span className={`badge ${tom} ${className}`} title={title}>{children}</span>;
}
export function Status({ s }) {
  return <Badge tom={TOM_STATUS[s] ?? ''} className={s === 'Cancelado' ? 'strike' : ''}>{s}</Badge>;
}
export function Prioridade({ p, texto = false }) {
  if (!p) return null;
  return texto
    ? <span className="row nowrap small" style={{ gap: 6 }}><span className={`prio ${p}`} />{p}</span>
    : <span className={`prio ${p}`} title={`Prioridade ${p}`} />;
}
export const prioridadeOpcao = (p) => `${PRIORIDADE_ICONE[p]} ${p}`;

export function Prazo({ data, fechado }) {
  const p = f.prazo(data, fechado);
  return <Badge tom={p.tom}>{p.texto}</Badge>;
}

export function Semaforo({ cor, rotulo = false }) {
  if (!cor) return <span className="muted small">—</span>;
  const map = { verde: ['🟢', 'Evoluindo'], amarelo: ['🟡', 'Atenção'], vermelho: ['🔴', 'Crítico'] };
  return <span className="sema" title={map[cor][1]}>{map[cor][0]}{rotulo && <span className="small" style={{ marginLeft: 6 }}>{map[cor][1]}</span>}</span>;
}

export function Avatar({ nome, size = '' }) {
  return <span className={`avatar ${size}`}>{f.iniciais(nome)}</span>;
}

// ---------- estrutura ----------

export function Card({ titulo, icone: Icone, extra, children, pad = false, className = '', foot, contagem, tomContagem }) {
  return (
    <section className={`card ${className}`}>
      {titulo && (
        <header className="card-head">
          <h2>{Icone && <Icone />}{titulo}{contagem !== undefined && <span className={`count-pill ${contagem > 0 ? tomContagem || '' : ''}`}>{contagem}</span>}</h2>
          {extra}
        </header>
      )}
      <div className={pad ? 'card-pad' : 'card-body'}>{children}</div>
      {foot && <footer className="card-foot">{foot}</footer>}
    </section>
  );
}

export function PageHead({ eyebrow, titulo, sub, children }) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{titulo}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="row wrap">{children}</div>}
    </div>
  );
}

export function Vazio({ children = 'Nada por aqui.', ok = false, big = false }) {
  return (
    <div className={`empty ${big ? 'big' : ''}`}>
      {ok ? <CheckCircle2 /> : big ? <Inbox /> : null}
      <span>{children}</span>
    </div>
  );
}

export function Tabs({ abas, atual, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {abas.map((a) => (
        <button key={a.id} role="tab" aria-selected={atual === a.id} className={atual === a.id ? 'on' : ''} onClick={() => onChange(a.id)}>
          {a.rotulo}{a.contagem ? <span className={`count-pill ${a.tom || ''}`}>{a.contagem}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Seg({ opcoes, valor, onChange }) {
  return (
    <div className="seg">
      {opcoes.map((o) => {
        const [v, rot, Ic] = Array.isArray(o) ? o : [o, o];
        return <button key={v} type="button" className={valor === v ? 'on' : ''} onClick={() => onChange(v)}>{Ic && <Ic />}{rot}</button>;
      })}
    </div>
  );
}

export function Chips({ opcoes, valor, onChange }) {
  return (
    <div className="chips">
      {opcoes.map(([v, rot, n]) => (
        <button key={v} type="button" className={`chip ${valor === v ? 'on' : ''}`} onClick={() => onChange(v)}>
          {rot}{n !== undefined && <span className="count">{n}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------- modal / drawer ----------

export function Modal({ titulo, onClose, children, rodape, wide = false, drawer = false, icone }) {
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    const o = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', esc); document.body.style.overflow = o; };
  }, [onClose]);
  return (
    <div className={`overlay ${drawer ? 'drawer-overlay' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={drawer ? 'drawer' : `modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={typeof titulo === 'string' ? titulo : undefined}>
        <div className="modal-head">
          {icone}
          <h2>{titulo}</h2>
          <button className="btn ghost icon" onClick={onClose} aria-label="Fechar"><X /></button>
        </div>
        <div className="modal-body">{children}</div>
        {rodape && <div className="modal-foot">{rodape}</div>}
      </div>
    </div>
  );
}

// ---------- campos ----------

export function Campo({ rotulo, children, full = false, dica }) {
  return (
    <label className={`field ${full ? 'full' : ''}`}>
      <span>{rotulo}</span>
      {children}
      {dica && <small className="muted tiny">{dica}</small>}
    </label>
  );
}

export function Select({ valor, onChange, opcoes, vazio, ...rest }) {
  return (
    <select className="select" value={valor ?? ''} onChange={(e) => onChange(e.target.value)} {...rest}>
      {vazio !== undefined && <option value="">{vazio}</option>}
      {opcoes.map((o) => {
        const [v, r] = Array.isArray(o) ? o : [o, o];
        return <option key={v} value={v}>{r}</option>;
      })}
    </select>
  );
}

/** Textarea que cresce com o conteúdo. */
export function AutoTextarea({ value, onChange, minRows = 2, ...rest }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight + 2, minRows * 22 + 18)}px`;
  }, [value, minRows]);
  return <textarea ref={ref} className="textarea" value={value ?? ''} onChange={(e) => onChange(e.target.value)} rows={minRows} {...rest} />;
}

/** Botão com confirmação em dois cliques (evita window.confirm). */
export function Confirmar({ onConfirm, children, className = 'btn danger sm', texto = 'Confirmar?' }) {
  const [armado, setArmado] = useState(false);
  useEffect(() => {
    if (!armado) return undefined;
    const t = setTimeout(() => setArmado(false), 3000);
    return () => clearTimeout(t);
  }, [armado]);
  return (
    <button type="button" className={className} onClick={() => (armado ? (setArmado(false), onConfirm()) : setArmado(true))}>
      {armado ? texto : children}
    </button>
  );
}

/** Menu suspenso simples. */
export function Menu({ botao, children }) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!aberto) return undefined;
    const fora = (e) => ref.current && !ref.current.contains(e.target) && setAberto(false);
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);
  return (
    <div className="menu-wrap" ref={ref}>
      {botao(() => setAberto((a) => !a))}
      {aberto && <div className="menu" onClick={() => setAberto(false)}>{children}</div>}
    </div>
  );
}

// ---------- timeline ----------

export function Timeline({ itens }) {
  if (!itens.length) return <Vazio>Sem registros ainda.</Vazio>;
  return (
    <div className="timeline">
      {itens.map((i, n) => (
        <div key={i.key ?? n} className={`tl-item ${i.tom || ''}`}>
          <div className="tl-date">{i.data}</div>
          {i.titulo && <div className="tl-title">{i.titulo}</div>}
          {i.corpo && <div className="tl-body">{i.corpo}</div>}
        </div>
      ))}
    </div>
  );
}
