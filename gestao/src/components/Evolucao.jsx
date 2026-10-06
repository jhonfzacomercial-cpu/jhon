import { useAcao } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import * as f from '../lib/formato.js';
import { Badge, Status, Vazio, Menu } from './ui.jsx';
import { RESULTADO_ICONE, mesDe } from '../../shared/constantes.js';
import { MoreHorizontal } from 'lucide-react';

const TOM_TIPO = { Continuar: 'green', Parar: 'red', Começar: 'amber' };

/** Sequência de resultados de um item (🟢🟡🔴) ao longo dos meses. */
export function Trilha({ avaliacoes }) {
  if (!avaliacoes.length) return <span className="tiny muted">ainda não avaliado</span>;
  return (
    <span className="row" style={{ gap: 4 }}>
      {avaliacoes.map((a) => <span key={a.id} title={`${f.mes(a.mes || mesDe(a.data))}: ${a.resultado}${a.observacao ? ` — ${a.observacao}` : ''}`}>{RESULTADO_ICONE[a.resultado]}</span>)}
    </span>
  );
}

/** Lista de pontos CPC com status, trilha de avaliações e ações. */
export function ListaCpc({ cpc }) {
  const acao = useAcao();
  if (!cpc.length) return <Vazio>Nenhum ponto de desenvolvimento registrado.</Vazio>;
  const ordem = { 'Em acompanhamento': 0, Concluído: 1, Encerrado: 2 };
  return (
    <div className="list">
      {[...cpc].sort((a, b) => ordem[a.status] - ordem[b.status] || b.criado_em.localeCompare(a.criado_em)).map((p) => (
        <div key={p.id} className="item">
          <Badge tom={TOM_TIPO[p.tipo]}>{p.tipo}</Badge>
          <div className="item-main">
            <div className={`item-title ${p.status !== 'Em acompanhamento' ? 'done' : ''}`} style={{ whiteSpace: 'normal' }}>{p.descricao}</div>
            <div className="item-sub">
              <span>origem: {p.origem_mes ? `One a One ${f.mes(p.origem_mes)}` : 'manual'}</span>
              {p.status === 'Em acompanhamento' && p.proxima_avaliacao && <span className="dot">avaliar em {f.mes(p.proxima_avaliacao)}</span>}
              {p.ultima_avaliacao?.observacao && <span className="dot ellipsis" style={{ maxWidth: 320 }}>“{p.ultima_avaliacao.observacao}”</span>}
            </div>
          </div>
          <div className="item-side">
            <Trilha avaliacoes={p.avaliacoes} />
            {p.pendente_avaliacao ? <Badge tom="orange">avaliar</Badge> : <Status s={p.status} />}
            <Menu botao={(t) => <button className="btn ghost icon sm" onClick={t} aria-label="Ações"><MoreHorizontal size={16} /></button>}>
              {p.status === 'Em acompanhamento'
                ? <button onClick={() => acao(() => api.put(`/cpc/${p.id}`, { status: 'Encerrado' }), 'Item encerrado')}>Encerrar acompanhamento</button>
                : <button onClick={() => acao(() => api.put(`/cpc/${p.id}`, { status: 'Em acompanhamento' }), 'Acompanhamento reaberto')}>Voltar a acompanhar</button>}
              <button onClick={() => acao(() => api.del(`/cpc/${p.id}`), 'Item excluído')}>Excluir</button>
            </Menu>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Linha do tempo mês a mês: o que foi pedido e como foi avaliado. */
export function LinhaEvolucao({ cpc }) {
  const meses = {};
  const mesDoItem = (p) => p.origem_mes || mesDe(p.criado_em);
  for (const p of cpc) {
    (meses[mesDoItem(p)] ||= { criados: [], avaliados: [] }).criados.push(p);
    for (const a of p.avaliacoes) (meses[a.mes || mesDe(a.data)] ||= { criados: [], avaliados: [] }).avaliados.push({ p, a });
  }
  const chaves = Object.keys(meses).sort().reverse();
  if (!chaves.length) return <Vazio>A evolução aparece aqui a partir do primeiro One a One com CPC.</Vazio>;
  return chaves.map((m) => {
    const { criados, avaliados } = meses[m];
    return (
      <div key={m} className="evo-month">
        <h3>{f.mes(m)}</h3>
        {avaliados.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div className="label" style={{ marginBottom: 2 }}>Avaliação</div>
            {avaliados.map(({ p, a }) => (
              <div key={a.id} className="evo-line">
                <span>{RESULTADO_ICONE[a.resultado]}</span>
                <div><span className="strong">{p.descricao}</span> <span className="muted small">— {a.resultado}</span>
                  {a.observacao && <div className="small muted">“{a.observacao}”</div>}</div>
              </div>
            ))}
          </div>
        )}
        {criados.length > 0 && (
          <div>
            <div className="label" style={{ marginBottom: 2 }}>Definido no One a One</div>
            {['Continuar', 'Parar', 'Começar'].map((tipo) => criados.filter((p) => p.tipo === tipo).map((p) => (
              <div key={p.id} className="evo-line"><span className="evo-tipo" style={{ color: `var(--${TOM_TIPO[tipo] === 'amber' ? 'amber-deep' : TOM_TIPO[tipo]})` }}>{tipo}</span><span>{p.descricao}</span></div>
            )))}
          </div>
        )}
      </div>
    );
  });
}
