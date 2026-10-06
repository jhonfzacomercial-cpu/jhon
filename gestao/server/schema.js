// Esquema do banco — compartilhado entre o servidor Node e a versão que roda no navegador.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS colaboradores (
  id INTEGER PRIMARY KEY,
  nome TEXT NOT NULL,
  cargo TEXT,
  area TEXT,
  data_entrada TEXT,
  status TEXT NOT NULL DEFAULT 'Ativo',
  observacoes TEXT,
  daily_horario TEXT,
  one_a_one_dia INTEGER NOT NULL DEFAULT 15,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tarefas (
  id INTEGER PRIMARY KEY,
  titulo TEXT NOT NULL,
  descricao TEXT,
  categoria TEXT NOT NULL DEFAULT 'Gestão',
  prioridade TEXT NOT NULL DEFAULT 'Média',
  status TEXT NOT NULL DEFAULT 'A fazer',
  colaborador_id INTEGER REFERENCES colaboradores(id) ON DELETE SET NULL,
  prazo TEXT,
  hora TEXT,
  observacoes TEXT,
  origem TEXT NOT NULL DEFAULT 'manual',
  daily_id INTEGER REFERENCES dailys(id) ON DELETE SET NULL,
  one_on_one_id INTEGER REFERENCES one_on_ones(id) ON DELETE SET NULL,
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  reagendamentos INTEGER NOT NULL DEFAULT 0,
  atraso_registrado INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  concluido_em TEXT
);

CREATE TABLE IF NOT EXISTS tarefa_checklist (
  id INTEGER PRIMARY KEY,
  tarefa_id INTEGER NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  texto TEXT NOT NULL,
  feito INTEGER NOT NULL DEFAULT 0,
  ordem INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tarefa_anexos (
  id INTEGER PRIMARY KEY,
  tarefa_id INTEGER NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  arquivo TEXT NOT NULL,
  tipo TEXT,
  tamanho INTEGER,
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY,
  numero TEXT NOT NULL,
  titulo TEXT NOT NULL,
  cliente TEXT,
  colaborador_id INTEGER REFERENCES colaboradores(id) ON DELETE SET NULL,
  setor TEXT,
  data_entrada TEXT,
  prazo TEXT,
  status TEXT NOT NULL DEFAULT 'Novo',
  prioridade TEXT NOT NULL DEFAULT 'Média',
  observacoes TEXT,
  proxima_acao TEXT,
  proxima_acao_responsavel TEXT,
  atraso_registrado INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  concluido_em TEXT
);

CREATE TABLE IF NOT EXISTS job_historico (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  texto TEXT NOT NULL,
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dailys (
  id INTEGER PRIMARY KEY,
  colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  bloqueios TEXT,
  observacoes TEXT,
  combinados TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  UNIQUE (colaborador_id, data)
);

CREATE TABLE IF NOT EXISTS cobrancas (
  id INTEGER PRIMARY KEY,
  descricao TEXT NOT NULL,
  colaborador_id INTEGER REFERENCES colaboradores(id) ON DELETE SET NULL,
  pessoa TEXT,
  data TEXT NOT NULL,
  prazo TEXT,
  status TEXT NOT NULL DEFAULT 'Pendente',
  ultimo_contato TEXT,
  proximo_followup TEXT,
  observacao TEXT,
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  resolvido_em TEXT
);

CREATE TABLE IF NOT EXISTS cobranca_contatos (
  id INTEGER PRIMARY KEY,
  cobranca_id INTEGER NOT NULL REFERENCES cobrancas(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  texto TEXT,
  criado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS one_on_ones (
  id INTEGER PRIMARY KEY,
  colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
  mes TEXT NOT NULL,
  data TEXT NOT NULL,
  hora TEXT,
  status TEXT NOT NULL DEFAULT 'Agendado',
  observacoes TEXT,
  pontos_positivos TEXT,
  pontos_atencao TEXT,
  compromissos_gestor TEXT,
  compromissos_colaborador TEXT,
  proxima_avaliacao TEXT,
  finalizado_em TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  UNIQUE (colaborador_id, mes)
);

CREATE TABLE IF NOT EXISTS cpc (
  id INTEGER PRIMARY KEY,
  colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
  one_on_one_id INTEGER REFERENCES one_on_ones(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL,
  descricao TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Em acompanhamento',
  proxima_avaliacao TEXT,
  criado_em TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cpc_avaliacoes (
  id INTEGER PRIMARY KEY,
  cpc_id INTEGER NOT NULL REFERENCES cpc(id) ON DELETE CASCADE,
  one_on_one_id INTEGER REFERENCES one_on_ones(id) ON DELETE SET NULL,
  data TEXT NOT NULL,
  resultado TEXT NOT NULL,
  observacao TEXT,
  encerrar INTEGER NOT NULL DEFAULT 0,
  criado_em TEXT NOT NULL,
  UNIQUE (cpc_id, one_on_one_id)
);

CREATE TABLE IF NOT EXISTS feedbacks (
  id INTEGER PRIMARY KEY,
  colaborador_id INTEGER NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
  one_on_one_id INTEGER NOT NULL REFERENCES one_on_ones(id) ON DELETE CASCADE,
  pergunta_chave TEXT NOT NULL,
  pergunta TEXT NOT NULL,
  resposta TEXT,
  UNIQUE (one_on_one_id, pergunta_chave)
);

CREATE TABLE IF NOT EXISTS historico (
  id INTEGER PRIMARY KEY,
  tipo TEXT NOT NULL,
  entidade TEXT,
  entidade_id INTEGER,
  colaborador_id INTEGER,
  descricao TEXT NOT NULL,
  data_hora TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS config (
  chave TEXT PRIMARY KEY,
  valor TEXT
);

CREATE INDEX IF NOT EXISTS ix_tarefas_colab ON tarefas(colaborador_id);
CREATE INDEX IF NOT EXISTS ix_tarefas_daily ON tarefas(daily_id);
CREATE INDEX IF NOT EXISTS ix_jobs_colab ON jobs(colaborador_id);
CREATE INDEX IF NOT EXISTS ix_cobrancas_colab ON cobrancas(colaborador_id);
CREATE INDEX IF NOT EXISTS ix_cpc_colab ON cpc(colaborador_id);
CREATE INDEX IF NOT EXISTS ix_hist_data ON historico(data_hora);
`;
