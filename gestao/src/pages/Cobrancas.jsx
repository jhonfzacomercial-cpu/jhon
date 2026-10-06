import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, BellRing } from 'lucide-react';
import { useStore, useDados, useAcao } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { PageHead, Card, Vazio, Chips, Select } from '../components/ui.jsx';
import { CobrancaItem } from '../components/itens.jsx';
import { hoje, addDias, normalizar } from '../../shared/constantes.js';

const FILTROS = {
  hoje: (c) => c.cobrar_hoje,
  vencidas: (c) => c.vencida,
  abertas: (c) => c.status !== 'Resolvido',
  aguardando: (c) => c.status === 'Aguardando',
  sem_retorno: (c) => c.status === 'Sem retorno',
  resolvidas: (c) => c.status === 'Resolvido',
  todas: () => true,
};

/** Barra de cadastro em uma linha: o que, quem, quando. */
function CobrancaRapida() {
  const { ativos, abrir } = useStore();
  const acao = useAcao();
  const vazio = { descricao: '', pessoa: '', proximo_followup: addDias(hoje(), 1) };
  const [c, setC] = useState(vazio);
  const salvar = async (e) => {
    e.preventDefault();
    if (!c.descricao.trim()) return;
    if (await acao(() => api.post('/cobrancas', c), 'Cobrança registrada')) setC(vazio);
  };
  return (
    <form className="card card-pad" onSubmit={salvar} style={{ marginBottom: 16 }}>
      <div className="row wrap" style={{ alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: '2 1 240px' }}><span>O que cobrar?</span>
          <input className="input" value={c.descricao} onChange={(e) => setC({ ...c, descricao: e.target.value })} placeholder="Ex.: Atualização do site" />
        </label>
        <label className="field" style={{ flex: '1 1 160px' }}><span>Responsável?</span>
          <input className="input" list="pessoas-cob" value={c.pessoa} onChange={(e) => setC({ ...c, pessoa: e.target.value })} placeholder="Nome" />
          <datalist id="pessoas-cob">{ativos.map((a) => <option key={a.id} value={a.nome} />)}</datalist>
        </label>
        <label className="field" style={{ flex: '1 1 150px' }}><span>Quando cobrar novamente?</span>
          <input type="date" className="input" value={c.proximo_followup} onChange={(e) => setC({ ...c, proximo_followup: e.target.value })} />
        </label>
        <button className="btn primary" style={{ minHeight: 38 }}><Plus /> Salvar</button>
        <button type="button" className="btn ghost" style={{ minHeight: 38 }} onClick={() => abrir('cobranca', c)}>Mais campos</button>
      </div>
    </form>
  );
}

export function Cobrancas() {
  const { detalhe, ativos } = useStore();
  const [params, setParams] = useSearchParams();
  const [filtro, setFiltro] = useState('abertas');
  const [pessoa, setPessoa] = useState('');
  const [texto, setTexto] = useState('');
  const { dados } = useDados('/cobrancas', { inicial: [] });

  useEffect(() => {
    const id = params.get('id');
    if (id) {
      detalhe('cobranca', Number(id));
      params.delete('id');
      setParams(params, { replace: true });
    }
  }, [params, setParams, detalhe]);

  const pessoas = useMemo(() => [...new Set((dados || []).map((c) => c.pessoa_nome))].sort(), [dados]);
  const base = (dados || []).filter((c) => (!pessoa || c.pessoa_nome === pessoa) && (!texto || normalizar(`${c.descricao} ${c.pessoa_nome} ${c.observacao || ''}`).includes(normalizar(texto))));
  const lista = base.filter(FILTROS[filtro]).sort((a, b) => (b.vencida - a.vencida) || (a.proximo_followup || '9999').localeCompare(b.proximo_followup || '9999'));
  const cont = (k) => base.filter(FILTROS[k]).length;
  void ativos;

  return (
    <>
      <PageHead eyebrow="Cobranças e follow-up" titulo="Não esquecer o que precisa ser cobrado" sub='Clique em "Cobrei" para registrar o contato e agendar o próximo follow-up.' />
      <CobrancaRapida />
      <div className="toolbar">
        <Chips valor={filtro} onChange={setFiltro} opcoes={[
          ['hoje', '🟠 Cobrar hoje', cont('hoje')], ['vencidas', '🔴 Vencidas', cont('vencidas')], ['abertas', 'Abertas', cont('abertas')],
          ['aguardando', 'Aguardando', cont('aguardando')], ['sem_retorno', 'Sem retorno', cont('sem_retorno')], ['resolvidas', 'Resolvidas', cont('resolvidas')], ['todas', 'Todas', base.length],
        ]} />
      </div>
      <div className="toolbar">
        <div className="search-input"><Search /><input className="input" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Filtrar por texto" /></div>
        <Select valor={pessoa} onChange={setPessoa} vazio="Todas as pessoas" opcoes={pessoas} />
      </div>
      <Card titulo="Cobranças" icone={BellRing} contagem={lista.length}>
        <div className="list">
          {lista.map((c) => <CobrancaItem key={c.id} c={c} />)}
          {!lista.length && <Vazio ok={filtro === 'hoje'}>{filtro === 'hoje' ? 'Nada para cobrar hoje.' : 'Nenhuma cobrança neste filtro.'}</Vazio>}
        </div>
      </Card>
    </>
  );
}
