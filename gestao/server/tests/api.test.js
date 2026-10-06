process.env.TZ ||= 'America/Sao_Paulo';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.js';
import { criarApp } from '../app.js';
import { hoje, addDias, mesAtual, addMeses } from '../../shared/constantes.js';

let server, base;
const api = async (metodo, url, body) => {
  const r = await fetch(base + url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const json = await r.json();
  if (!r.ok) throw new Error(`${metodo} ${url} → ${r.status}: ${json.erro}`);
  return json;
};

before(async () => {
  const app = criarApp(openDb(':memory:'), { senha: '' });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

test('dados de exemplo alimentam o resumo do dia', async () => {
  await api('POST', '/demo');
  const r = await api('GET', '/resumo');
  assert.equal(r.hoje, hoje());
  assert.ok(r.kpis.atrasados > 0, 'deve haver atrasados');
  assert.ok(r.kpis.cobrar >= 2, 'deve haver cobranças para hoje');
  assert.ok(r.jobsAtrasados.some((j) => j.numero === '041'));
  assert.equal(r.dailys.length, 4);
  assert.ok(r.dailys.find((d) => d.nome === 'Ana').daily, 'Ana já tem Daily hoje');
  assert.ok(r.reunioes.length >= 2);
  assert.ok(r.cpcPendentes.length >= 3, 'CPCs do mês passado aguardam avaliação');
  assert.ok(r.alertas.some((a) => a.grupo === 'JOBs atrasados'));
  const alex = r.equipe.find((c) => c.nome === 'Alex');
  assert.equal(alex.cpc, 'vermelho');
  // One a Ones do mês gerados automaticamente
  const ooo = await api('GET', `/one-a-ones?mes=${mesAtual()}`);
  assert.equal(ooo.length, 4);
});

test('tarefa vencida é marcada como atrasada', async () => {
  const t = await api('POST', '/tarefas', { titulo: 'Teste atraso', prazo: addDias(hoje(), -1) });
  assert.equal(t.status_efetivo, 'Atrasado');
  const ok = await api('PUT', `/tarefas/${t.id}`, { status: 'Concluído' });
  assert.equal(ok.atrasado, false);
  assert.ok(ok.concluido_em);
});

test('daily cria tarefas, reagenda pendências e registra histórico', async () => {
  const { id: gabriel } = (await api('GET', '/colaboradores')).find((c) => c.nome === 'Gabriel');
  const form = await api('GET', `/dailys/form?colaborador_id=${gabriel}&data=${hoje()}`);
  assert.equal(form.daily, null);
  assert.ok(form.pendencias.length >= 1, 'pendência da Daily de ontem aparece');
  const pend = form.pendencias[0];
  await api('POST', '/dailys', {
    colaborador_id: gabriel, data: hoje(), bloqueios: 'Sem acesso ao drive',
    itens: [{ titulo: 'Tarefa A' }, { titulo: 'Tarefa B' }],
    pendencias: [{ id: pend.id, acao: 'hoje' }],
  });
  const depois = await api('GET', `/dailys/form?colaborador_id=${gabriel}&data=${hoje()}`);
  assert.equal(depois.itens.length, 2);
  assert.equal(depois.daily.bloqueios, 'Sem acesso ao drive');
  const reag = (await api('GET', `/tarefas/${pend.id}`));
  assert.equal(reag.prazo, hoje());
  assert.equal(reag.reagendamentos, 1);
  // removendo um item na edição
  await api('POST', '/dailys', { colaborador_id: gabriel, data: hoje(), itens: [{ id: depois.itens[0].id, titulo: 'Tarefa A', status: 'Concluído' }] });
  const final = await api('GET', `/dailys/form?colaborador_id=${gabriel}&data=${hoje()}`);
  assert.equal(final.itens.length, 1);
  assert.equal(final.itens[0].status, 'Concluído');
  const perfil = await api('GET', `/colaboradores/${gabriel}/perfil`);
  assert.ok(perfil.dailys[0].eh_hoje);
});

test('cobrança: contato registra follow-up e anota no JOB', async () => {
  const c = await api('POST', '/cobrancas', { descricao: 'Cobrar arte', pessoa: 'ana', proximo_followup: hoje() });
  assert.ok(c.colaborador_id, 'nome digitado vincula ao colaborador');
  assert.equal(c.cobrar_hoje, true);
  const job = (await api('GET', '/jobs')).find((j) => j.numero === '041');
  await api('PUT', `/cobrancas/${c.id}`, { job_id: job.id });
  const depois = await api('POST', `/cobrancas/${c.id}/contato`, { texto: 'Falei com ela', status: 'Aguardando', proximo_followup: addDias(hoje(), 2) });
  assert.equal(depois.status, 'Aguardando');
  assert.equal(depois.ultimo_contato, hoje());
  assert.equal(depois.cobrar_hoje, false);
  const j = await api('GET', `/jobs/${job.id}`);
  assert.ok(j.historico.some((h) => h.texto.includes('Falei com ela')));
});

test('One a One: avalia CPC anterior, cria CPC novo, finaliza e agenda o próximo', async () => {
  const ana = (await api('GET', '/colaboradores')).find((c) => c.nome === 'Ana');
  const lista = await api('GET', `/one-a-ones?mes=${mesAtual()}`);
  const o = lista.find((x) => x.colaborador_id === ana.id);
  const det = await api('GET', `/one-a-ones/${o.id}`);
  assert.equal(det.paraAvaliar.length, 3);
  const [p1, p2, p3] = det.paraAvaliar;
  await api('POST', '/cpc', { colaborador_id: ana.id, one_on_one_id: o.id, tipo: 'Começar', descricao: 'Liderar reunião de pauta' });
  await api('PUT', `/one-a-ones/${o.id}`, {
    pontos_positivos: 'Evoluiu', compromissos_gestor: '- Revisar metas\n- Dar feedback semanal', compromissos_colaborador: 'Enviar relatório semanal',
    respostas: { sentimento: 'Bem', gestor: 'Mais clareza' },
    avaliacoes: { [p1.id]: { resultado: 'Cumpriu', observacao: 'Ok', encerrar: true }, [p2.id]: { resultado: 'Parcialmente cumpriu' }, [p3.id]: { resultado: 'Cumpriu', observacao: 'Trouxe soluções' } },
  });
  const fin = await api('POST', `/one-a-ones/${o.id}/finalizar`, {});
  assert.equal(fin.status, 'Finalizado');
  const cpcs = await api('GET', `/cpc?colaborador_id=${ana.id}`);
  assert.equal(cpcs.find((p) => p.id === p1.id).status, 'Concluído');
  assert.equal(cpcs.find((p) => p.id === p2.id).proxima_avaliacao, addMeses(mesAtual(), 1));
  assert.equal(cpcs.find((p) => p.descricao === 'Liderar reunião de pauta').proxima_avaliacao, addMeses(mesAtual(), 1));
  const proximos = await api('GET', `/one-a-ones?colaborador_id=${ana.id}`);
  assert.ok(proximos.some((x) => x.mes === addMeses(mesAtual(), 1)), 'próximo One a One agendado');
  const tarefas = await api('GET', '/tarefas');
  assert.ok(tarefas.some((t) => t.titulo === 'Revisar metas' && !t.colaborador_id));
  assert.ok(tarefas.some((t) => t.titulo === 'Enviar relatório semanal' && t.colaborador_id === ana.id));
  const perfil = await api('GET', `/colaboradores/${ana.id}/perfil`);
  assert.ok(perfil.feedbacks.some((f) => f.resposta === 'Mais clareza'));
});

test('busca global encontra JOB pelo número e pessoa pelo nome', async () => {
  const r = await api('GET', '/busca?q=JOB%20041');
  const jobs = r.grupos.find((g) => g.tipo === 'jobs');
  assert.ok(jobs.itens.some((j) => j.numero === '041'));
  assert.ok(r.grupos.find((g) => g.tipo === 'cobrancas'), 'cobranças ligadas ao JOB');
  const a = await api('GET', '/busca?q=ana');
  assert.ok(a.grupos.find((g) => g.tipo === 'colaboradores'));
  assert.ok(a.grupos.find((g) => g.tipo === 'cpc'));
  assert.ok(a.grupos.find((g) => g.tipo === 'feedbacks'));
});

test('backup e restauração preservam os dados', async () => {
  const dump = await api('GET', '/backup');
  const n = dump.tabelas.tarefas.length;
  await api('POST', '/zerar', { confirmacao: 'APAGAR' });
  assert.equal((await api('GET', '/tarefas')).length, 0);
  await api('POST', '/restaurar', dump);
  assert.equal((await api('GET', '/tarefas')).length, n);
});
