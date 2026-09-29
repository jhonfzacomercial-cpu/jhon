// Funções compartilhadas do servidor (arquivos com "_" não viram rotas no Vercel).
const PREFIXO = 'cef:';
const COLS = ['clientes', 'planos', 'conteudos'];

function falha(status, codigo, mensagem) { return Object.assign(new Error(mensagem), { status, codigo }); }

function redisCfg() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

// Executa comandos no Upstash Redis pela API REST (pipeline).
async function redis(cmds) {
  const c = redisCfg();
  if (!c) throw falha(503, 'sem_banco', 'O banco de dados (Upstash Redis) ainda não foi conectado ao projeto no Vercel.');
  let r;
  try {
    r = await fetch(c.url + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds) });
  } catch { throw falha(502, 'erro_banco', 'Não foi possível falar com o banco de dados.'); }
  const j = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(j)) throw falha(502, 'erro_banco', 'O banco de dados recusou a operação.');
  return j.map(x => { if (x && x.error) throw falha(502, 'erro_banco', String(x.error)); return x ? x.result : null; });
}

function verificarSenha(req) {
  const s = process.env.SENHA_EQUIPE;
  if (!s) return 'sem_senha_config';
  const got = String(req.headers['x-senha-equipe'] || '');
  if (got.length !== s.length) return 'senha_invalida';
  let d = 0;
  for (let i = 0; i < s.length; i++) d |= s.charCodeAt(i) ^ got.charCodeAt(i);
  return d ? 'senha_invalida' : null;
}

function responderErro(res, status, codigo, mensagem) { res.status(status).json({ erro: codigo, mensagem }); }

// Envolve cada rota: exige a senha da equipe e padroniza os erros.
function protegido(fn) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const a = verificarSenha(req);
    if (a === 'sem_senha_config') return responderErro(res, 503, a, 'A variável SENHA_EQUIPE não foi configurada no Vercel.');
    if (a) return responderErro(res, 401, a, 'Senha da equipe incorreta.');
    try { await fn(req, res); }
    catch (e) { responderErro(res, e.status || 500, e.codigo || 'erro_interno', e.message || 'Erro interno.'); }
  };
}

module.exports = { PREFIXO, COLS, redis, redisCfg, protegido, responderErro, falha };
