import { useNavigate } from 'react-router-dom';
import { Plus, Users, UserX } from 'lucide-react';
import { useStore, useDados } from '../lib/store.jsx';
import * as f from '../lib/formato.js';
import { PageHead, Card, Avatar, Status, Semaforo, Vazio } from '../components/ui.jsx';
import { TabelaEquipe } from './Painel.jsx';

export function Equipe() {
  const { abrir, colaboradores } = useStore();
  const nav = useNavigate();
  const { dados: equipe } = useDados('/equipe', { inicial: [] });
  const desligados = colaboradores.filter((c) => c.status === 'Desligado');
  const lista = equipe || [];
  return (
    <>
      <PageHead eyebrow="Equipe" titulo="Quem precisa da minha atenção?" sub="Ordenado por necessidade de atenção: atrasos, pendências recorrentes, bloqueios, cobranças e CPC.">
        <button className="btn primary" onClick={() => abrir('colaborador')}><Plus /> Novo colaborador</button>
      </PageHead>

      <Card titulo="Visão gerencial da equipe" icone={Users}>
        <TabelaEquipe equipe={lista} />
      </Card>

      <div className="grid grid-3" style={{ marginTop: 16 }}>
        {lista.map((c) => (
          <button key={c.id} className="card card-pad" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => nav(`/equipe/${c.id}`)}>
            <div className="row">
              <Avatar nome={c.nome} />
              <div className="grow"><div className="strong">{c.nome}</div><div className="small muted">{c.cargo}{c.area ? ` · ${c.area}` : ''}</div></div>
              <Semaforo cor={c.cpc} />
            </div>
            <div className="row wrap small" style={{ marginTop: 12, gap: 14 }}>
              <span><b>{c.pendencias}</b> <span className="muted">pendências</span></span>
              <span style={{ color: c.atrasados ? 'var(--red)' : undefined }}><b>{c.atrasados}</b> <span className="muted">atrasados</span></span>
              <span><b>{c.cobrancas}</b> <span className="muted">cobranças</span></span>
            </div>
            <div className="row wrap" style={{ marginTop: 10 }}>
              <Status s={c.status} />
              {c.daily_hoje ? <span className="badge green">Daily ✓</span> : c.status === 'Ativo' && <span className="badge outline">sem Daily hoje</span>}
              {c.proximo_one_a_one && <span className="badge purple">1:1 {f.data(c.proximo_one_a_one.data)}</span>}
            </div>
          </button>
        ))}
        {!lista.length && <Card><Vazio big>Cadastre o primeiro colaborador.</Vazio></Card>}
      </div>

      {desligados.length > 0 && (
        <Card titulo="Desligados" icone={UserX} className="mt" pad>
          <div className="row wrap">{desligados.map((c) => <button key={c.id} className="chip" onClick={() => nav(`/equipe/${c.id}`)}>{c.nome}</button>)}</div>
        </Card>
      )}
    </>
  );
}
