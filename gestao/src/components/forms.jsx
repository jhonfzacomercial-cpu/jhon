import { useMemo, useState } from 'react';
import { ListTodo, BellRing, Briefcase, UserPlus } from 'lucide-react';
import { useStore, useAcao, useDados } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { Modal, Campo, Select, Seg, AutoTextarea, prioridadeOpcao } from './ui.jsx';
import { hoje, addDias, CATEGORIAS, PRIORIDADES, STATUS_TAREFA, STATUS_JOB, STATUS_COBRANCA, STATUS_COLABORADOR, JOB_FECHADO } from '../../shared/constantes.js';

const atalhosData = [['hoje', 0], ['amanhã', 1], ['+2 dias', 2], ['+1 semana', 7]];
function DataRapida({ valor, onChange }) {
  return (
    <div className="stack tight">
      <input type="date" className="input" value={valor || ''} onChange={(e) => onChange(e.target.value)} />
      <div className="chips">
        {atalhosData.map(([r, n]) => {
          const d = addDias(hoje(), n);
          return <button type="button" key={r} className={`chip ${valor === d ? 'on' : ''}`} onClick={() => onChange(d)}>{r}</button>;
        })}
      </div>
    </div>
  );
}

function useJobsAbertos() {
  const { dados } = useDados('/jobs', { inicial: [] });
  return useMemo(() => (dados || []).filter((j) => !JOB_FECHADO.includes(j.status)).map((j) => [String(j.id), `JOB ${j.numero} — ${j.titulo}`]), [dados]);
}

// =============== TAREFA ===============
export function TarefaForm({ dados = {}, onClose }) {
  const { ativos } = useStore();
  const acao = useAcao();
  const editando = !!dados.id;
  const [t, setT] = useState({
    titulo: '', descricao: '', categoria: 'Gestão', prioridade: 'Média', status: 'A fazer', colaborador_id: '',
    prazo: hoje(), hora: '', observacoes: '', job_id: '', checklist: '', ...dados,
    colaborador_id: dados.colaborador_id ? String(dados.colaborador_id) : '', job_id: dados.job_id ? String(dados.job_id) : '',
  });
  const jobs = useJobsAbertos();
  const set = (k) => (v) => setT((x) => ({ ...x, [k]: v }));
  const salvar = async (e) => {
    e?.preventDefault();
    const corpo = { ...t, checklist: editando ? undefined : t.checklist.split('\n').filter((l) => l.trim()) };
    const r = await acao(() => (editando ? api.put(`/tarefas/${t.id}`, corpo) : api.post('/tarefas', corpo)), editando ? 'Tarefa atualizada' : 'Tarefa criada');
    if (r) onClose(r);
  };
  return (
    <Modal titulo={editando ? 'Editar tarefa' : 'Nova tarefa'} icone={<ListTodo size={18} />} onClose={() => onClose()} wide
      rodape={<><button className="btn ghost" onClick={() => onClose()}>Cancelar</button><button className="btn primary" onClick={salvar}>Salvar</button></>}>
      <form className="form-grid" onSubmit={salvar}>
        <Campo rotulo="O que precisa ser feito?" full>
          <input className="input" autoFocus value={t.titulo} onChange={(e) => set('titulo')(e.target.value)} placeholder="Ex.: Revisar proposta comercial" />
        </Campo>
        <Campo rotulo="Responsável">
          <Select valor={t.colaborador_id} onChange={set('colaborador_id')} vazio="Eu (Jhonatas)" opcoes={ativos.map((c) => [String(c.id), c.nome])} />
        </Campo>
        <Campo rotulo="Categoria">
          <Select valor={t.categoria} onChange={set('categoria')} opcoes={CATEGORIAS} />
        </Campo>
        <Campo rotulo="Prioridade" full>
          <Seg valor={t.prioridade} onChange={set('prioridade')} opcoes={PRIORIDADES.map((p) => [p, prioridadeOpcao(p)])} />
        </Campo>
        <Campo rotulo="Prazo">
          <DataRapida valor={t.prazo} onChange={set('prazo')} />
        </Campo>
        <div className="stack">
          <Campo rotulo="Horário (reuniões/compromissos)">
            <input type="time" className="input" value={t.hora || ''} onChange={(e) => set('hora')(e.target.value)} />
          </Campo>
          <Campo rotulo="Status">
            <Select valor={t.status} onChange={set('status')} opcoes={STATUS_TAREFA} />
          </Campo>
        </div>
        <Campo rotulo="Descrição" full>
          <AutoTextarea value={t.descricao} onChange={set('descricao')} placeholder="Detalhes, contexto, links…" />
        </Campo>
        {!editando && (
          <Campo rotulo="Checklist (um item por linha)" full>
            <AutoTextarea value={t.checklist} onChange={set('checklist')} placeholder={'Conferir escopo\nEnviar ao cliente'} />
          </Campo>
        )}
        <Campo rotulo="JOB relacionado">
          <Select valor={t.job_id} onChange={set('job_id')} vazio="—" opcoes={jobs} />
        </Campo>
        <Campo rotulo="Observações">
          <input className="input" value={t.observacoes || ''} onChange={(e) => set('observacoes')(e.target.value)} />
        </Campo>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// =============== COBRANÇA ===============
export function CobrancaForm({ dados = {}, onClose }) {
  const { ativos } = useStore();
  const acao = useAcao();
  const editando = !!dados.id;
  const [c, setC] = useState({
    descricao: '', pessoa: '', proximo_followup: addDias(hoje(), 1), prazo: '', status: 'Pendente', observacao: '', job_id: '', data: hoje(), ...dados,
    pessoa: dados.colaborador_nome || dados.pessoa || (dados.colaborador_id ? ativos.find((a) => a.id === dados.colaborador_id)?.nome : '') || '',
    job_id: dados.job_id ? String(dados.job_id) : '',
  });
  const [mais, setMais] = useState(editando || !!dados.job_id);
  const jobs = useJobsAbertos();
  const set = (k) => (v) => setC((x) => ({ ...x, [k]: v }));
  const salvar = async (e) => {
    e?.preventDefault();
    const corpo = { ...c, colaborador_id: undefined };
    const r = await acao(() => (editando ? api.put(`/cobrancas/${c.id}`, corpo) : api.post('/cobrancas', corpo)), editando ? 'Cobrança atualizada' : 'Cobrança registrada');
    if (r) onClose(r);
  };
  return (
    <Modal titulo={editando ? 'Editar cobrança' : 'Nova cobrança'} icone={<BellRing size={18} />} onClose={() => onClose()}
      rodape={<>
        {!mais && <button className="btn ghost sm" style={{ marginRight: 'auto' }} onClick={() => setMais(true)}>+ prazo, JOB, observação</button>}
        <button className="btn ghost" onClick={() => onClose()}>Cancelar</button><button className="btn primary" onClick={salvar}>Salvar</button>
      </>}>
      <form className="stack" onSubmit={salvar}>
        <Campo rotulo="O que cobrar?">
          <input className="input" autoFocus value={c.descricao} onChange={(e) => set('descricao')(e.target.value)} placeholder="Ex.: Atualização do site" />
        </Campo>
        <Campo rotulo="De quem?" dica="Escolha um colaborador ou digite outro nome (cliente, fornecedor…)">
          <input className="input" list="pessoas" value={c.pessoa} onChange={(e) => set('pessoa')(e.target.value)} placeholder="Nome" />
          <datalist id="pessoas">{ativos.map((a) => <option key={a.id} value={a.nome} />)}</datalist>
        </Campo>
        <Campo rotulo="Quando cobrar (novamente)?">
          <DataRapida valor={c.proximo_followup} onChange={set('proximo_followup')} />
        </Campo>
        {mais && (
          <div className="form-grid">
            <Campo rotulo="Prazo esperado de resolução">
              <input type="date" className="input" value={c.prazo || ''} onChange={(e) => set('prazo')(e.target.value)} />
            </Campo>
            <Campo rotulo="Status">
              <Select valor={c.status} onChange={set('status')} opcoes={STATUS_COBRANCA} />
            </Campo>
            <Campo rotulo="JOB relacionado" full>
              <Select valor={c.job_id} onChange={set('job_id')} vazio="—" opcoes={jobs} />
            </Campo>
            <Campo rotulo="Observação" full>
              <AutoTextarea value={c.observacao} onChange={set('observacao')} />
            </Campo>
          </div>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// =============== JOB ===============
export function JobForm({ dados = {}, onClose }) {
  const { ativos } = useStore();
  const acao = useAcao();
  const editando = !!dados.id;
  const { dados: jobs } = useDados('/jobs', { inicial: [] });
  const clientes = useMemo(() => [...new Set((jobs || []).map((j) => j.cliente).filter(Boolean))].sort(), [jobs]);
  const sugestaoNumero = useMemo(() => {
    const nums = (jobs || []).map((j) => parseInt(j.numero, 10)).filter((n) => !Number.isNaN(n));
    return nums.length ? String(Math.max(...nums) + 1).padStart(3, '0') : '';
  }, [jobs]);
  const [j, setJ] = useState({
    numero: '', titulo: '', cliente: '', colaborador_id: '', setor: '', data_entrada: hoje(), prazo: '', status: 'Novo', prioridade: 'Média',
    proxima_acao: '', proxima_acao_responsavel: '', observacoes: '', ...dados,
    colaborador_id: dados.colaborador_id ? String(dados.colaborador_id) : '',
  });
  const set = (k) => (v) => setJ((x) => ({ ...x, [k]: v }));
  const salvar = async (e) => {
    e?.preventDefault();
    const corpo = { ...j, numero: j.numero || sugestaoNumero };
    const r = await acao(() => (editando ? api.put(`/jobs/${j.id}`, corpo) : api.post('/jobs', corpo)), editando ? 'JOB atualizado' : 'JOB cadastrado');
    if (r) onClose(r);
  };
  return (
    <Modal titulo={editando ? `Editar JOB ${dados.numero}` : 'Novo JOB'} icone={<Briefcase size={18} />} onClose={() => onClose()} wide
      rodape={<><button className="btn ghost" onClick={() => onClose()}>Cancelar</button><button className="btn primary" onClick={salvar}>Salvar</button></>}>
      <form className="form-grid" onSubmit={salvar}>
        <Campo rotulo="Número">
          <input className="input mono" value={j.numero} onChange={(e) => set('numero')(e.target.value)} placeholder={sugestaoNumero || '041'} autoFocus={!editando} />
        </Campo>
        <Campo rotulo="Nome do JOB">
          <input className="input" value={j.titulo} onChange={(e) => set('titulo')(e.target.value)} placeholder="Campanha de lançamento" />
        </Campo>
        <Campo rotulo="Cliente">
          <input className="input" list="clientes" value={j.cliente || ''} onChange={(e) => set('cliente')(e.target.value)} />
          <datalist id="clientes">{clientes.map((c) => <option key={c} value={c} />)}</datalist>
        </Campo>
        <Campo rotulo="Responsável">
          <Select valor={j.colaborador_id} onChange={set('colaborador_id')} vazio="—" opcoes={ativos.map((c) => [String(c.id), c.nome])} />
        </Campo>
        <Campo rotulo="Setor">
          <input className="input" value={j.setor || ''} onChange={(e) => set('setor')(e.target.value)} placeholder="Criação, Conteúdo, Web…" />
        </Campo>
        <Campo rotulo="Status">
          <Select valor={j.status} onChange={set('status')} opcoes={STATUS_JOB} />
        </Campo>
        <Campo rotulo="Data de entrada">
          <input type="date" className="input" value={j.data_entrada || ''} onChange={(e) => set('data_entrada')(e.target.value)} />
        </Campo>
        <Campo rotulo="Prazo">
          <input type="date" className="input" value={j.prazo || ''} onChange={(e) => set('prazo')(e.target.value)} />
        </Campo>
        <Campo rotulo="Prioridade" full>
          <Seg valor={j.prioridade} onChange={set('prioridade')} opcoes={PRIORIDADES.map((p) => [p, prioridadeOpcao(p)])} />
        </Campo>
        <Campo rotulo="Próxima ação">
          <input className="input" value={j.proxima_acao || ''} onChange={(e) => set('proxima_acao')(e.target.value)} placeholder="Enviar para aprovação" />
        </Campo>
        <Campo rotulo="Responsável pela próxima ação">
          <input className="input" list="pessoas-job" value={j.proxima_acao_responsavel || ''} onChange={(e) => set('proxima_acao_responsavel')(e.target.value)} />
          <datalist id="pessoas-job">{ativos.map((a) => <option key={a.id} value={a.nome} />)}<option value="Cliente" /><option value="Jhonatas" /></datalist>
        </Campo>
        <Campo rotulo="Observações" full>
          <AutoTextarea value={j.observacoes} onChange={set('observacoes')} />
        </Campo>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// =============== COLABORADOR ===============
export function ColaboradorForm({ dados = {}, onClose }) {
  const acao = useAcao();
  const editando = !!dados.id;
  const [c, setC] = useState({ nome: '', cargo: '', area: '', data_entrada: '', status: 'Ativo', daily_horario: '', one_a_one_dia: 15, observacoes: '', ...dados });
  const set = (k) => (v) => setC((x) => ({ ...x, [k]: v }));
  const salvar = async (e) => {
    e?.preventDefault();
    const r = await acao(() => (editando ? api.put(`/colaboradores/${c.id}`, c) : api.post('/colaboradores', c)), editando ? 'Colaborador atualizado' : 'Colaborador cadastrado');
    if (r) onClose(r);
  };
  return (
    <Modal titulo={editando ? `Editar ${dados.nome}` : 'Novo colaborador'} icone={<UserPlus size={18} />} onClose={() => onClose()}
      rodape={<><button className="btn ghost" onClick={() => onClose()}>Cancelar</button><button className="btn primary" onClick={salvar}>Salvar</button></>}>
      <form className="form-grid" onSubmit={salvar}>
        <Campo rotulo="Nome" full><input className="input" autoFocus value={c.nome} onChange={(e) => set('nome')(e.target.value)} /></Campo>
        <Campo rotulo="Cargo"><input className="input" value={c.cargo || ''} onChange={(e) => set('cargo')(e.target.value)} /></Campo>
        <Campo rotulo="Área"><input className="input" value={c.area || ''} onChange={(e) => set('area')(e.target.value)} /></Campo>
        <Campo rotulo="Data de entrada"><input type="date" className="input" value={c.data_entrada || ''} onChange={(e) => set('data_entrada')(e.target.value)} /></Campo>
        <Campo rotulo="Status"><Select valor={c.status} onChange={set('status')} opcoes={STATUS_COLABORADOR} /></Campo>
        <Campo rotulo="Horário da Daily"><input type="time" className="input" value={c.daily_horario || ''} onChange={(e) => set('daily_horario')(e.target.value)} /></Campo>
        <Campo rotulo="Dia do One a One no mês" dica="Fim de semana é ajustado automaticamente">
          <input type="number" min="1" max="31" className="input" value={c.one_a_one_dia ?? 15} onChange={(e) => set('one_a_one_dia')(Number(e.target.value))} />
        </Campo>
        <Campo rotulo="Observações gerais" full><AutoTextarea value={c.observacoes} onChange={set('observacoes')} /></Campo>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

/** Renderiza o modal global ativo. */
export function ModaisGlobais() {
  const { modal, fechar } = useStore();
  if (!modal) return null;
  const props = { dados: modal.dados, onClose: (r) => { fechar(); modal.dados?.onSaved?.(r); } };
  const Comp = { tarefa: TarefaForm, cobranca: CobrancaForm, job: JobForm, colaborador: ColaboradorForm }[modal.tipo];
  return Comp ? <Comp key={modal.tipo + (modal.dados?.id || '')} {...props} /> : null;
}
