import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle, CalendarDays, Clock, Hourglass, BellRing, ListTodo, Briefcase, Users, Target, CalendarCheck,
  CheckCircle2, Plus, MessagesSquare, Sparkles,
} from 'lucide-react';
import { useStore, useDados, useAcao } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import * as f from '../lib/formato.js';
import { Card, Vazio, Modal, Badge } from '../components/ui.jsx';
import { TarefaItem, CobrancaItem, JobItem, AgrupadoPorPessoa } from '../components/itens.jsx';
import { hoje, RESULTADO_ICONE } from '../../shared/constantes.js';

export const KPI_DEF = [
  { id: 'atrasados', rotulo: 'Atrasados', icone: AlertTriangle, tom: 'red', sub: 'tarefas e JOBs vencidos' },
  { id: 'hoje', rotulo: 'Hoje', icone: CalendarDays, tom: 'orange', sub: 'vencem hoje' },
  { id: 'proximos', rotulo: 'Próximos', icone: Clock, tom: 'amber', sub: 'próximos 7 dias' },
  { id: 'aguardando', rotulo: 'Aguardando', icone: Hourglass, tom: 'purple', sub: 'dependem de outra pessoa' },
  { id: 'cobrar', rotulo: 'Cobrar', icone: BellRing, tom: 'blue', sub: 'follow-ups pendentes' },
];

/** Item misto (tarefa/job/cobrança) para as listas dos indicadores. */
export function ItemMisto({ i }) {
  if (i.tipo === 'job' || i.numero) return <JobItem j={i} />;
  if (i.tipo === 'cobranca' || i.descricao !== undefined && i.pessoa_nome) return <CobrancaItem c={i} />;
  return <TarefaItem t={i} mostrarStatus />;
}

export function itensDoKpi(r, id) {
  switch (id) {
    case 'atrasados': return [...r.jobsAtrasados, ...r.tarefasAtrasadas];
    case 'hoje': return [...r.jobsHoje, ...r.tarefasHoje];
    case 'proximos': return r.proximos;
    case 'aguardando': return r.aguardando;
    case 'cobrar': return r.cobrar;
    default: return [];
  }
}

export function Kpis({ r }) {
  const [aberto, setAberto] = useState(null);
  const def = KPI_DEF.find((k) => k.id === aberto);
  return (
    <>
      <div className="kpis">
        {KPI_DEF.map(({ id, rotulo, icone: Ic, tom, sub }) => (
          <button key={id} className={`kpi ${tom} ${r.kpis[id] ? '' : 'zero'}`} onClick={() => setAberto(id)}>
            <span className="kpi-label"><Ic />{rotulo}</span>
            <span className="kpi-value">{r.kpis[id]}</span>
            <span className="kpi-sub">{sub}</span>
          </button>
        ))}
      </div>
      {def && (
        <Modal titulo={`${def.rotulo} — ${def.sub}`} wide onClose={() => setAberto(null)}>
          <div className="list">
            {itensDoKpi(r, def.id).map((i) => <ItemMisto key={`${i.tipo || ''}${i.numero ? 'j' : ''}${i.id}`} i={i} />)}
            {!itensDoKpi(r, def.id).length && <Vazio ok>Nada aqui. 👏</Vazio>}
          </div>
        </Modal>
      )}
    </>
  );
}

function saudacao() {
  const h = new Date().getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

function BoasVindas() {
  const { abrir } = useStore();
  const acao = useAcao();
  return (
    <div className="card card-pad welcome">
      <span className="brand-mark" />
      <h2 style={{ fontSize: 22 }}>Bem-vindo ao seu painel de comando</h2>
      <p className="muted">Comece cadastrando sua equipe. Se preferir conhecer o sistema primeiro, carregue os dados de exemplo — dá para apagar tudo depois em Configurações.</p>
      <div className="row wrap" style={{ justifyContent: 'center', marginTop: 10 }}>
        <button className="btn primary" onClick={() => abrir('colaborador')}><Plus /> Cadastrar colaborador</button>
        <button className="btn" onClick={() => acao(() => api.post('/demo'), 'Dados de exemplo carregados')}><Sparkles /> Carregar exemplo</button>
      </div>
    </div>
  );
}

function AddRapido({ placeholder, onAdd }) {
  const [v, setV] = useState('');
  return (
    <form className="quick-add" style={{ margin: '6px 4px 4px' }} onSubmit={async (e) => { e.preventDefault(); if (v.trim() && await onAdd(v.trim())) setV(''); }}>
      <Plus size={16} className="muted" />
      <input className="input" value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} />
      {v && <button className="btn sm primary">Adicionar</button>}
    </form>
  );
}

export function MeuDia() {
  const { dados: r } = useDados('/resumo');
  const { abrir } = useStore();
  const acao = useAcao();
  const nav = useNavigate();
  if (!r) return null;

  const dailysFeitas = r.dailys.filter((d) => d.daily).length;
  const resumoTexto = [
    r.kpis.atrasados && f.plural(r.kpis.atrasados, 'item atrasado', 'itens atrasados'),
    r.kpis.cobrar && f.plural(r.kpis.cobrar, 'cobrança para hoje', 'cobranças para hoje'),
    r.dailys.length && `${dailysFeitas}/${r.dailys.length} Dailys feitas`,
    r.reunioes.length && f.plural(r.reunioes.length, 'reunião', 'reuniões'),
  ].filter(Boolean).join(' · ');

  return (
    <>
      <section className="hero">
        <div>
          <div className="hero-date">{f.dataLonga(r.hoje)}</div>
          <h1>{saudacao()}, <em>Jhonatas</em>.</h1>
          <p>{resumoTexto || 'Tudo em dia por aqui. Bom trabalho!'}</p>
        </div>
        <div className="hero-actions">
          <button className="btn primary" onClick={() => nav('/daily')}><CalendarCheck /> Fazer Daily</button>
          <button className="btn" onClick={() => abrir('cobranca')}><BellRing /> Cobrança</button>
          <button className="btn" onClick={() => abrir('tarefa')}><ListTodo /> Tarefa</button>
        </div>
      </section>

      {r.equipe.length === 0 && <BoasVindas />}

      <Kpis r={r} />

      {r.dailys.length > 0 && (
        <Card titulo="Dailys de hoje" icone={CalendarCheck} contagem={`${dailysFeitas}/${r.dailys.length}`} pad
          extra={<Link to="/daily" className="btn sm ghost">Abrir Daily</Link>}>
          <div className="daily-strip">
            {r.dailys.map((d) => (
              <button key={d.id} className={`daily-pill ${d.daily ? 'feita' : ''}`} onClick={() => nav(`/daily?colaborador=${d.id}`)}>
                {d.daily ? <CheckCircle2 size={20} color="var(--green)" /> : <span className="avatar sm">{f.iniciais(d.nome)}</span>}
                <span className="grow">
                  <span className="strong ellipsis" style={{ display: 'block' }}>{d.nome}</span>
                  <span className="time small muted">{d.horario || 'sem horário'}</span>
                </span>
                {d.daily?.bloqueios && <Badge tom="red" title={d.daily.bloqueios}>bloqueio</Badge>}
              </button>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-main" style={{ marginTop: 16 }}>
        <div className="stack loose">
          <Card titulo="Preciso fazer" icone={ListTodo} contagem={r.minhasHoje.length} tomContagem={r.minhasHoje.some((t) => t.atrasado) ? 'red' : 'amber'}
            extra={<Link to="/agenda" className="btn sm ghost">Agenda</Link>}>
            <div className="list">
              {r.minhasHoje.map((t) => <TarefaItem key={t.id} t={t} mostrarResp={false} />)}
              {!r.minhasHoje.length && <Vazio ok>Nenhuma tarefa sua para hoje.</Vazio>}
            </div>
            <AddRapido placeholder="Adicionar tarefa para hoje e apertar Enter" onAdd={(titulo) => acao(() => api.post('/tarefas', { titulo, prazo: hoje() }), 'Tarefa adicionada')} />
          </Card>

          <Card titulo="Preciso cobrar" icone={BellRing} contagem={r.cobrar.length} tomContagem="red"
            extra={<button className="btn sm" onClick={() => abrir('cobranca')}><Plus /> Cobrança</button>}>
            <div className="list">
              {r.cobrar.map((c) => <CobrancaItem key={c.id} c={c} />)}
              {!r.cobrar.length && <Vazio ok>Nenhuma cobrança para hoje.</Vazio>}
            </div>
          </Card>

          <Card titulo="Acompanhar equipe" icone={Users} contagem={r.pendenciasEquipe.length} tomContagem="amber"
            extra={<Link to="/equipe" className="btn sm ghost">Equipe</Link>}>
            <div className="list">
              {r.pendenciasEquipe.length
                ? <AgrupadoPorPessoa itens={r.pendenciasEquipe} render={(t) => <TarefaItem key={t.id} t={t} mostrarResp={false} />} />
                : <Vazio ok>Equipe sem pendências vencidas.</Vazio>}
            </div>
          </Card>
        </div>

        <div className="stack loose">
          <Card titulo="Reuniões" icone={Clock} contagem={r.reunioes.length}>
            <div className="list">
              {r.reunioes.map((m) => (m.tipo === 'tarefa'
                ? <TarefaItem key={`t${m.id}`} t={m.item} mostrarResp={false} />
                : (
                  <div key={`o${m.id}`} className="item clickable" onClick={() => nav(`/one-a-one/${m.id}`)}>
                    <MessagesSquare size={18} color="var(--purple)" />
                    <div className="item-main"><div className="item-title">{m.titulo}</div><div className="item-sub">CPC + feedback</div></div>
                    {m.hora && <span className="time">{m.hora}</span>}
                  </div>
                )))}
              {!r.reunioes.length && <Vazio>Sem reuniões marcadas hoje.</Vazio>}
            </div>
          </Card>

          <Card titulo="JOBs atrasados" icone={Briefcase} contagem={r.jobsAtrasados.length} tomContagem="red"
            extra={<Link to="/jobs?filtro=atrasados" className="btn sm ghost">JOBs</Link>}>
            <div className="list">
              {r.jobsAtrasados.map((j) => <JobItem key={j.id} j={j} compacto />)}
              {!r.jobsAtrasados.length && <Vazio ok>Nenhum JOB atrasado.</Vazio>}
            </div>
          </Card>

          <Card titulo="CPC / Desenvolvimento" icone={Target} contagem={r.cpcPendentes.length + r.oooProximos.length} tomContagem="amber">
            <div className="list">
              {r.oooProximos.map((o) => (
                <div key={`o${o.id}`} className="item clickable" onClick={() => nav(`/one-a-one/${o.id}`)}>
                  <MessagesSquare size={17} color="var(--purple)" />
                  <div className="item-main">
                    <div className="item-title">One a One — {o.colaborador_nome}</div>
                    <div className="item-sub">{f.mes(o.mes)}</div>
                  </div>
                  <Badge tom={o.data < r.hoje ? 'red' : o.data === r.hoje ? 'orange' : 'amber'}>{o.data < r.hoje ? `pendente desde ${f.data(o.data)}` : f.relativo(o.data)}</Badge>
                </div>
              ))}
              {r.cpcPendentes.map((p) => (
                <div key={`p${p.id}`} className="item clickable wrap" onClick={() => nav(`/equipe/${p.colaborador_id}?aba=evolucao`)}>
                  <Target size={17} color="var(--amber-deep)" />
                  <div className="item-main">
                    <div className="item-title">{p.descricao}</div>
                    <div className="item-sub">
                      <span className="strong" style={{ color: 'var(--ink-2)' }}>{p.colaborador_nome}</span>
                      <span className="dot">{p.tipo}</span>
                      {p.ultima_avaliacao && <span className="dot">último: {RESULTADO_ICONE[p.ultima_avaliacao.resultado]} {p.ultima_avaliacao.resultado}</span>}
                    </div>
                  </div>
                  <Badge tom="orange">avaliar</Badge>
                </div>
              ))}
              {!r.cpcPendentes.length && !r.oooProximos.length && <Vazio ok>Nada de desenvolvimento pendente.</Vazio>}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
