// Regras de negócio derivadas: atraso, follow-up, indicadores e alertas.
import {
  hoje, addDias, mesAtual, diffDias, tarefaAtrasada, jobAtrasado, cobrancaVencida, cobrarHoje,
  cobrancaAberta, JOB_FECHADO, DIAS_SEM_ATUALIZACAO, DIAS_PROXIMOS, PRIORIDADE_PESO, nomeMes,
} from '../shared/constantes.js';
import { plain, plainAll } from './db.js';

const semAtualizacao = (item, ref) => !!item.atualizado_em && diffDias(ref, item.atualizado_em.slice(0, 10)) >= DIAS_SEM_ATUALIZACAO;

export function decorarTarefa(t, ref = hoje()) {
  const atrasado = tarefaAtrasada(t, ref);
  return {
    ...t,
    atrasado,
    status_efetivo: atrasado ? 'Atrasado' : t.status,
    dias_atraso: atrasado && t.prazo ? diffDias(ref, t.prazo) : 0,
    sem_atualizacao: t.status !== 'Concluído' && semAtualizacao(t, ref),
  };
}

export function decorarJob(j, ref = hoje()) {
  const atrasado = jobAtrasado(j, ref);
  return {
    ...j,
    atrasado,
    dias_atraso: atrasado && j.prazo ? diffDias(ref, j.prazo) : 0,
    sem_atualizacao: !JOB_FECHADO.includes(j.status) && semAtualizacao(j, ref),
  };
}

export function decorarCobranca(c, ref = hoje()) {
  return {
    ...c,
    pessoa_nome: c.colaborador_nome || c.pessoa || '—',
    vencida: cobrancaVencida(c, ref),
    cobrar_hoje: cobrarHoje(c, ref),
    followup_atrasado: cobrancaAberta(c) && !!c.proximo_followup && c.proximo_followup < ref,
  };
}

// ---------- consultas base ----------

export const SQL_TAREFAS = `
  SELECT t.*, c.nome AS colaborador_nome, j.numero AS job_numero, j.titulo AS job_titulo,
    (SELECT COUNT(*) FROM tarefa_checklist k WHERE k.tarefa_id = t.id) AS checklist_total,
    (SELECT COUNT(*) FROM tarefa_checklist k WHERE k.tarefa_id = t.id AND k.feito = 1) AS checklist_feitos,
    (SELECT COUNT(*) FROM tarefa_anexos a WHERE a.tarefa_id = t.id) AS anexos_total
  FROM tarefas t
  LEFT JOIN colaboradores c ON c.id = t.colaborador_id
  LEFT JOIN jobs j ON j.id = t.job_id`;

export const SQL_JOBS = `
  SELECT j.*, c.nome AS colaborador_nome,
    (SELECT COUNT(*) FROM job_historico h WHERE h.job_id = j.id) AS historico_total,
    (SELECT h.texto FROM job_historico h WHERE h.job_id = j.id ORDER BY h.data DESC, h.id DESC LIMIT 1) AS ultimo_registro
  FROM jobs j LEFT JOIN colaboradores c ON c.id = j.colaborador_id`;

export const SQL_COBRANCAS = `
  SELECT b.*, c.nome AS colaborador_nome, j.numero AS job_numero, j.titulo AS job_titulo,
    (SELECT COUNT(*) FROM cobranca_contatos k WHERE k.cobranca_id = b.id) AS contatos_total
  FROM cobrancas b
  LEFT JOIN colaboradores c ON c.id = b.colaborador_id
  LEFT JOIN jobs j ON j.id = b.job_id`;

export const listarTarefas = (db, where = '', params = []) =>
  plainAll(db.prepare(`${SQL_TAREFAS} ${where}`).all(...params)).map((t) => decorarTarefa(t));
export const listarJobs = (db, where = '', params = []) =>
  plainAll(db.prepare(`${SQL_JOBS} ${where}`).all(...params)).map((j) => decorarJob(j));
export const listarCobrancas = (db, where = '', params = []) =>
  plainAll(db.prepare(`${SQL_COBRANCAS} ${where}`).all(...params)).map((c) => decorarCobranca(c));

const porPrazo = (a, b) =>
  (a.prazo || '9999').localeCompare(b.prazo || '9999') || (PRIORIDADE_PESO[a.prioridade] ?? 9) - (PRIORIDADE_PESO[b.prioridade] ?? 9);

// ---------- CPC ----------

export function cpcComAvaliacoes(db, where = '', params = []) {
  const itens = plainAll(db.prepare(`
    SELECT p.*, o.mes AS origem_mes, o.data AS origem_data, c.nome AS colaborador_nome
    FROM cpc p
    LEFT JOIN one_on_ones o ON o.id = p.one_on_one_id
    LEFT JOIN colaboradores c ON c.id = p.colaborador_id ${where}
    ORDER BY p.criado_em`).all(...params));
  if (!itens.length) return [];
  const ids = itens.map((i) => i.id);
  const avals = plainAll(db.prepare(`
    SELECT a.*, o.mes AS mes FROM cpc_avaliacoes a LEFT JOIN one_on_ones o ON o.id = a.one_on_one_id
    WHERE a.cpc_id IN (${ids.map(() => '?').join(',')}) ORDER BY a.data, a.id`).all(...ids));
  const mes = mesAtual();
  return itens.map((i) => {
    const avaliacoes = avals.filter((a) => a.cpc_id === i.id);
    const ultima = avaliacoes[avaliacoes.length - 1] || null;
    return {
      ...i,
      avaliacoes,
      ultima_avaliacao: ultima,
      pendente_avaliacao: i.status === 'Em acompanhamento' && !!i.proxima_avaliacao && i.proxima_avaliacao <= mes,
    };
  });
}

/** Semáforo de desenvolvimento do colaborador a partir dos CPCs ativos. */
export function semaforoCpc(cpcs) {
  const ativos = cpcs.filter((c) => c.status === 'Em acompanhamento');
  if (!ativos.length) return null;
  if (ativos.some((c) => c.ultima_avaliacao?.resultado === 'Não cumpriu')) return 'vermelho';
  if (ativos.some((c) => c.ultima_avaliacao?.resultado === 'Parcialmente cumpriu' || c.pendente_avaliacao)) return 'amarelo';
  return 'verde';
}

// ---------- visão da equipe ----------

export function visaoEquipe(db, ref = hoje()) {
  const colaboradores = plainAll(db.prepare(`SELECT * FROM colaboradores WHERE status != 'Desligado' ORDER BY COALESCE(daily_horario, '99:99'), nome`).all());
  const tarefas = listarTarefas(db, `WHERE t.colaborador_id IS NOT NULL AND t.status != 'Concluído'`);
  const jobs = listarJobs(db, `WHERE j.colaborador_id IS NOT NULL AND j.status NOT IN ('Concluído','Cancelado')`);
  const cobrancas = listarCobrancas(db, `WHERE b.colaborador_id IS NOT NULL AND b.status != 'Resolvido'`);
  const dailysHoje = plainAll(db.prepare(`SELECT * FROM dailys WHERE data = ?`).all(ref));
  const cpcs = cpcComAvaliacoes(db, `WHERE p.status = 'Em acompanhamento'`);
  const ooo = plainAll(db.prepare(`SELECT * FROM one_on_ones WHERE status = 'Agendado' ORDER BY data`).all());

  return colaboradores.map((c) => {
    const ts = tarefas.filter((t) => t.colaborador_id === c.id);
    const js = jobs.filter((j) => j.colaborador_id === c.id);
    const cs = cobrancas.filter((x) => x.colaborador_id === c.id);
    const daily = dailysHoje.find((d) => d.colaborador_id === c.id) || null;
    const meusCpc = cpcs.filter((p) => p.colaborador_id === c.id);
    const atrasados = ts.filter((t) => t.atrasado).length + js.filter((j) => j.atrasado).length;
    const recorrentes = ts.filter((t) => t.reagendamentos >= 2).length;
    const proximo = ooo.find((o) => o.colaborador_id === c.id) || null;
    const cpc = semaforoCpc(meusCpc);
    const atencao = atrasados * 3 + recorrentes * 2 + (daily?.bloqueios ? 2 : 0) + cs.length + (cpc === 'vermelho' ? 3 : cpc === 'amarelo' ? 1 : 0);
    return {
      ...c,
      daily_hoje: daily ? { id: daily.id, bloqueios: daily.bloqueios } : null,
      pendencias: ts.length,
      atrasados,
      recorrentes,
      jobs_abertos: js.length,
      cobrancas: cs.length,
      cpc,
      cpc_pendentes: meusCpc.filter((p) => p.pendente_avaliacao).length,
      proximo_one_a_one: proximo ? { id: proximo.id, data: proximo.data, mes: proximo.mes } : null,
      atencao,
    };
  });
}

// ---------- resumo do dia (Meu Dia + Painel) ----------

export function resumo(db, ref = hoje()) {
  const limiteProx = addDias(ref, DIAS_PROXIMOS);
  const tarefas = listarTarefas(db, `WHERE t.status != 'Concluído'`);
  const jobs = listarJobs(db, `WHERE j.status NOT IN ('Concluído','Cancelado')`);
  const cobrancas = listarCobrancas(db, `WHERE b.status != 'Resolvido'`);

  const minhas = tarefas.filter((t) => !t.colaborador_id);
  const daEquipe = tarefas.filter((t) => t.colaborador_id);

  const ehReuniao = (t) => t.categoria === 'Reunião' || !!t.hora;
  const minhasHoje = minhas.filter((t) => (t.atrasado || t.prazo === ref) && !(ehReuniao(t) && t.prazo === ref)).sort(porPrazo);
  const reunioesTarefas = minhas.filter((t) => t.prazo === ref && ehReuniao(t));
  const oooHoje = plainAll(db.prepare(`
    SELECT o.*, c.nome AS colaborador_nome FROM one_on_ones o JOIN colaboradores c ON c.id = o.colaborador_id
    WHERE o.status = 'Agendado' AND o.data = ?`).all(ref));
  const reunioes = [
    ...reunioesTarefas.map((t) => ({ tipo: 'tarefa', id: t.id, titulo: t.titulo, hora: t.hora, item: t })),
    ...oooHoje.map((o) => ({ tipo: 'one_a_one', id: o.id, titulo: `One a One — ${o.colaborador_nome}`, hora: o.hora })),
  ].sort((a, b) => (a.hora || '99').localeCompare(b.hora || '99'));

  const cobrar = cobrancas.filter((c) => c.cobrar_hoje).sort((a, b) => (a.proximo_followup || '').localeCompare(b.proximo_followup || ''));
  const jobsAtrasados = jobs.filter((j) => j.atrasado).sort((a, b) => b.dias_atraso - a.dias_atraso);
  const jobsHoje = jobs.filter((j) => j.prazo === ref);

  const equipe = visaoEquipe(db, ref);
  const ativos = equipe.filter((c) => c.status === 'Ativo');
  const dailys = ativos.map((c) => ({ id: c.id, nome: c.nome, cargo: c.cargo, horario: c.daily_horario, daily: c.daily_hoje }));

  const pendenciasEquipe = daEquipe.filter((t) => t.atrasado || t.prazo === ref).sort(porPrazo);

  const oooProximos = plainAll(db.prepare(`
    SELECT o.*, c.nome AS colaborador_nome FROM one_on_ones o JOIN colaboradores c ON c.id = o.colaborador_id
    WHERE o.status = 'Agendado' AND o.data <= ? AND c.status != 'Desligado' ORDER BY o.data`).all(limiteProx));

  const cpcPendentes = cpcComAvaliacoes(db, `WHERE p.status = 'Em acompanhamento'`).filter((p) => p.pendente_avaliacao);

  const semAtualizacao = [
    ...tarefas.filter((t) => t.sem_atualizacao && !t.atrasado).map((t) => ({ tipo: 'tarefa', ...t })),
    ...jobs.filter((j) => j.sem_atualizacao && !j.atrasado).map((j) => ({ tipo: 'job', ...j })),
  ];

  const concluidasHoje = listarTarefas(db, `WHERE t.status = 'Concluído' AND substr(t.concluido_em, 1, 10) = ?`, [ref]);

  const aguardando = [
    ...tarefas.filter((t) => t.status === 'Aguardando').map((t) => ({ tipo: 'tarefa', ...t })),
    ...jobs.filter((j) => j.status.startsWith('Aguardando')).map((j) => ({ tipo: 'job', ...j })),
    ...cobrancas.filter((c) => c.status === 'Aguardando').map((c) => ({ tipo: 'cobranca', ...c })),
  ];

  const proximos = [
    ...tarefas.filter((t) => t.prazo > ref && t.prazo <= limiteProx).map((t) => ({ tipo: 'tarefa', ...t })),
    ...jobs.filter((j) => j.prazo > ref && j.prazo <= limiteProx).map((j) => ({ tipo: 'job', ...j })),
  ].sort(porPrazo);

  const tarefasAtrasadas = tarefas.filter((t) => t.atrasado).sort((a, b) => b.dias_atraso - a.dias_atraso);
  const cobrancasVencidas = cobrancas.filter((c) => c.vencida);
  const followupsHoje = cobrancas.filter((c) => c.cobrar_hoje && !c.vencida);

  const kpis = {
    atrasados: tarefasAtrasadas.length + jobsAtrasados.length,
    hoje: tarefas.filter((t) => t.prazo === ref).length + jobsHoje.length,
    proximos: proximos.length,
    aguardando: aguardando.length,
    cobrar: cobrar.length,
  };

  // Atenção do gerente — ordem = gravidade
  const alertas = [];
  const push = (nivel, grupo, itens, mapa) => itens.forEach((i) => alertas.push({ nivel, grupo, ...mapa(i) }));
  push('vermelho', 'JOBs atrasados', jobsAtrasados, (j) => ({ titulo: `JOB ${j.numero} — ${j.titulo}`, sub: `${j.dias_atraso}d de atraso · ${j.colaborador_nome || 'sem responsável'}${j.cliente ? ` · ${j.cliente}` : ''}`, link: `/jobs/${j.id}` }));
  push('vermelho', 'Tarefas atrasadas', tarefasAtrasadas, (t) => ({ titulo: t.titulo, sub: `${t.dias_atraso}d de atraso · ${t.colaborador_nome || 'Minha'}`, link: `/agenda?tarefa=${t.id}` }));
  push('vermelho', 'Cobranças vencidas', cobrancasVencidas, (c) => ({ titulo: c.descricao, sub: `${c.pessoa_nome} · prazo ${c.prazo}`, link: `/cobrancas?id=${c.id}` }));
  push('laranja', 'Follow-ups para hoje', followupsHoje, (c) => ({ titulo: c.descricao, sub: `${c.pessoa_nome} · ${c.status}`, link: `/cobrancas?id=${c.id}` }));
  push('laranja', 'Pendências sem atualização', semAtualizacao, (i) => i.tipo === 'job'
    ? { titulo: `JOB ${i.numero} — ${i.titulo}`, sub: `parado desde ${i.atualizado_em.slice(0, 10)}`, link: `/jobs/${i.id}` }
    : { titulo: i.titulo, sub: `${i.colaborador_nome || 'Minha'} · parada desde ${i.atualizado_em.slice(0, 10)}`, link: `/agenda?tarefa=${i.id}` });
  push('amarelo', 'One a Ones próximos', oooProximos, (o) => ({ titulo: `One a One — ${o.colaborador_nome}`, sub: `${o.data < ref ? 'pendente desde' : 'em'} ${o.data} · ${nomeMes(o.mes)}`, link: `/one-a-one/${o.id}` }));
  push('amarelo', 'CPCs para avaliar', cpcPendentes, (p) => ({ titulo: `${p.colaborador_nome}: ${p.descricao}`, sub: `${p.tipo} · desde ${p.origem_mes ? nomeMes(p.origem_mes) : '—'}`, link: `/equipe/${p.colaborador_id}?aba=evolucao` }));
  push('verde', 'Concluídas hoje', concluidasHoje, (t) => ({ titulo: t.titulo, sub: t.colaborador_nome || 'Minha', link: `/agenda?tarefa=${t.id}` }));

  return {
    hoje: ref,
    kpis,
    minhasHoje,
    reunioes,
    cobrar,
    jobsAtrasados,
    jobsHoje,
    dailys,
    pendenciasEquipe,
    oooProximos,
    cpcPendentes,
    semAtualizacao,
    concluidasHoje,
    aguardando,
    proximos,
    equipe,
    alertas,
  };
}

export const linhaColaborador = (db, id) => plain(db.prepare('SELECT * FROM colaboradores WHERE id = ?').get(id));
