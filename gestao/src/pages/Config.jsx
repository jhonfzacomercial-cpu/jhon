import { useRef, useState } from 'react';
import { Download, Upload, Sparkles, Trash2, Keyboard, Lock, CalendarClock } from 'lucide-react';
import { useStore, useDados, useAcao } from '../lib/store.jsx';
import { api } from '../lib/api.js';
import { PageHead, Card } from '../components/ui.jsx';

export function Config() {
  const { meta, toast } = useStore();
  const acao = useAcao();
  const { dados: cfg } = useDados('/config', { inicial: {} });
  const [confirma, setConfirma] = useState('');
  const arquivo = useRef(null);
  const autoOoo = (cfg?.auto_one_a_one ?? '1') !== '0';

  const restaurar = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const json = JSON.parse(await file.text());
      await acao(() => api.post('/restaurar', json), 'Backup restaurado');
    } catch {
      toast('Arquivo inválido', 'erro');
    }
  };

  return (
    <>
      <PageHead eyebrow="Configurações" titulo="Sistema" />
      <div className="grid grid-2">
        <Card titulo="Automações" icone={CalendarClock} pad>
          <label className="row" style={{ cursor: 'pointer' }}>
            <input type="checkbox" className="check" checked={autoOoo} onChange={(e) => acao(() => api.put('/config', { auto_one_a_one: e.target.checked ? '1' : '0' }), 'Preferência salva')} />
            <span>Criar automaticamente o One a One mensal de cada colaborador ativo</span>
          </label>
          <p className="small muted">A data usa o “dia do One a One” do cadastro de cada colaborador (fins de semana são ajustados). Tarefas e JOBs vencidos viram atrasados automaticamente e ficam registrados no histórico.</p>
        </Card>

        <Card titulo="Backup" icone={Download} pad>
          <p className="small muted" style={{ marginTop: 0 }}>Os dados ficam no arquivo <span className="mono">data/gestao.db</span> do servidor. Baixe um backup periodicamente.</p>
          <div className="row wrap">
            <a className="btn primary" href="/api/backup" download><Download /> Baixar backup (.json)</a>
            <button className="btn" onClick={() => arquivo.current.click()}><Upload /> Restaurar backup</button>
            <input type="file" accept="application/json" hidden ref={arquivo} onChange={restaurar} />
          </div>
          <p className="tiny muted">Restaurar substitui todos os dados atuais pelos do arquivo. Anexos de tarefas ficam em <span className="mono">data/uploads</span>.</p>
        </Card>

        <Card titulo="Atalhos de teclado" icone={Keyboard} pad>
          <div className="stack tight small">
            {[['Ctrl K ou /', 'Busca global'], ['T', 'Nova tarefa'], ['C', 'Nova cobrança'], ['J', 'Novo JOB'], ['D', 'Abrir Daily'], ['Esc', 'Fechar janela']].map(([k, d]) => (
              <div key={k} className="row between"><span>{d}</span><kbd>{k}</kbd></div>
            ))}
          </div>
        </Card>

        <Card titulo="Acesso" icone={Lock} pad>
          <p className="small" style={{ marginTop: 0 }}>{meta.protegido ? '🔒 O sistema está protegido por senha.' : '🔓 Sem senha. Para proteger o acesso, inicie o servidor com a variável APP_PASSWORD.'}</p>
          <p className="tiny muted mono">APP_PASSWORD=minhasenha npm start</p>
        </Card>

        <Card titulo="Dados de exemplo" icone={Sparkles} pad>
          <p className="small muted" style={{ marginTop: 0 }}>Carrega uma equipe fictícia (Ana, Gabriel, Alex, Cristhopher) com JOBs, Dailys, cobranças e One a Ones. <b>Substitui os dados atuais.</b></p>
          <button className="btn" onClick={() => acao(() => api.post('/demo'), 'Dados de exemplo carregados')}><Sparkles /> Carregar exemplo</button>
        </Card>

        <Card titulo="Zerar sistema" icone={Trash2} pad>
          <p className="small muted" style={{ marginTop: 0 }}>Apaga todos os registros. Digite <b>APAGAR</b> para confirmar.</p>
          <div className="row">
            <input className="input" value={confirma} onChange={(e) => setConfirma(e.target.value)} placeholder="APAGAR" style={{ maxWidth: 160 }} />
            <button className="btn danger" disabled={confirma !== 'APAGAR'} onClick={async () => { if (await acao(() => api.post('/zerar', { confirmacao: 'APAGAR' }), 'Sistema zerado')) setConfirma(''); }}><Trash2 /> Apagar tudo</button>
          </div>
        </Card>
      </div>
    </>
  );
}
