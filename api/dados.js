// GET  /api/dados            -> todos os clientes, planejamentos e conteúdos
// GET  /api/dados?so=versao  -> só o número da versão (para sincronizar a equipe)
// POST /api/dados {ops:[{op:'set'|'del', coll, id, doc}]} -> grava ou apaga documentos
const { PREFIXO, COLS, redis, protegido, responderErro } = require('./_lib');
const ID = /^[A-Za-z0-9_\-.:]{1,120}$/;

module.exports = protegido(async (req, res) => {
  if (req.method === 'GET') {
    if (req.query && req.query.so === 'versao') {
      const [v] = await redis([['GET', PREFIXO + 'versao']]);
      return res.json({ versao: Number(v || 0) });
    }
    const out = await redis([['GET', PREFIXO + 'versao'], ...COLS.map(c => ['HGETALL', PREFIXO + c])]);
    const r = { versao: Number(out[0] || 0) };
    COLS.forEach((c, i) => {
      const a = out[i + 1] || [];
      const lista = [];
      for (let k = 0; k < a.length; k += 2) { try { lista.push({ ...JSON.parse(a[k + 1]), id: a[k] }); } catch { /* ignora registro corrompido */ } }
      r[c] = lista;
    });
    return res.json(r);
  }
  if (req.method === 'POST') {
    const ops = req.body && Array.isArray(req.body.ops) ? req.body.ops : null;
    if (!ops || !ops.length || ops.length > 200) return responderErro(res, 400, 'pedido_invalido', 'Lista de operações inválida.');
    const cmds = [];
    for (const o of ops) {
      if (!o || !COLS.includes(o.coll) || !ID.test(String(o.id))) return responderErro(res, 400, 'pedido_invalido', 'Coleção ou identificador inválido.');
      if (o.op === 'set') {
        if (!o.doc || typeof o.doc !== 'object' || Array.isArray(o.doc)) return responderErro(res, 400, 'pedido_invalido', 'Documento inválido.');
        const d = { ...o.doc }; delete d.id;
        const s = JSON.stringify(d);
        if (s.length > 300000) return responderErro(res, 413, 'grande_demais', 'Documento grande demais.');
        cmds.push(['HSET', PREFIXO + o.coll, String(o.id), s]);
      } else if (o.op === 'del') {
        cmds.push(['HDEL', PREFIXO + o.coll, String(o.id)]);
      } else return responderErro(res, 400, 'pedido_invalido', 'Operação desconhecida.');
    }
    cmds.push(['INCR', PREFIXO + 'versao']);
    const r = await redis(cmds);
    return res.json({ ok: true, versao: Number(r[r.length - 1]) });
  }
  res.setHeader('Allow', 'GET, POST');
  responderErro(res, 405, 'metodo', 'Método não permitido.');
});
