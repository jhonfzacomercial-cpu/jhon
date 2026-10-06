process.env.TZ ||= 'America/Sao_Paulo';
const { openDb } = await import('./db.js');
const { carregarDemo } = await import('./seed.js');
carregarDemo(openDb());
console.log('Dados de exemplo carregados.');
