import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, sincronizar, salvandoNaNuvem, apenasLeitura, LOCAL } from './api.js';

const Ctx = createContext(null);
export const useStore = () => useContext(Ctx);

/**
 * Estado global enxuto: metadados, colaboradores, "versão" dos dados (qualquer mutação
 * incrementa e as telas recarregam), toasts e os modais de cadastro rápido.
 */
export function StoreProvider({ children, meta }) {
  const [versao, setVersao] = useState(0);
  const [colaboradores, setColaboradores] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [modal, setModal] = useState(null);
  const [painel, setPainel] = useState(null);
  const seq = useRef(0);

  const mudou = useCallback(() => setVersao((v) => v + 1), []);
  const toast = useCallback((texto, tipo = 'ok') => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, texto, tipo }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);
  const erro = useCallback((e) => toast(e?.message || String(e), 'erro'), [toast]);

  useEffect(() => {
    api.get('/colaboradores').then(setColaboradores).catch(() => {});
  }, [versao]);

  // Versão hospedada: ao voltar para a aba, relê os dados (podem ter mudado em outro aparelho)
  const [semNuvem, setSemNuvem] = useState(false);
  const [leitura, setLeitura] = useState(false);
  useEffect(() => {
    if (LOCAL) apenasLeitura().then(setLeitura);
  }, [versao]);
  useEffect(() => {
    if (!LOCAL) return undefined;
    salvandoNaNuvem().then((ok) => setSemNuvem(!ok));
    let escondidoEm = 0;
    const vis = () => {
      if (document.hidden) { escondidoEm = Date.now(); return; }
      if (escondidoEm && Date.now() - escondidoEm > 20000) sincronizar().then(mudou).catch(() => {});
    };
    document.addEventListener('visibilitychange', vis);
    return () => document.removeEventListener('visibilitychange', vis);
  }, [mudou]);

  const valor = {
    meta, versao, mudou, semNuvem, leitura, toast, erro, colaboradores,
    ativos: colaboradores.filter((c) => c.status !== 'Desligado'),
    nomeColab: (id) => colaboradores.find((c) => c.id === id)?.nome,
    // modais globais: { tipo: 'tarefa'|'cobranca'|'job'|'colaborador', dados }
    abrir: (tipo, dados = {}) => setModal({ tipo, dados }),
    fechar: () => setModal(null),
    modal,
    // painéis laterais de detalhe: { tipo: 'tarefa'|'cobranca', id }
    detalhe: (tipo, id) => setPainel({ tipo, id }),
    fecharDetalhe: () => setPainel(null),
    painel,
    toasts,
  };
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

/** Busca dados e recarrega sempre que algo mudar no sistema. */
export function useDados(url, { inicial = null } = {}) {
  const { versao, erro } = useStore();
  const [dados, setDados] = useState(inicial);
  const [carregando, setCarregando] = useState(true);
  const [local, setLocal] = useState(0);
  useEffect(() => {
    if (!url) return undefined;
    let vivo = true;
    setCarregando(true);
    api.get(url)
      .then((d) => { if (vivo) setDados(d); })
      .catch((e) => { if (vivo) erro(e); })
      .finally(() => { if (vivo) setCarregando(false); });
    return () => { vivo = false; };
  }, [url, versao, local, erro]);
  return { dados, carregando, recarregar: () => setLocal((n) => n + 1), setDados };
}

/** Executa uma mutação com toast e recarga global. Retorna null se falhar. */
export function useAcao() {
  const { mudou, toast, erro } = useStore();
  return useCallback(async (fn, msg) => {
    try {
      const r = await fn();
      mudou();
      if (msg) toast(msg);
      return r;
    } catch (e) {
      erro(e);
      return null;
    }
  }, [mudou, toast, erro]);
}
