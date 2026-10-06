// Cliente HTTP mínimo da API.
let aoNaoAutenticado = () => {};
export const definirAoNaoAutenticado = (fn) => { aoNaoAutenticado = fn; };

async function req(metodo, url, body) {
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
