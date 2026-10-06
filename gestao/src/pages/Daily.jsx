import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { CheckCircle2, Plus, X, ChevronLeft, ChevronRight, AlertOctagon, NotebookPen, Handshake, History, BellRing, Briefcase, CornerDownRight, Repeat, Save } from 'lucide-react';
import { useStore, useDados, useAcao } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import * as f from '../lib/formato.js';
import { Card, Vazio, Avatar, Badge, Prazo, Status, AutoTextarea, Seg } from '../components/ui.jsx';
import { CobrancaItem, JobItem } from '../components/itens.jsx';
import { hoje, addDias } from '../../shared/constantes.js';

let tmp = 0;

export function Daily() {
  const [params, setParams] = useSearchParams();
  const data = params.get('data') || hoje();
  const { abrir, toast } = useStore();
  const acao = useAcao();
  const { dados: equipe } = useDados(`/equipe`, { inicial: [] });
  const { dados: feitas } = useDados(`/dailys?data=${data}`, { inicial: [] });
  const ativos = (equipe || []).filter((c) => c.status === 'Ativo');
  const colabId = Number(params.get('colaborador')) || ativos.find((c) => !(feitas || []).some((d) => d.colaborador_id === c.id))?.id || ativos[0]?.id;
  const { dados: form } = useDados(colabId ? `/dailys/form?colaborador_id=${colabId}&data=${data}` : null);

  const [itens, setItens] = useState([]);
  const [campos, setCampos] = useState({ bloqueios: '', observacoes: '', combinados: '' });
  const [pend, setPend] = useState({});
  const [novo, setNovo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const iniciado = useRef('');
  const chave = `${colabId}|${data}`;

  useEffect(() => {
    if (!form || `${form.colaborador.id}|${form.data}` !== chave || iniciado.current === chave) return;
    iniciado.current = chave;
    setItens(form.itens.map((t) => ({ id: t.id, key: `t${t.id}`, titulo: t.titulo, status: t.status, prazo: t.prazo })));
    setCampos({ bloqueios: form.daily?.bloqueios || '', observacoes: form.daily?.observacoes || '', combinados: form.daily?.combinados || '' });
    setPend({});
    setNovo('');
  }, [form, chave]);

  const ir = (mudancas) => {
    const p = new URLSearchParams(params);
    Object.entries(mudancas).forEach(([k, v]) => (v ? p.set(k, v) : p.delete(k)));
    setParams(p, { replace: true });
  };
  const addItem = (e) => {
    e?.preventDefault();
    if (!novo.trim()) return;
    setItens((l) => [...l, { key: `n${++tmp}`, titulo: novo.trim(), status: 'A fazer' }]);
    setNovo('');
  };

  // Fixa o colaborador escolhido na URL para ele não "pular" ao salvar
  useEffect(() => {
    if (!params.get('colaborador') && colabId) ir({ colaborador: String(colabId) });
  }, [colabId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pronto = form && iniciado.current === chave;
  const proximo = useMemo(() => {
    const idx = ativos.findIndex((c) => c.id === colabId);
    return [...ativos.slice(idx + 1), ...ativos.slice(0, idx)].find((c) => !(feitas || []).some((d) => d.colaborador_id === c.id) && c.id !== colabId);
  }, [ativos, colabId, feitas]);

  const salvar = async (avancar) => {
    const lista = novo.trim() ? [...itens, { titulo: novo.trim(), status: 'A fazer' }] : itens;
    setSalvando(true);
    const r = await acao(() => api.post('/dailys', {
      colaborador_id: colabId, data, ...campos,
      itens: lista.map(({ id, titulo, status, prazo }) => ({ id, titulo, status, prazo })),
      pendencias: Object.entries(pend).filter(([, a]) => a).map(([id, a]) => ({ id: Number(id), acao: a })),
    }), `Daily de ${form.colaborador.nome} salva`);
    setSalvando(false);
    if (!r) return;
    iniciado.current = '';
    if (avancar && proximo) ir({ colaborador: String(proximo.id) });
    else if (avancar) toast('Todas as Dailys do dia foram feitas 🎉');
  };

  if (!ativos.length) {
    return <Card><Vazio big>Cadastre colaboradores em <Link className="strong" to="/equipe">Equipe</Link> para registrar Dailys.</Vazio></Card>;
  }

  const c = form?.colaborador;
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 250px) minmax(0, 1fr)', alignItems: 'start' }} data-daily>
      <aside className="stack daily-side">
        <div className="card card-pad stack tight" style={{ padding: 12 }}>
          <span className="label">Data</span>
          <div className="row">
            <button className="btn icon sm" aria-label="Dia anterior" onClick={() => { iniciado.current = ''; ir({ data: addDias(data, -1) }); }}><ChevronLeft /></button>
            <input type="date" className="input" value={data} onChange={(e) => { iniciado.current = ''; ir({ data: e.target.value }); }} />
            <button className="btn icon sm" aria-label="Próximo dia" onClick={() => { iniciado.current = ''; ir({ data: addDias(data, 1) }); }}><ChevronRight /></button>
          </div>
          {data !== hoje() && <button className="btn sm ghost" onClick={() => ir({ data: '' })}>Voltar para hoje</button>}
        </div>
        <div className="card" style={{ padding: 6 }}>
          {ativos.map((p) => {
            const feita = (feitas || []).find((d) => d.colaborador_id === p.id);
            return (
              <div key={p.id} className="item clickable" style={{ background: p.id === colabId ? 'var(--amber-soft)' : undefined, borderRadius: 10, borderTop: 0 }} onClick={() => ir({ colaborador: String(p.id) })}>
                {feita ? <CheckCircle2 size={20} color="var(--green)" /> : <Avatar nome={p.nome} size="sm" />}
                <div className="item-main"><div className="item-title">{p.nome}</div><div className="item-sub">{p.daily_horario || '—'}{feita ? ` · ${feita.tarefas_total} tarefa(s)` : ''}</div></div>
                {p.atrasados > 0 && <Badge tom="red">{p.atrasados}</Badge>}
              </div>
            );
          })}
        </div>
        <div className="small muted" style={{ padding: '0 6px' }}>{(feitas || []).length}/{ativos.length} Dailys registradas {data === hoje() ? 'hoje' : `em ${f.data(data)}`}.</div>
      </aside>

      {!pronto ? <div /> : (
        <div className="grid grid-main" style={{ alignItems: 'start' }}>
          <div className="stack loose">
            <div className="page-head" style={{ marginBottom: 0 }}>
              <div>
                <div className="eyebrow">Daily · {f.diaSemana(data)} {f.data(data)}</div>
                <h1>{c.nome.toUpperCase()} — DAILY {f.data(data)}</h1>
                <p>{c.cargo}{form.daily ? ' · Daily já registrada — editando' : ''}</p>
              </div>
            </div>

            {form.pendencias.length > 0 && (
              <Card titulo="Pendências que ficaram" icone={Repeat} contagem={form.pendencias.length} tomContagem="red">
                <div className="list">
                  {form.pendencias.map((t) => (
                    <div key={t.id} className="item">
                      <div className="item-main">
                        <div className={`item-title ${pend[t.id] === 'concluir' ? 'done' : ''}`}>{t.titulo}</div>
                        <div className="item-sub">
                          <Prazo data={t.prazo} />
                          {t.reagendamentos > 0 && <span className="row" style={{ gap: 3, color: 'var(--orange)' }}><Repeat size={12} /> já reagendada {t.reagendamentos}×</span>}
                          {t.origem === 'daily' && <span className="dot">da Daily</span>}
                        </div>
                      </div>
                      <Seg valor={pend[t.id] || ''} onChange={(v) => setPend((p) => ({ ...p, [t.id]: p[t.id] === v ? '' : v }))}
                        opcoes={[['concluir', '✓ Feita'], ['hoje', '→ Hoje']]} />
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <Card titulo="O que precisa ser feito hoje?" icone={CornerDownRight} contagem={itens.length} pad>
              <div className="list">
                {itens.map((i, n) => (
                  <div key={i.key} className="daily-item">
                    <input type="checkbox" className="check" checked={i.status === 'Concluído'} aria-label="Concluída"
                      onChange={(e) => setItens((l) => l.map((x, k) => (k === n ? { ...x, status: e.target.checked ? 'Concluído' : 'A fazer' } : x)))} />
                    <input className={`input bare ${i.status === 'Concluído' ? 'item-title done' : ''}`} value={i.titulo}
                      onChange={(e) => setItens((l) => l.map((x, k) => (k === n ? { ...x, titulo: e.target.value } : x)))} />
                    {i.id && i.status !== 'Concluído' && i.status !== 'A fazer' && <Status s={i.status} />}
                    <button className="btn ghost icon sm" aria-label="Remover" onClick={() => setItens((l) => l.filter((_, k) => k !== n))}><X size={14} /></button>
                  </div>
                ))}
              </div>
              <form className="quick-add" onSubmit={addItem} style={{ marginTop: 6 }}>
                <Plus size={16} className="muted" />
                <input className="input" autoFocus value={novo} onChange={(e) => setNovo(e.target.value)} placeholder="Adicionar tarefa e apertar Enter" />
              </form>
              <p className="tiny muted" style={{ margin: '8px 2px 0' }}>Cada item vira uma tarefa de {c.nome} com prazo {data === hoje() ? 'hoje' : f.data(data)}. Se não for concluída, volta como pendência na próxima Daily.</p>
            </Card>

            <div className="grid grid-2">
              <label className="card card-pad stack tight">
                <span className="row label"><AlertOctagon size={15} color="var(--red)" /> Bloqueios</span>
                <AutoTextarea value={campos.bloqueios} onChange={(v) => setCampos((x) => ({ ...x, bloqueios: v }))} placeholder="O que está impedindo de avançar?" />
              </label>
              <label className="card card-pad stack tight">
                <span className="row label"><Handshake size={15} color="var(--green)" /> Combinados</span>
                <AutoTextarea value={campos.combinados} onChange={(v) => setCampos((x) => ({ ...x, combinados: v }))} placeholder="O que ficou combinado?" />
              </label>
            </div>
            <label className="card card-pad stack tight">
              <span className="row label"><NotebookPen size={15} /> Observações do gerente</span>
              <AutoTextarea value={campos.observacoes} onChange={(v) => setCampos((x) => ({ ...x, observacoes: v }))} placeholder="Percepções, tom da conversa, pontos para acompanhar…" />
            </label>

            <div className="row wrap" style={{ justifyContent: 'flex-end' }}>
              <button className="btn lg" disabled={salvando} onClick={() => salvar(false)}><Save /> Salvar</button>
              <button className="btn primary lg" disabled={salvando} onClick={() => salvar(true)}>
                SALVAR DAILY{proximo ? ` → ${proximo.nome}` : ''}
              </button>
            </div>
          </div>

          <div className="stack loose">
            <Card titulo="Última Daily" icone={History} pad>
              {form.anterior ? (
                <div className="stack tight small">
                  <span className="mono muted">{f.data(form.anterior.data)} · {f.relativo(form.anterior.data)}</span>
                  {form.anterior.bloqueios && <div><span className="strong" style={{ color: 'var(--red)' }}>Bloqueio:</span> {form.anterior.bloqueios}</div>}
                  {form.anterior.combinados && <div><span className="strong">Combinado:</span> {form.anterior.combinados}</div>}
                  {form.anterior.observacoes && <div className="muted">{form.anterior.observacoes}</div>}
                  <Link to={`/equipe/${c.id}?aba=daily`} className="btn sm ghost" style={{ alignSelf: 'flex-start' }}>Ver histórico</Link>
                </div>
              ) : <span className="muted small">Primeira Daily registrada.</span>}
            </Card>
            <Card titulo="Cobranças abertas" icone={BellRing} contagem={form.cobrancas.length}
              extra={<button className="btn sm" onClick={() => abrir('cobranca', { pessoa: c.nome })}><Plus /> Cobrar</button>}>
              <div className="list">{form.cobrancas.map((x) => <CobrancaItem key={x.id} c={x} compacto />)}{!form.cobrancas.length && <Vazio>Nada a cobrar.</Vazio>}</div>
            </Card>
            <Card titulo="JOBs sob responsabilidade" icone={Briefcase} contagem={form.jobs.length}>
              <div className="list">{form.jobs.map((j) => <JobItem key={j.id} j={j} compacto />)}{!form.jobs.length && <Vazio>Sem JOBs em aberto.</Vazio>}</div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
