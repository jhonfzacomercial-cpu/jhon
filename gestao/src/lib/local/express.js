// Express mínimo para rodar as rotas do servidor dentro do navegador.
function Router() {
  const rotas = [];
  const r = { rotas };
  for (const m of ['get', 'post', 'put', 'delete']) {
    r[m] = (caminho, ...fns) => rotas.push({ metodo: m.toUpperCase(), caminho, fn: fns[fns.length - 1] });
  }
  r.use = (a, b) => {
    if (typeof a === 'string') rotas.push({ metodo: 'USE', caminho: a, fn: b });
    else if (a) rotas.push({ metodo: 'MW', fn: a });
  };
  r.listen = () => {};
  return r;
}

const casar = (padrao, caminho) => {
  const p = padrao.split('/');
  const c = caminho.split('/');
  if (p.length !== c.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(c[i]);
    else if (p[i] !== c[i]) return null;
  }
  return params;
};

function novaResposta() {
  return {
    statusCode: 200, body: undefined, headersSent: false,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; this.headersSent = true; return this; },
    setHeader() {}, type() {},
    sendFile() { this.status(404).json({ erro: 'Indisponível nesta versão' }); },
  };
}

function despachar(router, req, res, caminho) {
  for (const r of router.rotas) {
    if (res.headersSent) return true;
    if (r.metodo === 'MW') continue;
    if (r.metodo === 'USE') {
      if (caminho !== r.caminho && !caminho.startsWith(`${r.caminho}/`)) continue;
      if (r.fn?.rotas) { if (despachar(r.fn, req, res, caminho.slice(r.caminho.length) || '/')) return true; continue; }
      r.fn(req, res, () => {});
      return true;
    }
    if (r.metodo !== req.method) continue;
    const params = casar(r.caminho, caminho);
    if (!params) continue;
    req.params = params;
    r.fn(req, res, () => {});
    return true;
  }
  return false;
}

/** Executa uma requisição contra o app e devolve { status, body }. */
export function requisitar(app, metodo, url, body) {
  const u = new URL(url, 'http://local');
  const req = { method: metodo, query: Object.fromEntries(u.searchParams), body: body || {}, headers: {}, params: {} };
  const res = novaResposta();
  if (!despachar(app, req, res, u.pathname)) res.status(404).json({ erro: 'Rota não encontrada' });
  return { status: res.statusCode, body: res.body };
}

function express() { return Router(); }
express.Router = Router;
express.json = () => null;
express.static = () => null;
export default express;
