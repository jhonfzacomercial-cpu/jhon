import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { List, Columns3, Plus, Search } from 'lucide-react';
import { useStore, useDados, useAcao } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { PageHead, Card, Vazio, Seg, Chips, Select, Prioridade, Prazo, Badge } from '../components/ui.jsx';
import { TarefaItem } from '../components/itens.jsx';
import { Kanban } from '../components/Kanban.jsx';
import { hoje, addDias, normalizar, CATEGORIAS, PRIORIDADES, PRIORIDADE_PESO, DIAS_PROXIMOS } from '../../shared/constantes.js';

const FILTROS = {
  abertas: (t) => t.status !== 'Concluído',
  atrasadas: (t) => t.atrasado,
  hoje: (t) => t.status !== 'Concluído' && t.prazo === hoje(),
  proximos: (t) => t.status !== 'Concluído' && t.prazo > hoje() && t.prazo <= addDias(hoje(), DIAS_PROXIMOS),
  aguardando: (t) => t.status === 'Aguardando',
  concluidas: (t) => t.status === 'Concluído',
  todas: () => true,
};

function grupoDe(t) {
  if (t.status === 'Concluído') return 'Concluídas';
  if (t.atrasado) return 'Atrasadas';
  if (!t.prazo) return 'Sem prazo';
  if (t.prazo === hoje()) return 'Hoje';
  if (t.prazo === addDias(hoje(), 1)) return 'Amanhã';
  if (t.prazo <= addDias(hoje(), 7)) return 'Próximos 7 dias';
  return 'Mais adiante';
}
const ORDEM_GRUPOS = ['Atrasadas', 'Hoje', 'Amanhã', 'Próximos 7 dias', 'Mais adiante', 'Sem prazo', 'Concluídas'];
const ordenar = (a, b) => (a.prazo || '9999').localeCompare(b.prazo || '9999') || (a.hora || '99').localeCompare(b.hora || '99') || PRIORIDADE_PESO[a.prioridade] - PRIORIDADE_PESO[b.prioridade];

export function Agenda() {
  const { abrir, detalhe, ativos } = useStore();
  const acao = useAcao();
  const [params, setParams] = useSearchParams();
  const [escopo, setEscopo] = useState(params.get('escopo') || 'meu');
  const [visao, setVisao] = useState('lista');
  const [filtro, setFiltro] = useState(params.get('filtro') || 'abertas');
  const [categoria, setCategoria] = useState('');
  const [prioridade, setPrioridade] = useState('');
  const [pessoa, setPessoa] = useState('');
  const [texto, setTexto] = useState('');
  const { dados } = useDados(`/tarefas?escopo=${escopo === 'todas' ? '' : escopo}`, { inicial: [] });

  useEffect(() => {
    const id = params.get('tarefa');
    if (id) {
      detalhe('tarefa', Number(id));
      params.delete('tarefa');
      setParams(params, { replace: true });
    }
  }, [params, setParams, detalhe]);

  const base = useMemo(() => (dados || []).filter((t) =>
    (!categoria || t.categoria === categoria)
    && (!prioridade || t.prioridade === prioridade)
    && (!pessoa || String(t.colaborador_id) === pessoa)
    && (!texto || normalizar(`${t.titulo} ${t.descricao || ''} ${t.colaborador_nome || ''}`).includes(normalizar(texto)))), [dados, categoria, prioridade, pessoa, texto]);
  const lista = useMemo(() => base.filter(FILTROS[filtro]).sort(ordenar), [base, filtro]);
  const grupos = useMemo(() => {
    if (filtro === 'concluidas') return [['Concluídas', [...lista].sort((a, b) => (b.concluido_em || '').localeCompare(a.concluido_em || ''))]];
    const g = {};
    lista.forEach((t) => (g[grupoDe(t)] ||= []).push(t));
    return ORDEM_GRUPOS.filter((k) => g[k]).map((k) => [k, g[k]]);
  }, [lista, filtro]);

  const cont = (k) => base.filter(FILTROS[k]).length;
  const novoPadrao = escopo === 'equipe' && pessoa ? { colaborador_id: Number(pessoa), categoria: 'Equipe' } : {};

  return (
    <>
      <PageHead eyebrow="Minha agenda" titulo={escopo === 'meu' ? 'Minhas tarefas e compromissos' : escopo === 'equipe' ? 'Tarefas da equipe' : 'Todas as tarefas'}
        sub="Tarefa vencida e não concluída vira ATRASADA automaticamente.">
        <Seg valor={escopo} onChange={(v) => { setEscopo(v); setPessoa(''); }} opcoes={[['meu', 'Minhas'], ['equipe', 'Equipe'], ['todas', 'Todas']]} />
        <Seg valor={visao} onChange={setVisao} opcoes={[['lista', 'Lista', List], ['kanban', 'Kanban', Columns3]]} />
        <button className="btn primary" onClick={() => abrir('tarefa', novoPadrao)}><Plus /> Nova tarefa</button>
      </PageHead>

      <div className="toolbar">
        <Chips valor={filtro} onChange={setFiltro} opcoes={[
          ['abertas', 'Abertas', cont('abertas')], ['atrasadas', '🔴 Atrasadas', cont('atrasadas')], ['hoje', 'Hoje', cont('hoje')],
          ['proximos', 'Próximos 7 dias', cont('proximos')], ['aguardando', 'Aguardando', cont('aguardando')], ['concluidas', 'Concluídas', cont('concluidas')], ['todas', 'Todas', base.length],
        ]} />
      </div>
      <div className="toolbar">
        <div className="search-input"><Search /><input className="input" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Filtrar por texto" /></div>
        <Select valor={categoria} onChange={setCategoria} vazio="Todas as categorias" opcoes={CATEGORIAS} />
        <Select valor={prioridade} onChange={setPrioridade} vazio="Todas as prioridades" opcoes={PRIORIDADES} />
        {escopo !== 'meu' && <Select valor={pessoa} onChange={setPessoa} vazio="Todos os responsáveis" opcoes={ativos.map((c) => [String(c.id), c.nome])} />}
      </div>

      {visao === 'lista' ? (
        <div className="stack loose">
          {grupos.map(([nome, itens]) => (
            <Card key={nome} titulo={nome} contagem={itens.length} tomContagem={nome === 'Atrasadas' ? 'red' : nome === 'Hoje' ? 'amber' : ''}>
              <div className="list">{itens.map((t) => <TarefaItem key={t.id} t={t} mostrarResp={escopo !== 'meu'} mostrarStatus />)}</div>
            </Card>
          ))}
          {!grupos.length && <Card><Vazio big>Nenhuma tarefa neste filtro.</Vazio></Card>}
        </div>
      ) : (
        <Kanban
          colunas={['A fazer', 'Em andamento', 'Aguardando', 'Concluído']}
          itens={filtro === 'concluidas' || filtro === 'todas' ? base : base.filter((t) => t.status !== 'Concluído' || t.concluido_em?.slice(0, 10) >= addDias(hoje(), -7))}
          colunaDe={(t) => (t.status === 'Atrasado' ? 'A fazer' : t.status)}
          onMover={(t, status) => acao(() => api.put(`/tarefas/${t.id}`, { status }), `${t.titulo} → ${status}`)}
          onAbrir={(t) => detalhe('tarefa', t.id)}
          renderCard={(t) => (
            <>
              <div className="kcard-title">{t.titulo}</div>
              <div className="row wrap" style={{ gap: 6 }}>
                <Prioridade p={t.prioridade} />
                {escopo !== 'meu' && <span className="small muted">{t.colaborador_nome || 'Eu'}</span>}
                <Badge tom="outline">{t.categoria}</Badge>
                <span className="grow" />
                <Prazo data={t.prazo} fechado={t.status === 'Concluído'} />
              </div>
            </>
          )}
        />
      )}
    </>
  );
}
