// Vocabulário do sistema — compartilhado entre servidor e interface.

export const CATEGORIAS = ['Gestão', 'Comercial', 'Cliente', 'Equipe', 'Financeiro', 'Processos', 'Reunião', 'Cobrança', 'Estratégia', 'Outros'];

export const STATUS_TAREFA = ['A fazer', 'Em andamento', 'Aguardando', 'Concluído', 'Atrasado'];

export const PRIORIDADES = ['Urgente', 'Alta', 'Média', 'Baixa'];
export const PRIORIDADE_ICONE = { Urgente: '🔴', Alta: '🟠', Média: '🟡', Baixa: '🟢' };
export const PRIORIDADE_PESO = { Urgente: 0, Alta: 1, Média: 2, Baixa: 3 };

export const STATUS_JOB = ['Novo', 'Em produção', 'Em aprovação', 'Aguardando cliente', 'Aguardando equipe', 'Concluído', 'Cancelado', 'Atrasado'];
export const JOB_FECHADO = ['Concluído', 'Cancelado'];

export const STATUS_COBRANCA = ['Pendente', 'Cobrado', 'Aguardando', 'Resolvido', 'Sem retorno'];

export const STATUS_COLABORADOR = ['Ativo', 'Férias', 'Afastado', 'Desligado'];

export const TIPOS_CPC = ['Continuar', 'Parar', 'Começar'];
export const STATUS_CPC = ['Em acompanhamento', 'Concluído', 'Encerrado'];
export const RESULTADOS_CPC = ['Cumpriu', 'Parcialmente cumpriu', 'Não cumpriu'];
export const RESULTADO_ICONE = { Cumpriu: '🟢', 'Parcialmente cumpriu': '🟡', 'Não cumpriu': '🔴' };

export const PERGUNTAS_FEEDBACK = [
  { chave: 'sentimento', pergunta: 'Como você está se sentindo no trabalho?' },
  { chave: 'dificuldade', pergunta: 'Existe alguma dificuldade que você está enfrentando?' },
  { chave: 'gestor', pergunta: 'O que eu, como gestor, poderia fazer melhor?' },
  { chave: 'processo', pergunta: 'Existe algum processo da empresa que você acha que precisa melhorar?' },
  { chave: 'sugestao', pergunta: 'Você tem alguma sugestão?' },
  { chave: 'autoavaliacao', pergunta: 'Como você avalia sua evolução no último mês?' },
];

export const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

/** Dias sem movimentação a partir dos quais um item vira "sem atualização". */
export const DIAS_SEM_ATUALIZACAO = 3;
/** Janela (em dias) considerada "próximos". */
export const DIAS_PROXIMOS = 7;

// ---------- datas (sempre strings locais YYYY-MM-DD) ----------

const pad = (n) => String(n).padStart(2, '0');

export const isoData = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hoje = () => isoData(new Date());
export const agora = () => {
  const d = new Date();
  return `${isoData(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
export const parseData = (s) => {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const addDias = (s, n) => {
  const d = parseData(s);
  d.setDate(d.getDate() + n);
  return isoData(d);
};
export const diffDias = (a, b) => Math.round((parseData(a) - parseData(b)) / 86400000);
export const mesDe = (s) => s.slice(0, 7);
export const mesAtual = () => mesDe(hoje());
export const addMeses = (mes, n) => {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
export const nomeMes = (mes) => {
  const [y, m] = mes.split('-').map(Number);
  return `${MESES[m - 1]}/${y}`;
};
export const diasNoMes = (mes) => {
  const [y, m] = mes.split('-').map(Number);
  return new Date(y, m, 0).getDate();
};

/** Data do One a One no mês, respeitando o dia preferido e evitando fim de semana. */
export const dataOneAOne = (mes, dia = 15) => {
  const ultimo = diasNoMes(mes);
  let d = parseData(`${mes}-${pad(Math.min(Math.max(1, dia), ultimo))}`);
  if (d.getDay() === 6) d.setDate(d.getDate() - 1);
  if (d.getDay() === 0) d.setDate(d.getDate() + (d.getDate() < ultimo ? 1 : -2));
  return isoData(d);
};

// ---------- regras de atraso ----------

export const tarefaAtrasada = (t, ref = hoje()) => t.status !== 'Concluído' && (t.status === 'Atrasado' || (!!t.prazo && t.prazo < ref));
export const jobAtrasado = (j, ref = hoje()) => !JOB_FECHADO.includes(j.status) && (j.status === 'Atrasado' || (!!j.prazo && j.prazo < ref));
export const cobrancaAberta = (c) => c.status !== 'Resolvido';
export const cobrancaVencida = (c, ref = hoje()) => cobrancaAberta(c) && !!c.prazo && c.prazo < ref;
export const cobrarHoje = (c, ref = hoje()) =>
  cobrancaAberta(c) && (c.proximo_followup ? c.proximo_followup <= ref : c.status === 'Pendente');

/** Normaliza texto para busca: minúsculas e sem acentos. */
export const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
