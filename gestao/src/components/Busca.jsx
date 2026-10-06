import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, User, Briefcase, ListTodo, BellRing, CalendarCheck, MessagesSquare, Target, MessageCircleHeart, History } from 'lucide-react';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.jsx';
import * as f from '../lib/formato.js';
import { Status, Badge } from './ui.jsx';
import { normalizar } from '../../shared/constantes.js';

const ICONES = { colaboradores: User, jobs: Briefcase, job_historico: History, tarefas: ListTodo, cobrancas: BellRing, dailys: CalendarCheck, one_a_ones: MessagesSquare, cpc: Target, feedbacks: MessageCircleHeart };

function Destaque({ texto = '', termo }) {
  const t = normalizar(termo.replace(/^job\s*/i, '')).trim();
  const n = normalizar(texto);
  const i = t ? n.indexOf(t) : -1;
  if (i < 0) return texto;
  return <>{texto.slice(0, i)}<mark>{texto.slice(i, i + t.length)}</mark>{texto.slice(i + t.length)}</>;
}

/** Converte um resultado em linha clicável. */
function descrever(tipo, i) {
  switch (tipo) {
    case 'colaboradores': return { titulo: i.nome, sub: [i.cargo, i.area].filter(Boolean).join(' · '), ir: `/equipe/${i.id}` };
    case 'jobs': return { titulo: `JOB ${i.numero} — ${i.titulo}`, sub: `${i.cliente || ''} · ${i.colaborador_nome || 'sem responsável'}`, ir: `/jobs/${i.id}`, side: <Status s={i.atrasado ? 'Atrasado' : i.status} /> };
    case 'job_historico': return { titulo: i.texto, sub: `JOB ${i.job?.numero} — ${i.job?.titulo} · ${f.data(i.data)}`, ir: `/jobs/${i.job_id}` };
    case 'tarefas': return { titulo: i.titulo, sub: `${i.colaborador_nome || 'Minha'} · ${i.categoria} · prazo ${f.data(i.prazo)}`, detalhe: ['tarefa', i.id], side: <Status s={i.status_efetivo} /> };
    case 'cobrancas': return { titulo: i.descricao, sub: `${i.pessoa_nome} · ${i.status}`, detalhe: ['cobranca', i.id], side: <Status s={i.status} /> };
    case 'dailys': return { titulo: `Daily ${f.data(i.data)} — ${i.colaborador_nome}`, sub: [i.bloqueios && `Bloqueio: ${i.bloqueios}`, i.combinados].filter(Boolean).join(' · ') || 'Daily realizada', ir: `/daily?colaborador=${i.colaborador_id}&data=${i.data}` };
    case 'one_a_ones': return { titulo: `One a One ${f.mes(i.mes)} — ${i.colaborador_nome}`, sub: i.pontos_positivos || i.pontos_atencao || f.data(i.data), ir: `/one-a-one/${i.id}`, side: <Status s={i.status} /> };
    case 'cpc': return { titulo: i.descricao, sub: `${i.colaborador_nome} · ${i.tipo} · ${i.origem_mes ? f.mes(i.origem_mes) : ''}`, ir: `/equipe/${i.colaborador_id}?aba=evolucao`, side: <Badge tom={{ Continuar: 'green', Parar: 'red', Começar: 'amber' }[i.tipo]}>{i.tipo}</Badge> };
    case 'feedbacks': return { titulo: i.resposta, sub: `${i.colaborador_nome} · ${i.pergunta} · ${f.mes(i.mes)}`, ir: `/equipe/${i.colaborador_id}?aba=feedback` };
    default: return { titulo: '?' };
  }
}

export function Busca({ onClose }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [sel, setSel] = useState(0);
  const nav = useNavigate();
  const { detalhe } = useStore();
  const input = useRef(null);

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return undefined; }
    const t = setTimeout(() => api.get(`/busca?q=${encodeURIComponent(q)}`).then(setRes).catch(() => {}), 160);
    return () => clearTimeout(t);
  }, [q]);

  const linhas = useMemo(() => (res?.grupos || []).flatMap((g) => g.itens.slice(0, 8).map((i) => ({ grupo: g, ...descrever(g.tipo, i), key: `${g.tipo}-${i.id}` }))), [res]);
  const abrir = (l) => {
    onClose();
    if (l.detalhe) detalhe(...l.detalhe);
    else nav(l.ir);
  };
  const teclas = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, linhas.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    if (e.key === 'Enter' && linhas[sel]) abrir(linhas[sel]);
    if (e.key === 'Escape') onClose();
  };

  let n = -1;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal palette" role="dialog" aria-label="Busca global">
        <div className="palette-input">
          <Search />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} onKeyDown={teclas} placeholder='Buscar "JOB 041", "Ana", cliente, bloqueio, feedback…' />
          <kbd>esc</kbd>
        </div>
        <div style={{ overflowY: 'auto', maxHeight: '62vh' }}>
          {!res && <div className="empty">Digite ao menos 2 letras. Busca em JOBs, histórico, tarefas, cobranças, Dailys, One a Ones, CPC e feedbacks.</div>}
          {res && !res.total && <div className="empty">Nada encontrado para “{q}”.</div>}
          {res?.grupos.map((g) => {
            const Ic = ICONES[g.tipo];
            return (
              <div key={g.tipo} className="palette-group">
                <h4><span>{g.titulo}</span><span>{g.itens.length}</span></h4>
                {g.itens.slice(0, 8).map((i) => {
                  n += 1;
                  const l = linhas[n];
                  const idx = n;
                  return (
                    <div key={l.key} className={`palette-item ${sel === idx ? 'sel' : ''}`} onMouseEnter={() => setSel(idx)} onClick={() => abrir(l)}>
                      <Ic />
                      <div className="grow">
                        <div className="ellipsis strong"><Destaque texto={l.titulo} termo={q} /></div>
                        {l.sub && <div className="ellipsis small muted"><Destaque texto={l.sub} termo={q} /></div>}
                      </div>
                      {l.side}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
