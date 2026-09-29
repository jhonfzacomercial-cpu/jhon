// GET /api/status -> confirma a senha e mostra o que está configurado no servidor.
const { protegido, redisCfg } = require('./_lib');
module.exports = protegido(async (req, res) => {
  res.json({ ok: true, ia: !!process.env.OPENAI_API_KEY, modelo: process.env.OPENAI_MODEL || 'gpt-5.5', banco: !!redisCfg() });
});
