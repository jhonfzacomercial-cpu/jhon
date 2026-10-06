// Cliente da API. Na versão hospedada no claude.ai (VITE_LOCAL) a API roda no próprio navegador.
let aoNaoAutenticado = () => {};
export const definirAoNaoAutenticado = (fn) => { aoNaoAutenticado = fn; };

export const LOCAL = !!import.meta.env.VITE_LOCAL;
const local = LOCAL ? import('./local/servidor.js') : null;

async function req(metodo, url, body) {
  if (LOCAL) return (await local).chamar(metodo, `/api${url}`, body);
  const r = await fetch(`/api${url}`, {
    method: metodo,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let dados = null;
  try { dados = await r.json(); } catch { /* sem corpo */ }
  if (r.status === 401 && dados?.login) aoNaoAutenticado();
  if (!r.ok) throw new Error(dados?.erro || `Erro ${r.status}`);
  return dados;
}

export const api = {
  get: (url) => req('GET', url),
  post: (url, body = {}) => req('POST', url, body),
  put: (url, body = {}) => req('PUT', url, body),
  del: (url) => req('DELETE', url),
};

export const arquivoParaBase64 = (file) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(String(fr.result).split(',')[1]);
  fr.onerror = reject;
  fr.readAsDataURL(file);
});

/** Anexa um arquivo a uma tarefa. */
export async function anexar(tarefaId, file) {
  if (LOCAL) {
    const { assets } = await (await local).servicos();
    if (!assets) throw new Error('Anexos indisponíveis nesta visualização');
    const a = await assets.upload(file);
    return api.post(`/tarefas/${tarefaId}/anexos`, { nome: file.name, tipo: file.type, tamanho: file.size, arquivo: a.id });
  }
  return api.post(`/tarefas/${tarefaId}/anexos`, { nome: file.name, tipo: file.type, base64: await arquivoParaBase64(file) });
}

export async function removerAnexo(a) {
  const r = await api.del(`/anexos/${a.id}`);
  if (LOCAL) (await (await local).servicos()).assets?.delete(a.arquivo).catch(() => {});
  return r;
}

export const urlAnexo = (a) => (LOCAL ? `/_blob/${a.arquivo}` : `/api/anexos/${a.id}`);

/** Baixa o backup completo em JSON. */
export async function baixarBackup() {
  if (!LOCAL) { window.location.href = '/api/backup'; return; }
  const dados = await api.get('/backup');
  const { downloads } = await (await local).servicos();
  if (!downloads) throw new Error('Download indisponível nesta visualização');
  await downloads.save({ filename: `fza-gestao-backup-${dados.gerado_em.slice(0, 10)}.json`, data: JSON.stringify(dados) });
}

/** Na versão hospedada: relê os dados (outro aparelho pode ter alterado). */
export async function sincronizar() {
  if (LOCAL) await (await local).recarregar();
}
export const salvandoNaNuvem = async () => (LOCAL ? (await local).persistente() : true);
export const apenasLeitura = async () => (LOCAL ? (await local).somenteLeitura() : false);
