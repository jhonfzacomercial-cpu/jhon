// Dados de exemplo — datas sempre relativas a hoje, para a demonstração fazer sentido em qualquer dia.
import { transaction } from './db.js';
import { hoje, addDias, addMeses, mesAtual, dataOneAOne, PERGUNTAS_FEEDBACK } from '../shared/constantes.js';

export const TABELAS = [
  'config', 'colaboradores', 'jobs', 'job_historico', 'dailys', 'one_on_ones', 'tarefas', 'tarefa_checklist',
  'tarefa_anexos', 'cobrancas', 'cobranca_contatos', 'cpc', 'cpc_avaliacoes', 'feedbacks', 'historico',
];

export function carregarDemo(db) {
  const H = hoje();
  const d = (n) => addDias(H, n);
  const ts = (n, hora = '09:00:00') => `${d(n)}T${hora}`;
  const ins = (tabela, dados) => {
    const cols = Object.keys(dados);
    return Number(db.prepare(`INSERT INTO ${tabela} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => dados[c] ?? null)).lastInsertRowid);
  };
  const log = (tipo, descricao, n, colaborador_id = null, hora = '09:00:00') => ins('historico', { tipo, descricao, data_hora: ts(n, hora), colaborador_id });

  transaction(db, () => {
    db.exec('PRAGMA defer_foreign_keys = ON');
    for (const t of [...TABELAS].reverse()) if (t !== 'config') db.prepare(`DELETE FROM ${t}`).run();

    const colab = (nome, cargo, area, entrada, horario, dia, obs) =>
      ins('colaboradores', { nome, cargo, area, data_entrada: entrada, status: 'Ativo', daily_horario: horario, one_a_one_dia: dia, observacoes: obs, criado_em: ts(-120), atualizado_em: ts(-120) });
    const ana = colab('Ana', 'Analista de Marketing', 'Planejamento', d(-400), '07:30', 15, 'Boa relação com clientes. Desenvolver visão analítica.');
    const gabriel = colab('Gabriel', 'Designer', 'Criação', d(-250), '07:40', 16, 'Rápido na execução, cuidado com revisões.');
    const alex = colab('Alex', 'Social Media', 'Conteúdo', d(-180), '07:50', 17, 'Em adaptação ao fluxo de aprovação.');
    const cris = colab('Cristhopher', 'Atendimento', 'Atendimento', d(-90), '08:00', 20, 'Ponte com clientes; acompanhar retorno de materiais.');

    const job = (numero, titulo, cliente, colaborador_id, setor, entrada, prazo, status, prioridade, proxima_acao, resp, atualizado = -1) =>
      ins('jobs', { numero, titulo, cliente, colaborador_id, setor, data_entrada: d(entrada), prazo: d(prazo), status, prioridade, proxima_acao, proxima_acao_responsavel: resp, criado_em: ts(entrada), atualizado_em: ts(atualizado), atraso_registrado: prazo < 0 ? 1 : 0 });
    const j041 = job('041', 'Campanha de lançamento', 'Churrascaje', gabriel, 'Criação', -10, -2, 'Em produção', 'Urgente', 'Finalizar peças e enviar para aprovação', 'Gabriel', 0);
    const j038 = job('038', 'Site institucional', 'Vitta Clínica', ana, 'Web', -25, -4, 'Aguardando cliente', 'Alta', 'Receber textos finais', 'Cristhopher', -3);
    const j044 = job('044', 'Calendário editorial de novembro', 'Mercado Bom Preço', alex, 'Conteúdo', -6, 0, 'Em aprovação', 'Alta', 'Aprovação do cliente', 'Alex');
    const j045 = job('045', 'Identidade visual', 'Studio Lume', gabriel, 'Criação', -3, 5, 'Novo', 'Média', 'Briefing com cliente', 'Cristhopher', -3);
    job('046', 'Relatório mensal de mídia', 'Churrascaje', ana, 'Planejamento', -2, 3, 'Em produção', 'Média', 'Consolidar números', 'Ana');
    job('039', 'Vídeo institucional', 'Vitta Clínica', alex, 'Audiovisual', -30, -12, 'Concluído', 'Média', null, null, -12);

    const hist = (job_id, n, texto) => ins('job_historico', { job_id, data: d(n), texto, criado_em: ts(n) });
    hist(j041, -10, 'JOB cadastrado');
    hist(j041, -4, 'Cobrado Cristhopher sobre o material do cliente');
    hist(j041, -3, 'Ainda aguardando material');
    hist(j041, -2, 'Nova cobrança realizada');
    hist(j041, -1, 'Material recebido');
    hist(j041, 0, 'Em produção');
    hist(j038, -25, 'JOB cadastrado');
    hist(j038, -6, 'Layout aprovado');
    hist(j038, -3, 'Aguardando textos finais do cliente');
    hist(j044, -6, 'JOB cadastrado');
    hist(j044, -1, 'Enviado para aprovação');

    const tarefa = (dados) => ins('tarefas', { categoria: 'Gestão', prioridade: 'Média', status: 'A fazer', origem: 'manual', criado_em: ts(-3), atualizado_em: ts(-1), ...dados });
    // Minhas tarefas
    const t1 = tarefa({ titulo: 'Revisar proposta comercial Studio Lume', categoria: 'Comercial', prioridade: 'Alta', prazo: d(0), descricao: 'Ajustar escopo e valores antes de enviar.' });
    tarefa({ titulo: 'Fechar fluxo de caixa de outubro', categoria: 'Financeiro', prioridade: 'Urgente', prazo: d(-1), atraso_registrado: 1 });
    tarefa({ titulo: 'Reunião de alinhamento com Churrascaje', categoria: 'Reunião', prioridade: 'Alta', prazo: d(0), hora: '14:00' });
    tarefa({ titulo: 'Reunião com diretoria — resultados do trimestre', categoria: 'Reunião', prioridade: 'Alta', prazo: d(0), hora: '17:00' });
    tarefa({ titulo: 'Documentar processo de aprovação de peças', categoria: 'Processos', prioridade: 'Média', prazo: d(3), status: 'Em andamento' });
    tarefa({ titulo: 'Retorno do jurídico sobre contrato Vitta', categoria: 'Cliente', prioridade: 'Média', prazo: d(2), status: 'Aguardando' });
    tarefa({ titulo: 'Planejamento estratégico 2027', categoria: 'Estratégia', prioridade: 'Baixa', prazo: d(10) });
    tarefa({ titulo: 'Enviar NF do mês para o financeiro', categoria: 'Financeiro', prioridade: 'Média', prazo: d(-1), status: 'Concluído', concluido_em: ts(-1, '16:00:00') });
    [['Conferir horas do escopo', 1], ['Validar valores com o financeiro', 0], ['Enviar para o cliente', 0]].forEach(([texto, feito], i) => ins('tarefa_checklist', { tarefa_id: t1, texto, feito, ordem: i }));

    // Dailys dos últimos dias
    const daily = (colaborador_id, n, bloqueios, observacoes, combinados, itens) => {
      const id = ins('dailys', { colaborador_id, data: d(n), bloqueios, observacoes, combinados, criado_em: ts(n, '07:35:00'), atualizado_em: ts(n, '07:35:00') });
      for (const [titulo, status, extra = {}] of itens) {
        tarefa({ titulo, status, colaborador_id, categoria: 'Equipe', origem: 'daily', daily_id: id, prazo: d(n), criado_em: ts(n, '07:35:00'), atualizado_em: ts(n, status === 'Concluído' ? '17:00:00' : '07:35:00'), concluido_em: status === 'Concluído' ? ts(n, '17:00:00') : null, atraso_registrado: status !== 'Concluído' && n < 0 ? 1 : 0, ...extra });
      }
      log('daily_realizada', `Daily realizada com ${['', 'Ana', 'Gabriel', 'Alex', 'Cristhopher'][colaborador_id]} — ${itens.length} tarefa(s)${bloqueios ? ', 1 bloqueio' : ''}`, n, colaborador_id, '07:35:00');
      return id;
    };
    daily(ana, -2, null, 'Bom ritmo.', 'Enviar status do site ao fim do dia.', [['Atualizar site Vitta (home)', 'Concluído'], ['Relatório de mídia Churrascaje', 'Concluído']]);
    daily(ana, -1, 'Aguardando textos do cliente Vitta', null, 'Cristhopher vai cobrar o cliente.', [['Atualizar site Vitta (páginas internas)', 'A fazer', { reagendamentos: 1 }], ['Planejar posts do Mercado Bom Preço', 'Concluído']]);
    daily(gabriel, -1, 'Material do Churrascaje não chegou', 'Priorizar JOB 041 assim que o material chegar.', null, [['Finalizar JOB 041 — peças de feed', 'Em andamento'], ['Ajustar logo Studio Lume', 'Concluído']]);
    daily(alex, -2, null, null, null, [['Agendar posts da semana', 'Concluído'], ['Responder comentários', 'A fazer', { reagendamentos: 2 }]]);
    daily(alex, -1, 'Dúvida sobre aprovação do calendário', 'Reforçar o fluxo de aprovação.', 'Enviar calendário para aprovação até 12h.', [['Enviar calendário para aprovação', 'Concluído'], ['Roteiro de reels', 'A fazer']]);
    daily(ana, 0, null, 'Focada em fechar o site hoje.', 'Me avisar se o texto não chegar até 14h.', [['Finalizar páginas internas do site Vitta', 'Em andamento'], ['Revisar relatório de mídia', 'A fazer']]);

    // Cobranças
    const cob = (dados) => ins('cobrancas', { status: 'Pendente', criado_em: ts(-3), atualizado_em: ts(-1), ...dados });
    const c1 = cob({ descricao: 'Atualização do site Vitta', colaborador_id: ana, data: d(-2), prazo: d(1), status: 'Aguardando', ultimo_contato: d(-1), proximo_followup: d(0), job_id: j038 });
    const c2 = cob({ descricao: 'Material do cliente Churrascaje', colaborador_id: cris, data: d(-4), prazo: d(-2), status: 'Cobrado', ultimo_contato: d(-2), proximo_followup: d(0), job_id: j041, observacao: 'Cliente prometeu envio, mas ainda faltam fotos.' });
    cob({ descricao: 'Aprovação do calendário editorial', pessoa: 'Cliente Mercado Bom Preço', data: d(-1), prazo: d(1), status: 'Aguardando', ultimo_contato: d(-1), proximo_followup: d(1), job_id: j044 });
    cob({ descricao: 'Pagamento da fatura de setembro', pessoa: 'Financeiro Studio Lume', data: d(-6), prazo: d(-3), status: 'Sem retorno', ultimo_contato: d(-3), proximo_followup: d(-1) });
    cob({ descricao: 'Respostas de comentários em atraso', colaborador_id: alex, data: d(0), prazo: d(1) });
    ins('cobranca_contatos', { cobranca_id: c1, data: d(-1), texto: 'Ana disse que depende do texto do cliente.', criado_em: ts(-1) });
    ins('cobranca_contatos', { cobranca_id: c2, data: d(-4), texto: 'Pedi para cobrar o cliente.', criado_em: ts(-4) });
    ins('cobranca_contatos', { cobranca_id: c2, data: d(-2), texto: 'Nova cobrança realizada.', criado_em: ts(-2) });

    // One a One do mês passado (finalizado) + CPC acompanhável
    const mesAnt = addMeses(mesAtual(), -1);
    const ooo = (colaborador_id, mes, dia, status, dados = {}) =>
      ins('one_on_ones', { colaborador_id, mes, data: dataOneAOne(mes, dia), status, criado_em: ts(-35), atualizado_em: ts(-30), ...dados });
    const cpc = (colaborador_id, one_on_one_id, tipo, descricao, extra = {}) =>
      ins('cpc', { colaborador_id, one_on_one_id, tipo, descricao, status: 'Em acompanhamento', proxima_avaliacao: mesAtual(), criado_em: ts(-30), atualizado_em: ts(-30), ...extra });

    const oAna = ooo(ana, mesAnt, 15, 'Finalizado', {
      pontos_positivos: 'Ótima comunicação com clientes; entregas no prazo.',
      pontos_atencao: 'Demandas ficam sem atualização no sistema.',
      compromissos_gestor: 'Dar mais autonomia nas decisões de planejamento',
      compromissos_colaborador: 'Atualizar status das demandas diariamente',
      finalizado_em: ts(-30), proxima_avaliacao: dataOneAOne(mesAtual(), 15),
    });
    cpc(ana, oAna, 'Continuar', 'Manter boa comunicação com os clientes');
    cpc(ana, oAna, 'Parar', 'Deixar demandas sem atualização no sistema');
    cpc(ana, oAna, 'Começar', 'Ser mais analítica antes de tomar decisões');
    const resp = { sentimento: 'Motivada, mas um pouco sobrecarregada no fim do mês.', dificuldade: 'Retorno lento dos clientes trava o meu trabalho.', gestor: 'Dar retornos mais rápidos nas aprovações internas.', processo: 'O fluxo de aprovação com cliente precisa de prazo definido.', sugestao: 'Criar um checklist de briefing padrão.', autoavaliacao: 'Evoluí na organização, ainda preciso melhorar a análise.' };
    for (const p of PERGUNTAS_FEEDBACK) ins('feedbacks', { colaborador_id: ana, one_on_one_id: oAna, pergunta_chave: p.chave, pergunta: p.pergunta, resposta: resp[p.chave] });

    const oGab = ooo(gabriel, mesAnt, 16, 'Finalizado', { pontos_positivos: 'Velocidade de entrega.', pontos_atencao: 'Revisões com erros simples.', finalizado_em: ts(-29), proxima_avaliacao: dataOneAOne(mesAtual(), 16) });
    cpc(gabriel, oGab, 'Começar', 'Revisar peças com checklist antes de enviar');
    cpc(gabriel, oGab, 'Continuar', 'Propor ideias criativas nas reuniões');

    const oAlex = ooo(alex, mesAnt, 17, 'Finalizado', { pontos_atencao: 'Atrasos nas respostas a comentários.', finalizado_em: ts(-28), proxima_avaliacao: dataOneAOne(mesAtual(), 17) });
    const pAlex = cpc(alex, oAlex, 'Parar', 'Deixar comentários sem resposta por mais de 24h');
    // Um histórico mais antigo para mostrar evolução
    const mesAnt2 = addMeses(mesAtual(), -2);
    const oAlex2 = ooo(alex, mesAnt2, 17, 'Finalizado', { finalizado_em: ts(-60) });
    const pAlex2 = cpc(alex, oAlex2, 'Começar', 'Planejar a semana na segunda-feira', { criado_em: ts(-60), proxima_avaliacao: mesAtual() });
    ins('cpc_avaliacoes', { cpc_id: pAlex2, one_on_one_id: oAlex, data: dataOneAOne(mesAnt, 17), resultado: 'Não cumpriu', observacao: 'Ainda planeja no dia a dia, sem visão da semana.', criado_em: ts(-28) });
    void pAlex;

    log('one_a_one_realizado', 'One a One finalizado com Ana — 3 CPC novo(s)', -30, ana);
    log('one_a_one_realizado', 'One a One finalizado com Gabriel — 2 CPC novo(s)', -29, gabriel);
    log('one_a_one_realizado', 'One a One finalizado com Alex — 1 CPC novo(s), 1 avaliado(s)', -28, alex);
    log('cobranca_realizada', 'Cobrança realizada: Material do cliente Churrascaje (Cristhopher)', -2, cris);
    log('tarefa_concluida', 'Tarefa concluída: Enviar NF do mês para o financeiro', -1, null, '16:00:00');
  });
}
