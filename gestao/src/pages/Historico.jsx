import { useMemo, useState } from 'react';
import { History } from 'lucide-react';
import { useStore, useDados } from '../lib/store.jsx';
import * as f from '../lib/formato.js';
import { PageHead, Card, Vazio, Chips, Select } from '../components/ui.jsx';

const TIPOS = [
  ['', 'Tudo'], ['tarefa', 'Tarefas'], ['cobranca', 'Cobranças'], ['daily', 'Daily'], ['job', 'JOBs'],
  ['one_a_one', 'One a One'], ['cpc', 'CPC'], ['pendencia', 'Pendências'], ['colaborador', 'Equipe'],
];
const TOM = (t) => (/atrasad|vencid/.test(t) ? 'var(--red)' : /conclu|realizad|resolv/.test(t) ? 'var(--green)' : /cpc|one_a_one/.test(t) ? 'var(--purple)' : /cobranca/.test(t) ? 'var(--amber-deep)' : 'var(--rule-2)');

export function Historico() {
  const { colaboradores } = useStore();
  const [tipo, setTipo] = useState('');
  const [colab, setColab] = useState('');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const qs = new URLSearchParams(Object.entries({ tipo, colaborador_id: colab, de, ate, limite: 1000 }).filter(([, v]) => v)).toString();
  const { dados } = useDados(`/historico?${qs}`, { inicial: [] });
  const porDia = useMemo(() => (dados || []).reduce((acc, h) => { (acc[h.data_hora.slice(0, 10)] ||= []).push(h); return acc; }, {}), [dados]);

  return (
    <>
      <PageHead eyebrow="Histórico" titulo="Memória da minha gestão" sub="Tudo que acontece no sistema fica registrado automaticamente." />
      <div className="toolbar"><Chips valor={tipo} onChange={setTipo} opcoes={TIPOS} /></div>
      <div className="toolbar">
        <Select valor={colab} onChange={setColab} vazio="Todos os colaboradores" opcoes={colaboradores.map((c) => [String(c.id), c.nome])} />
        <label className="row small">de <input type="date" className="input" value={de} onChange={(e) => setDe(e.target.value)} /></label>
        <label className="row small">até <input type="date" className="input" value={ate} onChange={(e) => setAte(e.target.value)} /></label>
        <span className="muted small">{dados?.length || 0} eventos</span>
      </div>
      <div className="stack loose">
        {Object.entries(porDia).map(([dia, itens]) => (
          <Card key={dia} titulo={`${f.data(dia, { ano: true })} · ${f.diaSemana(dia)} · ${f.relativo(dia)}`} icone={History} contagem={itens.length}>
            <div className="list">
              {itens.map((h) => (
                <div key={h.id} className="item">
                  <span className="dot-status" style={{ background: TOM(h.tipo) }} />
                  <span className="mono tiny muted" style={{ width: 40 }}>{h.data_hora.slice(11, 16)}</span>
                  <div className="item-main"><div style={{ whiteSpace: 'normal' }}>{h.descricao}</div></div>
                  {h.colaborador_nome && <span className="badge outline">{h.colaborador_nome}</span>}
                </div>
              ))}
            </div>
          </Card>
        ))}
        {!dados?.length && <Card><Vazio big>Nenhum evento para esses filtros.</Vazio></Card>}
      </div>
    </>
  );
}
