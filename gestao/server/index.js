process.env.TZ ||= 'America/Sao_Paulo';

const { default: express } = await import('express');
const path = await import('node:path');
const fs = await import('node:fs');
const { openDb } = await import('./db.js');
const { criarApp } = await import('./app.js');
const { executarAutomacoes } = await import('./automacoes.js');

const db = openDb();
const app = criarApp(db);

// Em produção, a própria API serve a interface compilada (dist/)
const dist = path.resolve(process.cwd(), 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

executarAutomacoes(db);
setInterval(() => executarAutomacoes(db), 60 * 60 * 1000).unref();

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  console.log(`FZA Gestão rodando em http://localhost:${port}${fs.existsSync(dist) ? '' : ' (somente API — rode "npm run build" para servir a interface)'}`);
  if (process.env.APP_PASSWORD) console.log('Acesso protegido por senha (APP_PASSWORD).');
});
