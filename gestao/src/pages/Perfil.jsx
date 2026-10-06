import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { ArrowLeft, Pencil, CalendarCheck, Plus, BellRing, MessagesSquare, Repeat, AlertOctagon, Trash2 } from 'lucide-react';
import { useStore, useDados, useAcao } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import * as f from '../lib/formato.js';
import { Card, Vazio, Tabs, Avatar, Status, Semaforo, Badge, Timeline, Confirmar } from '../components/ui.jsx';
import { TarefaItem, CobrancaItem, JobItem } from '../components/itens.jsx';
import { ListaCpc, LinhaEvolucao } from '../components/Evolucao.jsx';
import { hoje, mesAtual } from '../../shared/constantes.js';

function TimelineDailys({ dailys }) {
  if (!dailys.length) return <Vazio>Nenhuma Daily registrada.</Vazio>;
  return (
    <div className="timeline">
      {dailys.map((d) => (
        <div key={d.id} className={`tl-item ${d.bloqueios ? 'red' : d.tarefas_atrasadas ? 'amber' : 'green'}`}>
          <div className="row between wrap">
            <span className="tl-date">{f.data(d.data)} · {f.diaSemana(d.data)}{d.eh_hoje ? ' · hoje' : ''}</span>
            <Link className="btn ghost sm" to={`/daily?colaborador=${d.colaborador_id}&data=${d.data}`}>Abrir</Link>
          </div>
          <div className="tl-title">Daily realizada</div>
          <div className="row wrap small" style={{ gap: 6, margin: '4px 0' }}>
            <Badge>{f.plural(d.tarefas_total, 'tarefa definida', 'tarefas definidas')}</Badge>
            {d.tarefas_concluidas > 0 && <Badge tom="green">{d.tarefas_concluidas} concluída(s)</Badge>}
            {d.tarefas_atrasadas > 0 && <Badge tom="red">{d.tarefas_atrasadas} atrasada(s)</Badge>}
            {d.bloqueios && <Badge tom="red">1 bloqueio</Badge>}
          </div>
          <div className="tl-body stack tight">
            {d.tarefas.length > 0 && (
              <div>{d.tarefas.map((t) => <div key={t.id} className={t.status === 'Concluído' ? 'item-title done' : ''} style={{ fontWeight: 400 }}>{t.status === 'Concluído' ? '☑' : t.atrasado ? '⚠' : '☐'} {t.titulo}</div>)}</div>
            )}
            {d.bloqueios && <div><b style={{ color: 'var(--red)' }}>Bloqueio:</b> {d.bloqueios}</div>}
            {d.combinados && <div><b>Combinado:</b> {d.combinados}</div>}
            {d.observacoes && <div className="muted"><b>Obs.:</b> {d.observacoes}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Perfil() {
  const { id } = useParams();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const aba = params.get('aba') || 'geral';
  const { abrir } = useStore();
  const acao = useAcao();
  const { dados: p } = useDados(`/colaboradores/${id}/perfil`);
  if (!p) return null;
  const c = p.colaborador;

  const abertas = p.tarefas.filter((t) => t.status !== 'Concluído');
  const atrasadas = abertas.filter((t) => t.atrasado).length + p.jobs.filter((j) => j.atrasado).length;
  const cobAbertas = p.cobrancas.filter((x) => x.status !== 'Resolvido');
  const cpcAtivos = p.cpc.filter((x) => x.status === 'Em acompanhamento');
  const cpcPend = cpcAtivos.filter((x) => x.pendente_avaliacao).length;
  const proximoOoo = p.oneAOnes.filter((o) => o.status === 'Agendado').sort((a, b) => a.data.localeCompare(b.data))[0];
  const dailyHoje = p.dailys.find((d) => d.eh_hoje);
  const feedbackPorMes = p.feedbacks.reduce((acc, fb) => { (acc[fb.mes] ||= []).push(fb); return acc; }, {});

  const abas = [
    { id: 'geral', rotulo: 'Visão geral' },
    { id: 'daily', rotulo: 'Daily', contagem: p.dailys.length },
    { id: 'tarefas', rotulo: 'Tarefas', contagem: abertas.length, tom: atrasadas ? 'red' : '' },
    { id: 'cobrancas', rotulo: 'Cobranças', contagem: cobAbertas.length },
    { id: 'jobs', rotulo: 'JOBs', contagem: p.jobs.filter((j) => !['Concluído', 'Cancelado'].includes(j.status)).length },
    { id: 'one', rotulo: 'One a One', contagem: p.oneAOnes.length },
    { id: 'evolucao', rotulo: 'CPC / Evolução', contagem: cpcPend, tom: 'amber' },
    { id: 'feedback', rotulo: 'Feedback do colaborador' },
    { id: 'historico', rotulo: 'Histórico' },
  ];

  return (
    <>
      <button className="btn ghost sm" onClick={() => nav('/equipe')} style={{ marginBottom: 10 }}><ArrowLeft /> Equipe</button>
      <div className="page-head">
        <div className="profile-head">
          <Avatar nome={c.nome} size="lg" />
          <div>
            <div className="eyebrow">Perfil gerencial</div>
            <h1>{c.nome}</h1>
            <div className="row wrap" style={{ marginTop: 4 }}>
              <span className="muted">{[c.cargo, c.area].filter(Boolean).join(' · ')}</span>
              <Status s={c.status} />
              {c.data_entrada && <span className="small muted">desde {f.data(c.data_entrada, { ano: true })}</span>}
            </div>
          </div>
        </div>
        <div className="row wrap">
          <button className="btn primary" onClick={() => nav(`/daily?colaborador=${c.id}`)}><CalendarCheck /> {dailyHoje ? 'Daily de hoje' : 'Fazer Daily'}</button>
          <button className="btn" onClick={() => abrir('cobranca', { pessoa: c.nome })}><BellRing /> Cobrar</button>
          <button className="btn" onClick={() => abrir('tarefa', { colaborador_id: c.id, categoria: 'Equipe' })}><Plus /> Tarefa</button>
          <button className="btn icon" onClick={() => abrir('colaborador', c)} aria-label="Editar"><Pencil /></button>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat"><span>Pendências</span><b>{abertas.length}</b></div>
        <div className={`stat ${atrasadas ? 'red' : ''}`}><span>Atrasados</span><b>{atrasadas}</b></div>
        <div className={`stat ${p.recorrentes.length ? 'red' : ''}`}><span>Recorrentes</span><b>{p.recorrentes.length}</b></div>
        <div className="stat"><span>Cobranças</span><b>{cobAbertas.length}</b></div>
        <div className="stat"><span>CPC</span><b><Semaforo cor={p.semaforo_cpc} /> <small className="small muted">{cpcAtivos.length} ativo(s)</small></b></div>
        <div className="stat"><span>Próx. One a One</span><b style={{ fontSize: 16, marginTop: 6 }}>{proximoOoo ? <Link to={`/one-a-one/${proximoOoo.id}`}>{f.data(proximoOoo.data)}</Link> : '—'}</b></div>
      </div>

      <Tabs abas={abas} atual={aba} onChange={(v) => setParams({ aba: v }, { replace: true })} />

      {aba === 'geral' && (
        <div className="grid grid-main">
          <div className="stack loose">
            <Card titulo="Daily de hoje" icone={CalendarCheck} pad>
              {dailyHoje ? <TimelineDailys dailys={[dailyHoje]} /> : (
                <div className="row between wrap"><span className="muted">Daily de hoje ainda não registrada.</span><button className="btn sm primary" onClick={() => nav(`/daily?colaborador=${c.id}`)}>Fazer agora</button></div>
              )}
            </Card>
            <Card titulo="Pendências" contagem={abertas.length} tomContagem={atrasadas ? 'red' : ''}>
              <div className="list">{abertas.slice(0, 8).map((t) => <TarefaItem key={t.id} t={t} mostrarResp={false} mostrarStatus />)}{!abertas.length && <Vazio ok>Sem pendências.</Vazio>}</div>
            </Card>
            <Card titulo="CPC em acompanhamento" contagem={cpcAtivos.length} extra={<button className="btn sm ghost" onClick={() => setParams({ aba: 'evolucao' })}>Evolução</button>}>
              <ListaCpc cpc={cpcAtivos} />
            </Card>
          </div>
          <div className="stack loose">
            {c.observacoes && <Card titulo="Observações gerais" pad><p className="pre" style={{ margin: 0 }}>{c.observacoes}</p></Card>}
            <Card titulo="Pendências recorrentes" icone={Repeat} contagem={p.recorrentes.length} tomContagem="red">
              <div className="list">
                {p.recorrentes.map((t) => <TarefaItem key={t.id} t={t} mostrarResp={false} />)}
                {!p.recorrentes.length && <Vazio ok>Nenhuma tarefa sendo empurrada de Daily em Daily.</Vazio>}
              </div>
            </Card>
            <Card titulo="Bloqueios recentes" icone={AlertOctagon} contagem={p.bloqueios.length} pad>
              <Timeline itens={p.bloqueios.slice(0, 6).map((b) => ({ key: b.daily_id, data: `${f.data(b.data)} · ${f.relativo(b.data)}`, corpo: b.texto, tom: 'red' }))} />
            </Card>
            <Card titulo="Cobranças abertas" icone={BellRing} contagem={cobAbertas.length}>
              <div className="list">{cobAbertas.map((x) => <CobrancaItem key={x.id} c={x} compacto />)}{!cobAbertas.length && <Vazio ok>Nada a cobrar.</Vazio>}</div>
            </Card>
          </div>
        </div>
      )}

      {aba === 'daily' && <Card pad><TimelineDailys dailys={p.dailys} /></Card>}

      {aba === 'tarefas' && (
        <Card titulo="Tarefas" extra={<button className="btn sm primary" onClick={() => abrir('tarefa', { colaborador_id: c.id, categoria: 'Equipe' })}><Plus /> Tarefa</button>}>
          <div className="list">{p.tarefas.map((t) => <TarefaItem key={t.id} t={t} mostrarResp={false} mostrarStatus />)}{!p.tarefas.length && <Vazio>Nenhuma tarefa.</Vazio>}</div>
        </Card>
      )}

      {aba === 'cobrancas' && (
        <Card titulo="Cobranças" extra={<button className="btn sm primary" onClick={() => abrir('cobranca', { pessoa: c.nome })}><Plus /> Cobrança</button>}>
          <div className="list">{p.cobrancas.map((x) => <CobrancaItem key={x.id} c={x} />)}{!p.cobrancas.length && <Vazio>Nenhuma cobrança.</Vazio>}</div>
        </Card>
      )}

      {aba === 'jobs' && <Card titulo="JOBs"><div className="list">{p.jobs.map((j) => <JobItem key={j.id} j={j} />)}{!p.jobs.length && <Vazio>Nenhum JOB.</Vazio>}</div></Card>}

      {aba === 'one' && (
        <Card titulo="One a Ones" icone={MessagesSquare}
          extra={<button className="btn sm primary" onClick={async () => {
            const o = await acao(() => api.post('/one-a-ones', { colaborador_id: c.id, data: hoje() }));
            if (o) nav(`/one-a-one/${o.id}`);
          }}><Plus /> One a One {f.mes(mesAtual())}</button>}>
          <div className="list">
            {p.oneAOnes.map((o) => (
              <div key={o.id} className="item clickable" onClick={() => nav(`/one-a-one/${o.id}`)}>
                <MessagesSquare size={17} color="var(--purple)" />
                <div className="item-main"><div className="item-title">One a One — {f.mes(o.mes)}</div><div className="item-sub">{f.data(o.data, { ano: true })}{o.pontos_positivos ? ` · ${o.pontos_positivos}` : ''}</div></div>
                <Status s={o.status} />
              </div>
            ))}
            {!p.oneAOnes.length && <Vazio>Nenhum One a One.</Vazio>}
          </div>
        </Card>
      )}

      {aba === 'evolucao' && (
        <div className="grid grid-2">
          <Card titulo="Linha de evolução" pad><LinhaEvolucao cpc={p.cpc} /></Card>
          <Card titulo="Todos os pontos CPC" contagem={p.cpc.length}><ListaCpc cpc={p.cpc} /></Card>
        </div>
      )}

      {aba === 'feedback' && (
        <div className="stack loose">
          {Object.entries(feedbackPorMes).map(([mes, lista]) => (
            <Card key={mes} titulo={`O que ${c.nome} disse — ${f.mes(mes)}`} pad>
              <div className="stack">
                {lista.map((fb) => (
                  <div key={fb.id}><div className="label">{fb.pergunta}</div><p className="pre" style={{ margin: '3px 0 0' }}>{fb.resposta}</p></div>
                ))}
              </div>
            </Card>
          ))}
          {!p.feedbacks.length && <Card><Vazio big>Os feedbacks registrados no One a One aparecem aqui.</Vazio></Card>}
        </div>
      )}

      {aba === 'historico' && (
        <Card pad>
          <Timeline itens={p.historico.map((h) => ({ key: h.id, data: f.dataHora(h.data_hora), corpo: h.descricao, tom: /atrasad|vencid/.test(h.tipo) ? 'red' : /conclu|realizad/.test(h.tipo) ? 'green' : /cpc/.test(h.tipo) ? 'purple' : '' }))} />
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
            <Confirmar texto="Apagar colaborador e todo o histórico?" onConfirm={async () => { nav('/equipe'); await acao(() => api.del(`/colaboradores/${c.id}`), 'Colaborador removido'); }}>
              <Trash2 size={15} /> Excluir colaborador
            </Confirmar>
          </div>
        </Card>
      )}
    </>
  );
}
