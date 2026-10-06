import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Wand2, MessagesSquare, Plus } from 'lucide-react';
import { useStore, useDados, useAcao } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import * as f from '../lib/formato.js';
import { PageHead, Card, Vazio, Status, Avatar, Badge, Select } from '../components/ui.jsx';
import { mesAtual, addMeses, hoje, dataOneAOne } from '../../shared/constantes.js';

export function OneAOnes() {
  const [mes, setMes] = useState(mesAtual());
  const { ativos } = useStore();
  const acao = useAcao();
  const nav = useNavigate();
  const { dados } = useDados(`/one-a-ones?mes=${mes}`, { inicial: [] });
  const [novo, setNovo] = useState('');
  const lista = dados || [];
  const semReuniao = ativos.filter((c) => c.status === 'Ativo' && !lista.some((o) => o.colaborador_id === c.id));
  const finalizados = lista.filter((o) => o.status === 'Finalizado').length;

  return (
    <>
      <PageHead eyebrow="One a One mensal" titulo={`One a Ones — ${f.mes(mes)}`} sub="Conversa individual com CPC (Continuar, Parar, Começar), avaliação do mês anterior e feedback do colaborador.">
        <div className="row">
          <button className="btn icon" onClick={() => setMes(addMeses(mes, -1))} aria-label="Mês anterior"><ChevronLeft /></button>
          <button className="btn" onClick={() => setMes(mesAtual())} disabled={mes === mesAtual()}>Mês atual</button>
          <button className="btn icon" onClick={() => setMes(addMeses(mes, 1))} aria-label="Próximo mês"><ChevronRight /></button>
        </div>
        {semReuniao.length > 0 && (
          <button className="btn primary" onClick={() => acao(() => api.post('/one-a-ones/gerar', { mes }), 'One a Ones do mês criados')}><Wand2 /> Criar para toda a equipe</button>
        )}
      </PageHead>

      <Card titulo="Reuniões do mês" icone={MessagesSquare} contagem={`${finalizados}/${lista.length}`}>
        {lista.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Colaborador</th><th>Data</th><th>Status</th><th className="num">CPC novos</th><th className="num">CPC avaliados</th><th /></tr></thead>
              <tbody>
                {lista.map((o) => (
                  <tr key={o.id} className={`clickable ${o.status === 'Agendado' && o.data < hoje() ? 'alerta' : ''}`} onClick={() => nav(`/one-a-one/${o.id}`)}>
                    <td><div className="row"><Avatar nome={o.colaborador_nome} size="sm" /><div><div className="strong">{o.colaborador_nome}</div><div className="tiny muted">{o.cargo}</div></div></div></td>
                    <td className="nowrap">{f.data(o.data)} · {f.diaSemana(o.data)}{o.hora ? ` ${o.hora}` : ''}
                      {o.status === 'Agendado' && <div className="tiny" style={{ color: o.data < hoje() ? 'var(--red)' : 'var(--muted)' }}>{o.data < hoje() ? `atrasado (${f.relativo(o.data)})` : f.relativo(o.data)}</div>}
                    </td>
                    <td><Status s={o.status} /></td>
                    <td className="num">{o.cpc_novos}</td>
                    <td className="num">{o.cpc_avaliados}</td>
                    <td className="num"><span className="btn sm">{o.status === 'Finalizado' ? 'Ver' : 'Conduzir'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Vazio big>Nenhum One a One neste mês.</Vazio>}
      </Card>

      {semReuniao.length > 0 && (
        <Card titulo="Sem One a One neste mês" pad className="mt">
          <div className="row wrap">
            <Select valor={novo} onChange={setNovo} vazio="Escolha o colaborador" opcoes={semReuniao.map((c) => [String(c.id), c.nome])} style={{ maxWidth: 260 }} />
            <button className="btn" disabled={!novo} onClick={async () => {
              const c = semReuniao.find((x) => String(x.id) === novo);
              const o = await acao(() => api.post('/one-a-ones', { colaborador_id: c.id, data: mes === mesAtual() ? hoje() : dataOneAOne(mes, c.one_a_one_dia) }), 'One a One criado');
              if (o) nav(`/one-a-one/${o.id}`);
            }}><Plus /> Criar One a One</button>
            <span className="row wrap">{semReuniao.map((c) => <Badge key={c.id} tom="outline">{c.nome}</Badge>)}</span>
          </div>
        </Card>
      )}
    </>
  );
}
