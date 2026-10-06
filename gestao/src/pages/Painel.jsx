import { useNavigate, Link } from 'react-router-dom';
import { ShieldAlert, Users, History, CheckCircle2 } from 'lucide-react';
import { useDados } from '../lib/store.jsx';
import * as f from '../lib/formato.js';
import { Card, PageHead, Vazio, Semaforo, Avatar, Badge } from '../components/ui.jsx';
import { Kpis } from './MeuDia.jsx';

const NIVEL = {
  vermelho: { emoji: '🔴', tom: 'red' },
  laranja: { emoji: '🟠', tom: 'amber' },
  amarelo: { emoji: '🟡', tom: 'amber' },
  verde: { emoji: '🟢', tom: '' },
};

export function AtencaoGerente({ alertas, limite = 6 }) {
  const nav = useNavigate();
  const grupos = alertas.reduce((acc, a) => {
    (acc[a.grupo] ||= { nivel: a.nivel, itens: [] }).itens.push(a);
    return acc;
  }, {});
  const entradas = Object.entries(grupos);
  if (!entradas.length) return <Vazio ok>Nada exige sua atenção agora.</Vazio>;
  return entradas.map(([grupo, { nivel, itens }]) => (
    <div key={grupo} className="alert-group">
      <h4>{NIVEL[nivel].emoji} {grupo}<span className={`count-pill ${NIVEL[nivel].tom}`}>{itens.length}</span></h4>
      {itens.slice(0, limite).map((a, i) => (
        <div key={i} className="item clickable" onClick={() => nav(a.link)}>
          <div className="item-main">
            <div className="item-title">{a.titulo}</div>
            <div className="item-sub">{a.sub}</div>
          </div>
        </div>
      ))}
      {itens.length > limite && <div className="muted small" style={{ padding: '2px 10px 6px' }}>+ {itens.length - limite} outros</div>}
    </div>
  ));
}

export function TabelaEquipe({ equipe }) {
  const nav = useNavigate();
  const ordenada = [...equipe].sort((a, b) => b.atencao - a.atencao);
  if (!ordenada.length) return <Vazio>Nenhum colaborador cadastrado.</Vazio>;
  const n = (v, alerta) => <span className={v ? (alerta ? 'num-red' : '') : 'num-zero'}>{v}</span>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Colaborador</th><th className="center">Daily</th><th className="num">Pendências</th><th className="num">Atrasados</th>
            <th className="num">Recorrentes</th><th className="num">Cobranças</th><th className="center">CPC</th><th>One a One</th>
          </tr>
        </thead>
        <tbody>
          {ordenada.map((c) => (
            <tr key={c.id} className={`clickable ${c.atrasados > 0 || c.cpc === 'vermelho' ? 'alerta' : ''}`} onClick={() => nav(`/equipe/${c.id}`)}>
              <td>
                <div className="row"><Avatar nome={c.nome} size="sm" /><div><div className="strong">{c.nome}</div><div className="tiny muted">{c.cargo}</div></div></div>
              </td>
              <td className="center">{c.status !== 'Ativo' ? <Badge tom="outline">{c.status}</Badge> : c.daily_hoje ? (c.daily_hoje.bloqueios ? <span title={c.daily_hoje.bloqueios}>✅ ⚠️</span> : '✅') : <span className="muted">—</span>}</td>
              <td className="num">{n(c.pendencias)}</td>
              <td className="num">{n(c.atrasados, true)}</td>
              <td className="num">{n(c.recorrentes, true)}</td>
              <td className="num">{n(c.cobrancas)}</td>
              <td className="center"><Semaforo cor={c.cpc} /></td>
              <td className="small nowrap">{c.proximo_one_a_one ? <span title={f.relativo(c.proximo_one_a_one.data)}>{f.data(c.proximo_one_a_one.data)}</span> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Painel() {
  const { dados: r } = useDados('/resumo');
  const { dados: hist } = useDados('/historico?limite=12', { inicial: [] });
  if (!r) return null;
  return (
    <>
      <PageHead eyebrow="Painel gerencial" titulo="O que eu preciso resolver e cobrar hoje?" sub={f.dataLonga(r.hoje)} />
      <Kpis r={r} />
      <div className="grid grid-main">
        <div className="stack loose">
          <Card titulo="Visão da equipe" icone={Users} extra={<Link to="/equipe" className="btn sm ghost">Equipe</Link>}>
            <TabelaEquipe equipe={r.equipe} />
          </Card>
          <Card titulo="Atividade recente" icone={History} extra={<Link to="/historico" className="btn sm ghost">Histórico</Link>}>
            <div className="list">
              {(hist || []).map((h) => (
                <div key={h.id} className="item">
                  <span className="mono tiny muted nowrap" style={{ width: 82 }}>{f.dataHora(h.data_hora)}</span>
                  <div className="item-main ellipsis">{h.descricao}</div>
                </div>
              ))}
              {!hist?.length && <Vazio>Sem atividade registrada.</Vazio>}
            </div>
          </Card>
        </div>
        <Card titulo="Atenção do gerente" icone={ShieldAlert} contagem={r.alertas.filter((a) => a.nivel !== 'verde').length} tomContagem="red">
          <AtencaoGerente alertas={r.alertas} />
          {!r.concluidasHoje.length && <div className="small muted row" style={{ padding: '6px 14px 10px' }}><CheckCircle2 size={14} /> Nenhuma tarefa concluída hoje ainda.</div>}
        </Card>
      </div>
    </>
  );
}
