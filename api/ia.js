// POST /api/ia {prompt} -> chama o ChatGPT (OpenAI) com a chave guardada no servidor.
const { protegido, responderErro } = require('./_lib');
const SISTEMA = 'Você é o estrategista editorial sênior do Grupo FZA. Responda sempre e somente com um único objeto JSON válido, sem texto fora dele.';

module.exports = protegido(async (req, res) => {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return responderErro(res, 405, 'metodo', 'Método não permitido.'); }
  const chave = process.env.OPENAI_API_KEY;
  if (!chave) return responderErro(res, 503, 'sem_chave', 'A variável OPENAI_API_KEY não foi configurada no Vercel.');
  const prompt = String((req.body && req.body.prompt) || '');
  if (!prompt || prompt.length > 250000) return responderErro(res, 400, 'pedido_invalido', 'Pedido vazio ou grande demais.');
  const modelo = process.env.OPENAI_MODEL || 'gpt-5.5';
  let r;
  try {
    r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + chave },
      body: JSON.stringify({ model: modelo, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: SISTEMA }, { role: 'user', content: prompt }] })
    });
  } catch { return responderErro(res, 502, 'network', 'Não foi possível falar com a OpenAI.'); }
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const ec = (j && j.error && j.error.code) || '';
    const codigo = r.status === 401 ? 'chave_invalida' : ec === 'insufficient_quota' ? 'sem_credito' : (r.status === 404 || ec === 'model_not_found') ? 'modelo_invalido' : r.status === 429 ? 'rate_limited' : 'upstream_error';
    return responderErro(res, 502, codigo, (j && j.error && j.error.message) || ('OpenAI respondeu HTTP ' + r.status));
  }
  const conteudo = (j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  if (!conteudo.trim()) return responderErro(res, 502, 'empty_completion', 'A OpenAI não devolveu conteúdo.');
  res.json({ conteudo, modelo });
});
