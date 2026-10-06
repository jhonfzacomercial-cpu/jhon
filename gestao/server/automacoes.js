// Automações: rodam ao abrir o painel, na inicialização e a cada hora.
import { plainAll } from './db.js';
import { hoje, agora, mesAtual, nomeMes, dataOneAOne, diasNoMes } from '../shared/constantes.js';

const log = (db, tipo, descricao, entidade, entidade_id, colaborador_id) =>
  db.prepare('INSERT INTO historico (tipo, entidade, entidade_id, colaborador_id, descricao, data_hora) VALUES (?,?,?,?,?,?)')
    .run(tipo, entidade, entidade_id, colaborador_id ?? null, descricao, agora());

/** Cria o One a One do mês para cada colaborador ativo que ainda não tem. Retorna quantos criou. */
export function gerarOneAOnes(db, mes = mesAtual()) {
  const fimDoMes = `${mes}-${String(diasNoMes(mes)).padStart(2, '0')}`;
  const pendentes = plainAll(db.prepare(`
    SELECT c.* FROM colaboradores c
    WHERE c.status = 'Ativo' AND (c.data_entrada IS NULL OR c.data_entrada <= ?)
      AND NOT EXISTS (SELECT 1 FROM one_on_ones o WHERE o.colaborador_id = c.id AND o.mes = ?)`).all(fimDoMes, mes));
  for (const c of pendentes) {
    const data = dataOneAOne(mes, c.one_a_one_dia);
    const r = db.prepare('INSERT INTO one_on_ones (colaborador_id, mes, data, criado_em, atualizado_em) VALUES (?,?,?,?,?)').run(c.id, mes, data, agora(), agora());
    log(db, 'one_a_one_agendado', `One a One de ${nomeMes(mes)} agendado automaticamente com ${c.nome} (${data})`, 'one_a_one', Number(r.lastInsertRowid), c.id);
  }
  return pendentes.length;
}

export function executarAutomacoes(db) {
  const ref = hoje();

  // Tarefas que passaram do prazo → registra o atraso uma única vez
  const tarefas = plainAll(db.prepare(`SELECT t.id, t.titulo, t.colaborador_id, t.prazo, c.nome FROM tarefas t LEFT JOIN colaboradores c ON c.id = t.colaborador_id
    WHERE t.status != 'Concluído' AND t.prazo IS NOT NULL AND t.prazo < ? AND t.atraso_registrado = 0`).all(ref));
  for (const t of tarefas) {
    db.prepare('UPDATE tarefas SET atraso_registrado = 1 WHERE id = ?').run(t.id);
    log(db, 'tarefa_atrasada', `Tarefa atrasada${t.nome ? ` (${t.nome})` : ''}: ${t.titulo} — prazo ${t.prazo}`, 'tarefa', t.id, t.colaborador_id);
  }

  // JOBs que passaram do prazo
  const jobs = plainAll(db.prepare(`SELECT id, numero, titulo, colaborador_id, prazo FROM jobs
    WHERE status NOT IN ('Concluído','Cancelado') AND prazo IS NOT NULL AND prazo < ? AND atraso_registrado = 0`).all(ref));
  for (const j of jobs) {
    db.prepare('UPDATE jobs SET atraso_registrado = 1 WHERE id = ?').run(j.id);
    db.prepare('INSERT INTO job_historico (job_id, data, texto, criado_em) VALUES (?,?,?,?)').run(j.id, ref, `JOB entrou em atraso (prazo ${j.prazo})`, agora());
    log(db, 'job_atrasado', `JOB ${j.numero} — ${j.titulo} entrou em atraso`, 'job', j.id, j.colaborador_id);
  }

  // One a One mensal automático
  const auto = db.prepare("SELECT valor FROM config WHERE chave = 'auto_one_a_one'").get();
  if (!auto || auto.valor !== '0') gerarOneAOnes(db, mesAtual());

  return { tarefas: tarefas.length, jobs: jobs.length };
}
