import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { plain, plainAll, transaction, UPLOAD_DIR } from './db.js';
import {
  hoje, agora, addDias, addMeses, mesAtual, mesDe, nomeMes, dataOneAOne, normalizar,
  CATEGORIAS, STATUS_TAREFA, PRIORIDADES, STATUS_JOB, STATUS_COBRANCA, STATUS_COLABORADOR,
  TIPOS_CPC, STATUS_CPC, RESULTADOS_CPC, PERGUNTAS_FEEDBACK, JOB_FECHADO,
} from '../shared/constantes.js';
import {
  listarTarefas, listarJobs, listarCobrancas, cpcComAvaliacoes, resumo, visaoEquipe, semaforoCpc,
  decorarTarefa, decorarJob, decorarCobranca, linhaColaborador,
} from './regras.js';
import { executarAutomacoes, gerarOneAOnes } from './automacoes.js';
import { carregarDemo, TABELAS } from './seed.js';

class ErroHttp extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}
const falha = (status, msg) => { throw new ErroHttp(status, msg); };

const vazioParaNull = (v) => (v === '' || v === undefined ? null : v);
const idOuNull = (v) => (v === '' || v === null || v === undefined ? null : Number(v));

function pick(body, campos) {
  const out = {};
  for (const c of campos) if (c in body) out[c] = vazioParaNull(body[c]);
  return out;
}
function exigeEm(valor, lista, campo) {
  if (valor != null && !lista.includes(valor)) falha(400, `Valor inválido para ${campo}: ${valor}`);
}

function inserir(db, tabela, dados) {
  const cols = Object.keys(dados);
  const r = db.prepare(`INSERT INTO ${tabela} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => dados[c]));
  return Number(r.lastInsertRowid);
}
function atualizar(db, tabela, id, dados) {
  const cols = Object.keys(dados);
  if (!cols.length) return;
  db.prepare(`UPDATE ${tabela} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => dados[c]), id);
}
function obter(db, tabela, id) {
  const r = plain(db.prepare(`SELECT * FROM ${tabela} WHERE id = ?`).get(id));
  if (!r) falha(404, 'Registro não encontrado');
  return r;
}

export function registrar(db, tipo, descricao, { entidade = null, entidade_id = null, colaborador_id = null } = {}) {
  db.prepare('INSERT INTO historico (tipo, entidade, entidade_id, colaborador_id, descricao, data_hora) VALUES (?,?,?,?,?,?)')
    .run(tipo, entidade, entidade_id, colaborador_id, descricao, agora());
}

/** Aceita o nome digitado de uma pessoa e o vincula a um colaborador, quando existir. */
function resolverPessoa(db, body) {
  if (body.colaborador_id) return { colaborador_id: Number(body.colaborador_id), pessoa: null };
  const nome = (body.pessoa || '').trim();
  if (!nome) return { colaborador_id: null, pessoa: null };
  const c = plainAll(db.prepare('SELECT id, nome FROM colaboradores').all()).find((x) => normalizar(x.nome) === normalizar(nome));
  return c ? { colaborador_id: c.id, pessoa: null } : { colaborador_id: null, pessoa: nome };
}

// ---------- autenticação opcional (APP_PASSWORD) ----------

function autenticacao(senha) {
  const segredo = crypto.createHash('sha256').update(`fza:${senha}`).digest('hex');
  const token = crypto.createHmac('sha256', segredo).update('sessao').digest('hex');
  const lerCookie = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((p) => p.trim().split('=')))['fza_sessao'];
  return {
    login(req, res) {
      const ok = typeof req.body?.senha === 'string'
        && crypto.timingSafeEqual(crypto.createHash('sha256').update(req.body.senha).digest(), crypto.createHash('sha256').update(senha).digest());
      if (!ok) return res.status(401).json({ erro: 'Senha incorreta' });
      const https = req.secure || req.headers['x-forwarded-proto'] === 'https';
      res.setHeader('Set-Cookie', `fza_sessao=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 60}${https ? '; Secure' : ''}`);
      res.json({ ok: true });
    },
    guarda(req, res, next) {
      if (lerCookie(req) === token) return next();
      res.status(401).json({ erro: 'Não autenticado', login: true });
    },
  };
}

export function criarApp(db, { senha = process.env.APP_PASSWORD } = {}) {
  const app = express();
  app.use(express.json({ limit: '25mb' }));
  const api = express.Router();
  const h = (fn) => (req, res) => {
    try {
      const out = fn(req, res);
      if (out !== undefined && !res.headersSent) res.json(out);
    } catch (e) {
      if (!(e instanceof ErroHttp)) console.error(e);
      res.status(e.status || 500).json({ erro: e.message || 'Erro interno' });
    }
  };

  // Verificação de saúde para a hospedagem (sem dados, sem senha)
  api.get('/saude', (req, res) => res.json({ ok: true }));

  if (senha) {
    const auth = autenticacao(senha);
    api.post('/login', auth.login);
    api.use(auth.guarda);
  }

  // ================= META =================
  api.get('/meta', h(() => ({
    hoje: hoje(), mes: mesAtual(), protegido: !!senha,
    CATEGORIAS, STATUS_TAREFA, PRIORIDADES, STATUS_JOB, STATUS_COBRANCA, STATUS_COLABORADOR,
    TIPOS_CPC, STATUS_CPC, RESULTADOS_CPC, PERGUNTAS_FEEDBACK,
    vazio: !db.prepare('SELECT 1 FROM colaboradores LIMIT 1').get(),
  })));

  api.get('/resumo', h(() => {
    executarAutomacoes(db);
    return resumo(db);
  }));

  // ================= COLABORADORES =================
  const CAMPOS_COLAB = ['nome', 'cargo', 'area', 'data_entrada', 'status', 'observacoes', 'daily_horario', 'one_a_one_dia'];

  api.get('/colaboradores', h(() => plainAll(db.prepare('SELECT * FROM colaboradores ORDER BY status = \'Desligado\', nome').all())));
  api.get('/equipe', h(() => visaoEquipe(db)));

  api.post('/colaboradores', h((req) => {
    const d = pick(req.body, CAMPOS_COLAB);
    if (!d.nome?.trim()) falha(400, 'Informe o nome');
    exigeEm(d.status, STATUS_COLABORADOR, 'status');
    const id = inserir(db, 'colaboradores', { ...d, status: d.status || 'Ativo', one_a_one_dia: d.one_a_one_dia || 15, criado_em: agora(), atualizado_em: agora() });
    registrar(db, 'colaborador_cadastrado', `Colaborador cadastrado: ${d.nome}`, { entidade: 'colaborador', entidade_id: id, colaborador_id: id });
    return obter(db, 'colaboradores', id);
  }));

  api.put('/colaboradores/:id', h((req) => {
    const id = Number(req.params.id);
    obter(db, 'colaboradores', id);
    const d = pick(req.body, CAMPOS_COLAB);
    exigeEm(d.status, STATUS_COLABORADOR, 'status');
    atualizar(db, 'colaboradores', id, { ...d, atualizado_em: agora() });
    return obter(db, 'colaboradores', id);
  }));

  api.delete('/colaboradores/:id', h((req) => {
    const c = obter(db, 'colaboradores', Number(req.params.id));
    db.prepare('DELETE FROM colaboradores WHERE id = ?').run(c.id);
    registrar(db, 'colaborador_removido', `Colaborador removido: ${c.nome}`);
    return { ok: true };
  }));

  api.get('/colaboradores/:id/perfil', h((req) => {
    const id = Number(req.params.id);
    const colaborador = obter(db, 'colaboradores', id);
    const tarefas = listarTarefas(db, 'WHERE t.colaborador_id = ? ORDER BY t.status = \'Concluído\', t.prazo', [id]);
    const jobs = listarJobs(db, 'WHERE j.colaborador_id = ? ORDER BY j.prazo', [id]);
    const cobrancas = listarCobrancas(db, 'WHERE b.colaborador_id = ? ORDER BY b.status = \'Resolvido\', b.proximo_followup', [id]);
    const dailys = linhaDoTempoDailys(db, id);
    const oneAOnes = plainAll(db.prepare('SELECT * FROM one_on_ones WHERE colaborador_id = ? ORDER BY mes DESC').all(id));
    const cpc = cpcComAvaliacoes(db, 'WHERE p.colaborador_id = ?', [id]);
    const feedbacks = plainAll(db.prepare(`
      SELECT f.*, o.mes, o.data FROM feedbacks f JOIN one_on_ones o ON o.id = f.one_on_one_id
      WHERE f.colaborador_id = ? AND COALESCE(f.resposta, '') != '' ORDER BY o.mes DESC`).all(id));
    const historico = plainAll(db.prepare('SELECT * FROM historico WHERE colaborador_id = ? ORDER BY data_hora DESC, id DESC LIMIT 200').all(id));
    return {
      colaborador, tarefas, jobs, cobrancas, dailys, oneAOnes, cpc, feedbacks, historico,
      semaforo_cpc: semaforoCpc(cpc),
      bloqueios: dailys.filter((d) => d.bloqueios).map((d) => ({ data: d.data, texto: d.bloqueios, daily_id: d.id })),
      recorrentes: tarefas.filter((t) => t.status !== 'Concluído' && t.reagendamentos >= 1),
    };
  }));

  // ================= TAREFAS =================
  const CAMPOS_TAREFA = ['titulo', 'descricao', 'categoria', 'prioridade', 'status', 'colaborador_id', 'prazo', 'hora', 'observacoes', 'job_id', 'origem', 'daily_id', 'one_on_one_id'];
  const validarTarefa = (d) => {
    exigeEm(d.categoria, CATEGORIAS, 'categoria');
    exigeEm(d.prioridade, PRIORIDADES, 'prioridade');
    exigeEm(d.status, STATUS_TAREFA, 'status');
    if ('colaborador_id' in d) d.colaborador_id = idOuNull(d.colaborador_id);
    if ('job_id' in d) d.job_id = idOuNull(d.job_id);
  };
  const tarefaCompleta = (id) => {
    const t = listarTarefas(db, 'WHERE t.id = ?', [id])[0];
    if (!t) falha(404, 'Tarefa não encontrada');
    t.checklist = plainAll(db.prepare('SELECT * FROM tarefa_checklist WHERE tarefa_id = ? ORDER BY ordem, id').all(id));
    t.anexos = plainAll(db.prepare('SELECT id, nome, arquivo, tipo, tamanho, criado_em FROM tarefa_anexos WHERE tarefa_id = ? ORDER BY id').all(id));
    return t;
  };

  function criarTarefa(body) {
    const d = pick(body, CAMPOS_TAREFA);
    if (!d.titulo?.trim()) falha(400, 'Informe o título');
    validarTarefa(d);
    const id = inserir(db, 'tarefas', {
      categoria: 'Gestão', prioridade: 'Média', status: 'A fazer', origem: 'manual',
      ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== null)),
      colaborador_id: d.colaborador_id ?? null,
      criado_em: agora(), atualizado_em: agora(),
      concluido_em: d.status === 'Concluído' ? agora() : null,
    });
    (body.checklist || []).filter((x) => String(x).trim()).forEach((texto, i) =>
      inserir(db, 'tarefa_checklist', { tarefa_id: id, texto: String(texto).trim(), ordem: i }));
    const nome = d.colaborador_id ? linhaColaborador(db, d.colaborador_id)?.nome : null;
    registrar(db, 'tarefa_criada', `Tarefa criada${nome ? ` para ${nome}` : ''}: ${d.titulo}`, { entidade: 'tarefa', entidade_id: id, colaborador_id: d.colaborador_id });
    return id;
  }

  function atualizarTarefa(id, body) {
    const antes = obter(db, 'tarefas', id);
    const d = pick(body, CAMPOS_TAREFA);
    if ('titulo' in d && !d.titulo?.trim()) falha(400, 'Informe o título');
    validarTarefa(d);
    const novo = { ...d, atualizado_em: agora() };
    const status = d.status ?? antes.status;
    if (status === 'Concluído' && antes.status !== 'Concluído') novo.concluido_em = agora();
    if (status !== 'Concluído' && antes.status === 'Concluído') novo.concluido_em = null;
    if ('prazo' in d && d.prazo !== antes.prazo) {
      if (d.prazo && d.prazo >= hoje()) novo.atraso_registrado = 0;
      if (antes.prazo && d.prazo && d.prazo > antes.prazo && antes.prazo < hoje()) novo.reagendamentos = antes.reagendamentos + 1;
    }
    atualizar(db, 'tarefas', id, novo);
    const colab = d.colaborador_id !== undefined ? d.colaborador_id : antes.colaborador_id;
    if (novo.concluido_em && status === 'Concluído') registrar(db, 'tarefa_concluida', `Tarefa concluída: ${antes.titulo}`, { entidade: 'tarefa', entidade_id: id, colaborador_id: colab });
    else if (d.status && d.status !== antes.status) registrar(db, 'tarefa_status', `Tarefa "${antes.titulo}" → ${d.status}`, { entidade: 'tarefa', entidade_id: id, colaborador_id: colab });
  }

  api.get('/tarefas', h((req) => {
    const where = [];
    const params = [];
    if (req.query.colaborador_id) { where.push('t.colaborador_id = ?'); params.push(Number(req.query.colaborador_id)); }
    if (req.query.escopo === 'meu') where.push('t.colaborador_id IS NULL');
    if (req.query.escopo === 'equipe') where.push('t.colaborador_id IS NOT NULL');
    return listarTarefas(db, `${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.prazo IS NULL, t.prazo, t.id`, params);
  }));
  api.get('/tarefas/:id', h((req) => tarefaCompleta(Number(req.params.id))));
  api.post('/tarefas', h((req) => tarefaCompleta(criarTarefa(req.body))));
  api.put('/tarefas/:id', h((req) => {
    const id = Number(req.params.id);
    atualizarTarefa(id, req.body);
    return tarefaCompleta(id);
  }));
  api.delete('/tarefas/:id', h((req) => {
    const t = obter(db, 'tarefas', Number(req.params.id));
    for (const a of plainAll(db.prepare('SELECT arquivo FROM tarefa_anexos WHERE tarefa_id = ?').all(t.id))) fs.rmSync(path.join(UPLOAD_DIR, a.arquivo), { force: true });
    db.prepare('DELETE FROM tarefas WHERE id = ?').run(t.id);
    registrar(db, 'tarefa_removida', `Tarefa removida: ${t.titulo}`, { colaborador_id: t.colaborador_id });
    return { ok: true };
  }));

  api.post('/tarefas/:id/checklist', h((req) => {
    const id = Number(req.params.id);
    obter(db, 'tarefas', id);
    if (!req.body.texto?.trim()) falha(400, 'Informe o item');
    const ordem = db.prepare('SELECT COALESCE(MAX(ordem), -1) + 1 AS o FROM tarefa_checklist WHERE tarefa_id = ?').get(id).o;
    inserir(db, 'tarefa_checklist', { tarefa_id: id, texto: req.body.texto.trim(), ordem });
    atualizar(db, 'tarefas', id, { atualizado_em: agora() });
    return tarefaCompleta(id);
  }));
  api.put('/checklist/:id', h((req) => {
    const item = obter(db, 'tarefa_checklist', Number(req.params.id));
    const d = pick(req.body, ['texto', 'feito']);
    if ('feito' in d) d.feito = d.feito ? 1 : 0;
    atualizar(db, 'tarefa_checklist', item.id, d);
    atualizar(db, 'tarefas', item.tarefa_id, { atualizado_em: agora() });
    return tarefaCompleta(item.tarefa_id);
  }));
  api.delete('/checklist/:id', h((req) => {
    const item = obter(db, 'tarefa_checklist', Number(req.params.id));
    db.prepare('DELETE FROM tarefa_checklist WHERE id = ?').run(item.id);
    return tarefaCompleta(item.tarefa_id);
  }));

  api.post('/tarefas/:id/anexos', h((req) => {
    const id = Number(req.params.id);
    obter(db, 'tarefas', id);
    const { nome, tipo, base64 } = req.body;
    if (nome && req.body.arquivo && !base64) {
      // Arquivo já guardado fora do servidor (versão no navegador)
      inserir(db, 'tarefa_anexos', { tarefa_id: id, nome, arquivo: String(req.body.arquivo), tipo: tipo || null, tamanho: Number(req.body.tamanho) || 0, criado_em: agora() });
      atualizar(db, 'tarefas', id, { atualizado_em: agora() });
      return tarefaCompleta(id);
    }
    if (!nome || !base64) falha(400, 'Arquivo inválido');
    const buf = Buffer.from(base64, 'base64');
    if (buf.length > 15 * 1024 * 1024) falha(400, 'Arquivo maior que 15 MB');
    const arquivo = `${crypto.randomUUID()}${path.extname(nome).slice(0, 10)}`;
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, arquivo), buf);
    inserir(db, 'tarefa_anexos', { tarefa_id: id, nome, arquivo, tipo: tipo || null, tamanho: buf.length, criado_em: agora() });
    atualizar(db, 'tarefas', id, { atualizado_em: agora() });
    return tarefaCompleta(id);
  }));
  api.get('/anexos/:id', h((req, res) => {
    const a = obter(db, 'tarefa_anexos', Number(req.params.id));
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(a.nome)}`);
    if (a.tipo) res.type(a.tipo);
    res.sendFile(path.join(UPLOAD_DIR, a.arquivo));
  }));
  api.delete('/anexos/:id', h((req) => {
    const a = obter(db, 'tarefa_anexos', Number(req.params.id));
    fs.rmSync(path.join(UPLOAD_DIR, a.arquivo), { force: true });
    db.prepare('DELETE FROM tarefa_anexos WHERE id = ?').run(a.id);
    return tarefaCompleta(a.tarefa_id);
  }));

  // ================= JOBS =================
  const CAMPOS_JOB = ['numero', 'titulo', 'cliente', 'colaborador_id', 'setor', 'data_entrada', 'prazo', 'status', 'prioridade', 'observacoes', 'proxima_acao', 'proxima_acao_responsavel'];
  const jobCompleto = (id) => {
    const j = listarJobs(db, 'WHERE j.id = ?', [id])[0];
    if (!j) falha(404, 'JOB não encontrado');
    j.historico = plainAll(db.prepare('SELECT * FROM job_historico WHERE job_id = ? ORDER BY data DESC, id DESC').all(id));
    j.tarefas = listarTarefas(db, 'WHERE t.job_id = ? ORDER BY t.prazo', [id]);
    j.cobrancas = listarCobrancas(db, 'WHERE b.job_id = ? ORDER BY b.data DESC', [id]);
    return j;
  };
  const anotarJob = (id, texto, data = hoje()) => inserir(db, 'job_historico', { job_id: id, data, texto, criado_em: agora() });

  api.get('/jobs', h(() => listarJobs(db, 'ORDER BY j.prazo IS NULL, j.prazo, j.numero')));
  api.get('/jobs/:id', h((req) => jobCompleto(Number(req.params.id))));
  api.post('/jobs', h((req) => {
    const d = pick(req.body, CAMPOS_JOB);
    if (!d.numero?.toString().trim() || !d.titulo?.trim()) falha(400, 'Informe número e nome do JOB');
    exigeEm(d.status, STATUS_JOB, 'status');
    exigeEm(d.prioridade, PRIORIDADES, 'prioridade');
    d.colaborador_id = idOuNull(d.colaborador_id);
    const id = inserir(db, 'jobs', {
      ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== null)),
      colaborador_id: d.colaborador_id, status: d.status || 'Novo', prioridade: d.prioridade || 'Média',
      data_entrada: d.data_entrada || hoje(), criado_em: agora(), atualizado_em: agora(),
    });
    anotarJob(id, 'JOB cadastrado');
    registrar(db, 'job_criado', `JOB ${d.numero} — ${d.titulo} cadastrado`, { entidade: 'job', entidade_id: id, colaborador_id: d.colaborador_id });
    return jobCompleto(id);
  }));
  api.put('/jobs/:id', h((req) => {
    const id = Number(req.params.id);
    const antes = obter(db, 'jobs', id);
    const d = pick(req.body, CAMPOS_JOB);
    exigeEm(d.status, STATUS_JOB, 'status');
    exigeEm(d.prioridade, PRIORIDADES, 'prioridade');
    if ('colaborador_id' in d) d.colaborador_id = idOuNull(d.colaborador_id);
    const novo = { ...d, atualizado_em: agora() };
    if (d.status && d.status !== antes.status) {
      anotarJob(id, `Status alterado: ${antes.status} → ${d.status}`);
      if (JOB_FECHADO.includes(d.status)) novo.concluido_em = agora();
      else novo.concluido_em = null;
      registrar(db, d.status === 'Concluído' ? 'job_concluido' : 'job_status', `JOB ${antes.numero} → ${d.status}`, { entidade: 'job', entidade_id: id, colaborador_id: d.colaborador_id ?? antes.colaborador_id });
    }
    if ('prazo' in d && d.prazo !== antes.prazo) {
      anotarJob(id, `Prazo alterado: ${antes.prazo || '—'} → ${d.prazo || '—'}`);
      if (d.prazo && d.prazo >= hoje()) novo.atraso_registrado = 0;
    }
    if ('proxima_acao' in d && d.proxima_acao && d.proxima_acao !== antes.proxima_acao) anotarJob(id, `Próxima ação: ${d.proxima_acao}${d.proxima_acao_responsavel ? ` (${d.proxima_acao_responsavel})` : ''}`);
    atualizar(db, 'jobs', id, novo);
    return jobCompleto(id);
  }));
  api.delete('/jobs/:id', h((req) => {
    const j = obter(db, 'jobs', Number(req.params.id));
    db.prepare('DELETE FROM jobs WHERE id = ?').run(j.id);
    registrar(db, 'job_removido', `JOB ${j.numero} — ${j.titulo} removido`);
    return { ok: true };
  }));
  api.post('/jobs/:id/historico', h((req) => {
    const id = Number(req.params.id);
    const j = obter(db, 'jobs', id);
    if (!req.body.texto?.trim()) falha(400, 'Escreva o acompanhamento');
    anotarJob(id, req.body.texto.trim(), req.body.data || hoje());
    atualizar(db, 'jobs', id, { atualizado_em: agora() });
    registrar(db, 'job_acompanhamento', `JOB ${j.numero}: ${req.body.texto.trim()}`, { entidade: 'job', entidade_id: id, colaborador_id: j.colaborador_id });
    return jobCompleto(id);
  }));
  api.delete('/job-historico/:id', h((req) => {
    const r = obter(db, 'job_historico', Number(req.params.id));
    db.prepare('DELETE FROM job_historico WHERE id = ?').run(r.id);
    return jobCompleto(r.job_id);
  }));

  // ================= COBRANÇAS =================
  const CAMPOS_COB = ['descricao', 'data', 'prazo', 'status', 'ultimo_contato', 'proximo_followup', 'observacao', 'job_id'];
  const cobrancaCompleta = (id) => {
    const c = listarCobrancas(db, 'WHERE b.id = ?', [id])[0];
    if (!c) falha(404, 'Cobrança não encontrada');
    c.contatos = plainAll(db.prepare('SELECT * FROM cobranca_contatos WHERE cobranca_id = ? ORDER BY data DESC, id DESC').all(id));
    return c;
  };

  api.get('/cobrancas', h(() => listarCobrancas(db, 'ORDER BY b.status = \'Resolvido\', b.proximo_followup IS NULL, b.proximo_followup, b.id')));
  api.get('/cobrancas/:id', h((req) => cobrancaCompleta(Number(req.params.id))));
  api.post('/cobrancas', h((req) => {
    const d = pick(req.body, CAMPOS_COB);
    if (!d.descricao?.trim()) falha(400, 'Informe o que cobrar');
    exigeEm(d.status, STATUS_COBRANCA, 'status');
    if ('job_id' in d) d.job_id = idOuNull(d.job_id);
    const pessoa = resolverPessoa(db, req.body);
    const id = inserir(db, 'cobrancas', {
      ...Object.fromEntries(Object.entries(d).filter(([, v]) => v !== null)),
      ...pessoa, data: d.data || hoje(), status: d.status || 'Pendente',
      criado_em: agora(), atualizado_em: agora(), resolvido_em: d.status === 'Resolvido' ? agora() : null,
    });
    const c = cobrancaCompleta(id);
    registrar(db, 'cobranca_criada', `Cobrança criada: ${c.descricao} (${c.pessoa_nome})`, { entidade: 'cobranca', entidade_id: id, colaborador_id: c.colaborador_id });
    return c;
  }));
  api.put('/cobrancas/:id', h((req) => {
    const id = Number(req.params.id);
    const antes = obter(db, 'cobrancas', id);
    const d = pick(req.body, CAMPOS_COB);
    exigeEm(d.status, STATUS_COBRANCA, 'status');
    if ('job_id' in d) d.job_id = idOuNull(d.job_id);
    const novo = { ...d, atualizado_em: agora() };
    if ('pessoa' in req.body || 'colaborador_id' in req.body) Object.assign(novo, resolverPessoa(db, req.body));
    if (d.status === 'Resolvido' && antes.status !== 'Resolvido') novo.resolvido_em = agora();
    if (d.status && d.status !== 'Resolvido') novo.resolvido_em = null;
    atualizar(db, 'cobrancas', id, novo);
    if (d.status && d.status !== antes.status) {
      registrar(db, d.status === 'Resolvido' ? 'cobranca_concluida' : 'cobranca_status',
        d.status === 'Resolvido' ? `Cobrança resolvida: ${antes.descricao}` : `Cobrança "${antes.descricao}" → ${d.status}`,
        { entidade: 'cobranca', entidade_id: id, colaborador_id: novo.colaborador_id ?? antes.colaborador_id });
    }
    return cobrancaCompleta(id);
  }));
  api.delete('/cobrancas/:id', h((req) => {
    const c = obter(db, 'cobrancas', Number(req.params.id));
    db.prepare('DELETE FROM cobrancas WHERE id = ?').run(c.id);
    return { ok: true };
  }));
  /** Registra um contato de cobrança (follow-up feito) e agenda o próximo. */
  api.post('/cobrancas/:id/contato', h((req) => {
    const id = Number(req.params.id);
    const c = cobrancaCompleta(id);
    const data = req.body.data || hoje();
    const status = req.body.status || 'Cobrado';
    exigeEm(status, STATUS_COBRANCA, 'status');
    inserir(db, 'cobranca_contatos', { cobranca_id: id, data, texto: vazioParaNull(req.body.texto?.trim()), criado_em: agora() });
    atualizar(db, 'cobrancas', id, {
      ultimo_contato: data,
      status,
      proximo_followup: status === 'Resolvido' ? null : (req.body.proximo_followup || addDias(data, 1)),
      resolvido_em: status === 'Resolvido' ? agora() : null,
      atualizado_em: agora(),
    });
    registrar(db, status === 'Resolvido' ? 'cobranca_concluida' : 'cobranca_realizada',
      status === 'Resolvido' ? `Cobrança resolvida: ${c.descricao}` : `Cobrança realizada: ${c.descricao} (${c.pessoa_nome})${req.body.texto ? ` — ${req.body.texto}` : ''}`,
      { entidade: 'cobranca', entidade_id: id, colaborador_id: c.colaborador_id });
    if (c.job_id) anotarJob(c.job_id, `Cobrado ${c.pessoa_nome}${req.body.texto ? `: ${req.body.texto}` : ''}`, data);
    return cobrancaCompleta(id);
  }));

  // ================= DAILY =================
  /** Tudo o que a tela de Daily precisa para um colaborador numa data. */
  api.get('/dailys/form', h((req) => {
    const colaborador_id = Number(req.query.colaborador_id);
    const data = req.query.data || hoje();
    const colaborador = obter(db, 'colaboradores', colaborador_id);
    const daily = plain(db.prepare('SELECT * FROM dailys WHERE colaborador_id = ? AND data = ?').get(colaborador_id, data)) || null;
    const itens = daily ? listarTarefas(db, 'WHERE t.daily_id = ? ORDER BY t.id', [daily.id]) : [];
    const pendencias = listarTarefas(db, `
      WHERE t.colaborador_id = ? AND t.status != 'Concluído' AND (t.daily_id IS NULL OR t.daily_id != ?)
        AND (t.prazo IS NULL OR t.prazo <= ?) ORDER BY t.prazo`, [colaborador_id, daily?.id ?? -1, data]);
    const anterior = plain(db.prepare('SELECT * FROM dailys WHERE colaborador_id = ? AND data < ? ORDER BY data DESC LIMIT 1').get(colaborador_id, data)) || null;
    const cobrancas = listarCobrancas(db, `WHERE b.colaborador_id = ? AND b.status != 'Resolvido' ORDER BY b.proximo_followup`, [colaborador_id]);
    const jobs = listarJobs(db, `WHERE j.colaborador_id = ? AND j.status NOT IN ('Concluído','Cancelado') ORDER BY j.prazo`, [colaborador_id]);
    return { colaborador, data, daily, itens, pendencias, anterior, cobrancas, jobs };
  }));

  /**
   * Salva a Daily inteira de uma vez: campos + itens (viram tarefas) + pendências trazidas para hoje.
   * itens: [{ id?, titulo, status?, prazo?, prioridade? }] — itens ausentes da lista são removidos.
   */
  api.post('/dailys', h((req) => {
    const colaborador_id = Number(req.body.colaborador_id);
    const data = req.body.data || hoje();
    const colaborador = obter(db, 'colaboradores', colaborador_id);
    return transaction(db, () => {
      let daily = plain(db.prepare('SELECT * FROM dailys WHERE colaborador_id = ? AND data = ?').get(colaborador_id, data));
      const campos = pick(req.body, ['bloqueios', 'observacoes', 'combinados']);
      const nova = !daily;
      if (nova) {
        const id = inserir(db, 'dailys', { colaborador_id, data, ...campos, criado_em: agora(), atualizado_em: agora() });
        daily = obter(db, 'dailys', id);
      } else {
        atualizar(db, 'dailys', daily.id, { ...campos, atualizado_em: agora() });
      }

      const itens = (req.body.itens || []).filter((i) => i.titulo?.trim());
      const existentes = plainAll(db.prepare('SELECT id FROM tarefas WHERE daily_id = ?').all(daily.id)).map((r) => r.id);
      const mantidos = new Set(itens.filter((i) => i.id).map((i) => Number(i.id)));
      // Item removido: o que nasceu nesta Daily é apagado; pendência trazida de antes volta a ser pendência
      for (const id of existentes) {
        if (mantidos.has(id)) continue;
        const t = obter(db, 'tarefas', id);
        if (t.reagendamentos > 0 || t.origem !== 'daily') db.prepare('UPDATE tarefas SET daily_id = NULL WHERE id = ?').run(id);
        else db.prepare('DELETE FROM tarefas WHERE id = ?').run(id);
      }
      let criadas = 0;
      for (const i of itens) {
        if (i.id && existentes.includes(Number(i.id))) {
          atualizarTarefa(Number(i.id), pick(i, ['titulo', 'status', 'prazo', 'prioridade']));
        } else {
          criarTarefa({ titulo: i.titulo.trim(), status: i.status || 'A fazer', prazo: i.prazo || data, prioridade: i.prioridade || 'Média', categoria: 'Equipe', colaborador_id, origem: 'daily', daily_id: daily.id });
          criadas++;
        }
      }

      for (const p of req.body.pendencias || []) {
        const t = plain(db.prepare('SELECT * FROM tarefas WHERE id = ? AND colaborador_id = ?').get(Number(p.id), colaborador_id));
        if (!t) continue;
        if (p.acao === 'concluir') atualizarTarefa(t.id, { status: 'Concluído' });
        if (p.acao === 'hoje' && t.prazo !== data) {
          atualizar(db, 'tarefas', t.id, { prazo: data, daily_id: daily.id, reagendamentos: t.reagendamentos + 1, atraso_registrado: 0, atualizado_em: agora() });
          registrar(db, 'pendencia_reagendada', `Pendência levada para a Daily de ${data}: ${t.titulo}`, { entidade: 'tarefa', entidade_id: t.id, colaborador_id });
        }
      }

      if (nova) {
        registrar(db, 'daily_realizada', `Daily realizada com ${colaborador.nome} — ${itens.length} tarefa(s)${campos.bloqueios ? ', 1 bloqueio' : ''}`, { entidade: 'daily', entidade_id: daily.id, colaborador_id });
      } else if (criadas) {
        registrar(db, 'daily_atualizada', `Daily de ${colaborador.nome} atualizada (+${criadas} tarefa)`, { entidade: 'daily', entidade_id: daily.id, colaborador_id });
      }
      return { id: daily.id };
    });
  }));

  api.get('/dailys', h((req) => {
    if (req.query.colaborador_id) return linhaDoTempoDailys(db, Number(req.query.colaborador_id));
    const data = req.query.data || hoje();
    return plainAll(db.prepare(`
      SELECT d.*, c.nome AS colaborador_nome,
        (SELECT COUNT(*) FROM tarefas t WHERE t.daily_id = d.id) AS tarefas_total,
        (SELECT COUNT(*) FROM tarefas t WHERE t.daily_id = d.id AND t.status = 'Concluído') AS tarefas_concluidas
      FROM dailys d JOIN colaboradores c ON c.id = d.colaborador_id WHERE d.data = ? ORDER BY c.nome`).all(data));
  }));
  api.delete('/dailys/:id', h((req) => {
    const d = obter(db, 'dailys', Number(req.params.id));
    db.prepare("DELETE FROM tarefas WHERE daily_id = ? AND origem = 'daily'").run(d.id);
    db.prepare('DELETE FROM dailys WHERE id = ?').run(d.id);
    return { ok: true };
  }));

  // ================= ONE A ONE =================
  const CAMPOS_OOO = ['data', 'hora', 'observacoes', 'pontos_positivos', 'pontos_atencao', 'compromissos_gestor', 'compromissos_colaborador', 'proxima_avaliacao'];

  api.get('/one-a-ones', h((req) => {
    const params = [];
    let where = '';
    if (req.query.mes) { where = 'WHERE o.mes = ?'; params.push(req.query.mes); }
    if (req.query.colaborador_id) { where = 'WHERE o.colaborador_id = ?'; params.push(Number(req.query.colaborador_id)); }
    return plainAll(db.prepare(`
      SELECT o.*, c.nome AS colaborador_nome, c.cargo,
        (SELECT COUNT(*) FROM cpc p WHERE p.one_on_one_id = o.id) AS cpc_novos,
        (SELECT COUNT(*) FROM cpc_avaliacoes a WHERE a.one_on_one_id = o.id) AS cpc_avaliados
      FROM one_on_ones o JOIN colaboradores c ON c.id = o.colaborador_id ${where} ORDER BY o.data, c.nome`).all(...params));
  }));

  api.post('/one-a-ones/gerar', h((req) => ({ criados: gerarOneAOnes(db, req.body.mes || mesAtual()) })));

  api.post('/one-a-ones', h((req) => {
    const colaborador_id = Number(req.body.colaborador_id);
    const c = obter(db, 'colaboradores', colaborador_id);
    const data = req.body.data || hoje();
    const mes = mesDe(data);
    const existe = plain(db.prepare('SELECT id FROM one_on_ones WHERE colaborador_id = ? AND mes = ?').get(colaborador_id, mes));
    if (existe) {
      atualizar(db, 'one_on_ones', existe.id, { data, hora: vazioParaNull(req.body.hora), atualizado_em: agora() });
      return obter(db, 'one_on_ones', existe.id);
    }
    const id = inserir(db, 'one_on_ones', { colaborador_id, mes, data, hora: vazioParaNull(req.body.hora), criado_em: agora(), atualizado_em: agora() });
    registrar(db, 'one_a_one_agendado', `One a One de ${nomeMes(mes)} agendado com ${c.nome} (${data})`, { entidade: 'one_a_one', entidade_id: id, colaborador_id });
    return obter(db, 'one_on_ones', id);
  }));

  const oneAOneCompleto = (id) => {
    const o = obter(db, 'one_on_ones', id);
    const colaborador = obter(db, 'colaboradores', o.colaborador_id);
    const todos = cpcComAvaliacoes(db, 'WHERE p.colaborador_id = ?', [o.colaborador_id]);
    const novos = todos.filter((p) => p.one_on_one_id === id);
    // Itens de meses anteriores: os que estão em acompanhamento ou que foram avaliados nesta reunião
    const paraAvaliar = todos.filter((p) => p.one_on_one_id !== id && (p.origem_mes || '') < o.mes
      && (p.status === 'Em acompanhamento' || p.avaliacoes.some((a) => a.one_on_one_id === id)));
    const avaliacoes = Object.fromEntries(paraAvaliar.map((p) => [p.id, p.avaliacoes.find((a) => a.one_on_one_id === id) || null]));
    const respostas = Object.fromEntries(plainAll(db.prepare('SELECT pergunta_chave, resposta FROM feedbacks WHERE one_on_one_id = ?').all(id)).map((f) => [f.pergunta_chave, f.resposta]));
    const anterior = plain(db.prepare('SELECT * FROM one_on_ones WHERE colaborador_id = ? AND mes < ? ORDER BY mes DESC LIMIT 1').get(o.colaborador_id, o.mes)) || null;
    const dailys = plainAll(db.prepare(`SELECT data, bloqueios FROM dailys WHERE colaborador_id = ? AND data >= ? AND data <= ? AND COALESCE(bloqueios,'') != '' ORDER BY data DESC`)
      .all(o.colaborador_id, `${addMeses(o.mes, -1)}-01`, o.data));
    const tarefas = listarTarefas(db, `WHERE t.colaborador_id = ? AND t.status != 'Concluído'`, [o.colaborador_id]);
    return {
      ...o, colaborador, novos, paraAvaliar, avaliacoes, respostas, anterior,
      contexto: { bloqueios: dailys, atrasadas: tarefas.filter((t) => t.atrasado).length, recorrentes: tarefas.filter((t) => t.reagendamentos >= 2).length, abertas: tarefas.length },
    };
  };

  api.get('/one-a-ones/:id', h((req) => oneAOneCompleto(Number(req.params.id))));

  /** Salva rascunho: campos, respostas de feedback e avaliações de CPC. */
  api.put('/one-a-ones/:id', h((req) => {
    const id = Number(req.params.id);
    const o = obter(db, 'one_on_ones', id);
    transaction(db, () => {
      const d = pick(req.body, CAMPOS_OOO);
      if (d.data) d.mes = mesDe(d.data);
      if (d.mes && d.mes !== o.mes && db.prepare('SELECT 1 FROM one_on_ones WHERE colaborador_id = ? AND mes = ? AND id != ?').get(o.colaborador_id, d.mes, id)) {
        falha(400, `Já existe One a One de ${nomeMes(d.mes)} para este colaborador`);
      }
      atualizar(db, 'one_on_ones', id, { ...d, atualizado_em: agora() });
      for (const [chave, resposta] of Object.entries(req.body.respostas || {})) {
        const q = PERGUNTAS_FEEDBACK.find((p) => p.chave === chave);
        if (!q) continue;
        db.prepare(`INSERT INTO feedbacks (colaborador_id, one_on_one_id, pergunta_chave, pergunta, resposta) VALUES (?,?,?,?,?)
          ON CONFLICT(one_on_one_id, pergunta_chave) DO UPDATE SET resposta = excluded.resposta`).run(o.colaborador_id, id, chave, q.pergunta, vazioParaNull(resposta));
      }
      for (const [cpcId, av] of Object.entries(req.body.avaliacoes || {})) {
        const p = obter(db, 'cpc', Number(cpcId));
        if (p.colaborador_id !== o.colaborador_id) continue;
        if (!av || !av.resultado) {
          db.prepare('DELETE FROM cpc_avaliacoes WHERE cpc_id = ? AND one_on_one_id = ?').run(p.id, id);
          continue;
        }
        exigeEm(av.resultado, RESULTADOS_CPC, 'resultado');
        const existia = db.prepare('SELECT 1 FROM cpc_avaliacoes WHERE cpc_id = ? AND one_on_one_id = ?').get(p.id, id);
        db.prepare(`INSERT INTO cpc_avaliacoes (cpc_id, one_on_one_id, data, resultado, observacao, encerrar, criado_em) VALUES (?,?,?,?,?,?,?)
          ON CONFLICT(cpc_id, one_on_one_id) DO UPDATE SET resultado = excluded.resultado, observacao = excluded.observacao, encerrar = excluded.encerrar, data = excluded.data`)
          .run(p.id, id, d.data || o.data, av.resultado, vazioParaNull(av.observacao), av.encerrar ? 1 : 0, agora());
        if (!existia) registrar(db, 'cpc_avaliado', `CPC avaliado (${av.resultado}): ${p.descricao}`, { entidade: 'cpc', entidade_id: p.id, colaborador_id: o.colaborador_id });
      }
    });
    return oneAOneCompleto(id);
  }));

  api.post('/one-a-ones/:id/finalizar', h((req) => {
    const id = Number(req.params.id);
    const o = obter(db, 'one_on_ones', id);
    const colaborador = obter(db, 'colaboradores', o.colaborador_id);
    return transaction(db, () => {
      const proximaData = o.proxima_avaliacao || dataOneAOne(addMeses(o.mes, 1), colaborador.one_a_one_dia);
      const proximoMes = mesDe(proximaData) > o.mes ? mesDe(proximaData) : addMeses(o.mes, 1);
      atualizar(db, 'one_on_ones', id, { status: 'Finalizado', finalizado_em: agora(), proxima_avaliacao: proximaData, atualizado_em: agora() });

      // CPCs criados nesta reunião passam a ser acompanhados até a próxima
      db.prepare(`UPDATE cpc SET proxima_avaliacao = ?, atualizado_em = ? WHERE one_on_one_id = ? AND status = 'Em acompanhamento'`).run(proximoMes, agora(), id);
      // CPCs avaliados: encerra os marcados, reagenda os demais
      for (const a of plainAll(db.prepare('SELECT * FROM cpc_avaliacoes WHERE one_on_one_id = ?').all(id))) {
        if (a.encerrar) db.prepare('UPDATE cpc SET status = ?, proxima_avaliacao = NULL, atualizado_em = ? WHERE id = ?').run(a.resultado === 'Cumpriu' ? 'Concluído' : 'Encerrado', agora(), a.cpc_id);
        else db.prepare('UPDATE cpc SET proxima_avaliacao = ?, atualizado_em = ? WHERE id = ?').run(proximoMes, agora(), a.cpc_id);
      }

      let tarefas = 0;
      if (req.body.criar_tarefas !== false) {
        const linhas = (s) => (s || '').split('\n').map((l) => l.replace(/^[-•*\s]+/, '').trim()).filter(Boolean);
        for (const l of linhas(o.compromissos_gestor)) { criarTarefa({ titulo: l, categoria: 'Equipe', prioridade: 'Alta', prazo: addDias(o.data, 14), origem: 'one_a_one', one_on_one_id: id, observacoes: `Compromisso do gestor — One a One ${nomeMes(o.mes)} com ${colaborador.nome}` }); tarefas++; }
        for (const l of linhas(o.compromissos_colaborador)) { criarTarefa({ titulo: l, categoria: 'Equipe', prioridade: 'Média', prazo: addDias(o.data, 14), origem: 'one_a_one', one_on_one_id: id, colaborador_id: colaborador.id, observacoes: `Compromisso — One a One ${nomeMes(o.mes)}` }); tarefas++; }
      }

      // Agenda o próximo One a One
      if (!db.prepare('SELECT 1 FROM one_on_ones WHERE colaborador_id = ? AND mes = ?').get(colaborador.id, mesDe(proximaData)) && mesDe(proximaData) > o.mes) {
        inserir(db, 'one_on_ones', { colaborador_id: colaborador.id, mes: mesDe(proximaData), data: proximaData, hora: o.hora, criado_em: agora(), atualizado_em: agora() });
      }

      const novos = db.prepare('SELECT COUNT(*) AS n FROM cpc WHERE one_on_one_id = ?').get(id).n;
      const avaliados = db.prepare('SELECT COUNT(*) AS n FROM cpc_avaliacoes WHERE one_on_one_id = ?').get(id).n;
      registrar(db, 'one_a_one_realizado', `One a One ${nomeMes(o.mes)} finalizado com ${colaborador.nome} — ${novos} CPC novo(s), ${avaliados} avaliado(s)${tarefas ? `, ${tarefas} compromisso(s) virou(aram) tarefa` : ''}`, { entidade: 'one_a_one', entidade_id: id, colaborador_id: colaborador.id });
      return oneAOneCompleto(id);
    });
  }));

  api.post('/one-a-ones/:id/reabrir', h((req) => {
    const id = Number(req.params.id);
    atualizar(db, 'one_on_ones', id, { status: 'Agendado', finalizado_em: null, atualizado_em: agora() });
    return oneAOneCompleto(id);
  }));

  api.delete('/one-a-ones/:id', h((req) => {
    const o = obter(db, 'one_on_ones', Number(req.params.id));
    db.prepare('DELETE FROM cpc WHERE one_on_one_id = ?').run(o.id);
    db.prepare('DELETE FROM one_on_ones WHERE id = ?').run(o.id);
    return { ok: true };
  }));

  // ================= CPC =================
  api.get('/cpc', h((req) => req.query.colaborador_id
    ? cpcComAvaliacoes(db, 'WHERE p.colaborador_id = ?', [Number(req.query.colaborador_id)])
    : cpcComAvaliacoes(db)));
  api.post('/cpc', h((req) => {
    const { colaborador_id, one_on_one_id, tipo, descricao } = req.body;
    exigeEm(tipo, TIPOS_CPC, 'tipo');
    if (!descricao?.trim()) falha(400, 'Descreva o ponto');
    const c = obter(db, 'colaboradores', Number(colaborador_id));
    const o = one_on_one_id ? obter(db, 'one_on_ones', Number(one_on_one_id)) : null;
    const id = inserir(db, 'cpc', {
      colaborador_id: c.id, one_on_one_id: o?.id ?? null, tipo, descricao: descricao.trim(),
      proxima_avaliacao: addMeses(o?.mes || mesAtual(), 1), criado_em: agora(), atualizado_em: agora(),
    });
    registrar(db, 'cpc_criado', `CPC criado para ${c.nome} (${tipo}): ${descricao.trim()}`, { entidade: 'cpc', entidade_id: id, colaborador_id: c.id });
    return cpcComAvaliacoes(db, 'WHERE p.id = ?', [id])[0];
  }));
  api.put('/cpc/:id', h((req) => {
    const p = obter(db, 'cpc', Number(req.params.id));
    const d = pick(req.body, ['descricao', 'tipo', 'status', 'proxima_avaliacao']);
    exigeEm(d.tipo, TIPOS_CPC, 'tipo');
    exigeEm(d.status, STATUS_CPC, 'status');
    if (d.status === 'Em acompanhamento' && p.status !== 'Em acompanhamento' && !d.proxima_avaliacao) d.proxima_avaliacao = addMeses(mesAtual(), 1);
    atualizar(db, 'cpc', p.id, { ...d, atualizado_em: agora() });
    return cpcComAvaliacoes(db, 'WHERE p.id = ?', [p.id])[0];
  }));
  api.delete('/cpc/:id', h((req) => {
    db.prepare('DELETE FROM cpc WHERE id = ?').run(Number(req.params.id));
    return { ok: true };
  }));

  // ================= HISTÓRICO =================
  api.get('/historico', h((req) => {
    const where = [];
    const params = [];
    if (req.query.tipo) { where.push('h.tipo LIKE ?'); params.push(`${req.query.tipo}%`); }
    if (req.query.colaborador_id) { where.push('h.colaborador_id = ?'); params.push(Number(req.query.colaborador_id)); }
    if (req.query.de) { where.push('h.data_hora >= ?'); params.push(req.query.de); }
    if (req.query.ate) { where.push('h.data_hora <= ?'); params.push(`${req.query.ate}T23:59:59`); }
    const limite = Math.min(Number(req.query.limite) || 300, 2000);
    return plainAll(db.prepare(`SELECT h.*, c.nome AS colaborador_nome FROM historico h LEFT JOIN colaboradores c ON c.id = h.colaborador_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY h.data_hora DESC, h.id DESC LIMIT ${limite}`).all(...params));
  }));

  // ================= BUSCA GLOBAL =================
  api.get('/busca', h((req) => buscar(db, String(req.query.q || ''))));

  // ================= CONFIG / BACKUP =================
  api.get('/config', h(() => Object.fromEntries(plainAll(db.prepare('SELECT * FROM config').all()).map((r) => [r.chave, r.valor]))));
  api.put('/config', h((req) => {
    for (const [k, v] of Object.entries(req.body || {})) db.prepare('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').run(k, String(v));
    return { ok: true };
  }));
  api.get('/backup', h((req, res) => {
    const dump = { versao: 1, gerado_em: agora(), tabelas: Object.fromEntries(TABELAS.map((t) => [t, plainAll(db.prepare(`SELECT * FROM ${t}`).all())])) };
    res.setHeader('Content-Disposition', `attachment; filename="fza-gestao-backup-${hoje()}.json"`);
    res.json(dump);
  }));
  api.post('/restaurar', h((req) => {
    const tabelas = req.body?.tabelas;
    if (!tabelas || typeof tabelas !== 'object') falha(400, 'Arquivo de backup inválido');
    transaction(db, () => {
      db.exec('PRAGMA defer_foreign_keys = ON');
      for (const t of [...TABELAS].reverse()) db.prepare(`DELETE FROM ${t}`).run();
      for (const t of TABELAS) for (const row of tabelas[t] || []) inserir(db, t, row);
    });
    return { ok: true };
  }));
  api.post('/demo', h(() => {
    carregarDemo(db);
    return { ok: true };
  }));
  api.post('/zerar', h((req) => {
    if (req.body?.confirmacao !== 'APAGAR') falha(400, 'Confirmação ausente');
    transaction(db, () => {
      db.exec('PRAGMA defer_foreign_keys = ON');
      for (const t of [...TABELAS].reverse()) if (t !== 'config') db.prepare(`DELETE FROM ${t}`).run();
    });
    return { ok: true };
  }));

  app.use('/api', api);
  app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));
  return app;
}

// ---------- auxiliares de leitura ----------

export function linhaDoTempoDailys(db, colaborador_id) {
  const ref = hoje();
  const dailys = plainAll(db.prepare('SELECT * FROM dailys WHERE colaborador_id = ? ORDER BY data DESC').all(colaborador_id));
  if (!dailys.length) return [];
  const tarefas = listarTarefas(db, 'WHERE t.daily_id IN (SELECT id FROM dailys WHERE colaborador_id = ?)', [colaborador_id]);
  return dailys.map((d) => {
    const ts = tarefas.filter((t) => t.daily_id === d.id);
    return {
      ...d,
      tarefas: ts,
      tarefas_total: ts.length,
      tarefas_concluidas: ts.filter((t) => t.status === 'Concluído').length,
      tarefas_atrasadas: ts.filter((t) => t.atrasado || (t.concluido_em && t.prazo && t.concluido_em.slice(0, 10) > t.prazo)).length,
      eh_hoje: d.data === ref,
    };
  });
}

function buscar(db, q) {
  const termo = normalizar(q).trim();
  if (termo.length < 2) return { termo: q, total: 0, grupos: [] };
  // "JOB 041" → também procura pelo número puro
  const numero = termo.replace(/^job\s*#?\s*/, '');
  const bate = (...campos) => campos.some((c) => normalizar(c).includes(termo) || (numero !== termo && normalizar(c).includes(numero)));

  const colaboradores = plainAll(db.prepare('SELECT * FROM colaboradores').all());
  const colabIds = new Set(colaboradores.filter((c) => bate(c.nome, c.cargo, c.area)).map((c) => c.id));

  const jobsTodos = listarJobs(db);
  const historicoJobs = plainAll(db.prepare('SELECT * FROM job_historico').all());
  const jobsBatem = jobsTodos.filter((j) => bate(j.numero, j.titulo, j.cliente, j.observacoes, j.proxima_acao, j.setor)
    || (numero !== termo && normalizar(j.numero).replace(/^0+/, '') === numero.replace(/^0+/, '')));
  const jobIds = new Set(jobsBatem.map((j) => j.id));
  const registrosJob = historicoJobs.filter((r) => bate(r.texto) && !jobIds.has(r.job_id));

  const tarefas = listarTarefas(db).filter((t) => bate(t.titulo, t.descricao, t.observacoes) || colabIds.has(t.colaborador_id) || jobIds.has(t.job_id));
  const cobrancas = listarCobrancas(db).filter((c) => bate(c.descricao, c.pessoa, c.observacao) || colabIds.has(c.colaborador_id) || jobIds.has(c.job_id));
  const jobs = jobsTodos.filter((j) => jobIds.has(j.id) || colabIds.has(j.colaborador_id) || registrosJob.some((r) => r.job_id === j.id));
  const dailys = plainAll(db.prepare('SELECT d.*, c.nome AS colaborador_nome FROM dailys d JOIN colaboradores c ON c.id = d.colaborador_id ORDER BY d.data DESC').all())
    .filter((d) => bate(d.bloqueios, d.observacoes, d.combinados) || colabIds.has(d.colaborador_id));
  const oneAOnes = plainAll(db.prepare('SELECT o.*, c.nome AS colaborador_nome FROM one_on_ones o JOIN colaboradores c ON c.id = o.colaborador_id ORDER BY o.mes DESC').all())
    .filter((o) => bate(o.observacoes, o.pontos_positivos, o.pontos_atencao, o.compromissos_gestor, o.compromissos_colaborador) || colabIds.has(o.colaborador_id));
  const cpc = cpcComAvaliacoes(db).filter((p) => bate(p.descricao, ...p.avaliacoes.map((a) => a.observacao)) || colabIds.has(p.colaborador_id));
  const feedbacks = plainAll(db.prepare("SELECT f.*, c.nome AS colaborador_nome, o.mes FROM feedbacks f JOIN colaboradores c ON c.id = f.colaborador_id JOIN one_on_ones o ON o.id = f.one_on_one_id WHERE COALESCE(f.resposta,'') != ''").all())
    .filter((f) => bate(f.resposta) || colabIds.has(f.colaborador_id));

  const grupos = [
    { tipo: 'colaboradores', titulo: 'Colaboradores', itens: colaboradores.filter((c) => colabIds.has(c.id)) },
    { tipo: 'jobs', titulo: 'JOBs', itens: jobs },
    { tipo: 'job_historico', titulo: 'Histórico de JOBs', itens: registrosJob.map((r) => ({ ...r, job: jobsTodos.find((j) => j.id === r.job_id) })) },
    { tipo: 'tarefas', titulo: 'Tarefas', itens: tarefas },
    { tipo: 'cobrancas', titulo: 'Cobranças', itens: cobrancas },
    { tipo: 'dailys', titulo: 'Dailys', itens: dailys.slice(0, 30) },
    { tipo: 'one_a_ones', titulo: 'One a Ones', itens: oneAOnes },
    { tipo: 'cpc', titulo: 'CPC / Desenvolvimento', itens: cpc },
    { tipo: 'feedbacks', titulo: 'Feedbacks do colaborador', itens: feedbacks.slice(0, 30) },
  ].filter((g) => g.itens.length);
  return { termo: q, total: grupos.reduce((s, g) => s + g.itens.length, 0), grupos };
}

export { decorarTarefa, decorarJob, decorarCobranca };
