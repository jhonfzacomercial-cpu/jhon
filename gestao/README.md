# FZA Gestão — painel de comando do gerente

Sistema web de gestão gerencial pessoal do Jhonatas (Gerente do Grupo FZA): **Meu Dia → Daily → Tarefas → JOBs → Cobranças → One a One → CPC → Evolução**, com histórico automático, busca global e alertas.

## Como rodar

Requer **Node.js 22.13 ou mais novo** (o banco é o SQLite embutido no Node, sem instalar nada além).

```bash
cd gestao
npm install
npm run build      # compila a interface
npm start          # abre em http://localhost:3001
```

- Dados de exemplo: `npm run seed` (ou o botão "Carregar exemplo" na primeira tela / em Configurações).
- Desenvolvimento com recarga automática: `npm run dev` → http://localhost:5173
- Testes da API: `npm test`

### Variáveis de ambiente

| Variável | Para quê | Padrão |
| --- | --- | --- |
| `PORT` | porta do servidor | `3001` |
| `APP_PASSWORD` | exige senha para entrar (recomendado se ficar acessível na internet) | sem senha |
| `DATA_DIR` | pasta do banco (`gestao.db`) e dos anexos (`uploads/`) | `./data` |
| `TZ` | fuso usado para "hoje" e atrasos | `America/Sao_Paulo` |

## Versão hospedada no claude.ai (gratuita)

`npm run build:artifact` gera `dist-artifact/fza-gestao.html`: a mesma API roda no navegador (SQLite via sql.js) e cada registro alterado é gravado no armazenamento da página no claude.ai. Anexos ficam no armazenamento de arquivos da página e o backup é baixado pelo próprio claude.ai. Só o dono (e quem ele tornar Editor) lê e altera os dados.

## Publicar na internet (Render)

O arquivo `render.yaml` na raiz do repositório já configura tudo (Node 22, build, disco persistente de 1 GB, fuso de São Paulo, senha de acesso).

1. Crie uma conta em https://render.com entrando com o GitHub.
2. **New → Blueprint** e escolha o repositório `jhon` (autorize o Render a ver o repositório, se pedir).
3. O Render lê o `render.yaml` e pede o valor de **APP_PASSWORD**: digite a senha que você vai usar para entrar.
4. Clique em **Apply / Deploy**. Em poucos minutos o endereço aparece no painel do serviço (algo como `https://fza-gestao.onrender.com`).

Custo: plano Starter (~US$ 7/mês) + disco (~US$ 0,25/GB/mês). O disco é o que guarda os dados entre atualizações. Cada novo commit no branch configurado em `render.yaml` publica a nova versão automaticamente. Faça backup de vez em quando em **Configurações → Baixar backup**.

## O que tem

| Área | Destaques |
| --- | --- |
| **Meu Dia** (tela inicial) | Resumo do dia, indicadores ATRASADOS / HOJE / PRÓXIMOS / AGUARDANDO / COBRAR (clicáveis), Dailys do dia com horário, preciso fazer, preciso cobrar, acompanhar equipe, reuniões, JOBs atrasados, CPC/desenvolvimento |
| **Painel gerencial** | Atenção do gerente (🔴 JOBs/tarefas atrasados, cobranças vencidas · 🟠 follow-ups de hoje, pendências sem atualização · 🟡 One a Ones próximos, CPCs a avaliar · 🟢 concluídas hoje), tabela da equipe ordenada por quem precisa de atenção, atividade recente |
| **Daily** | Escolhe data e colaborador; adiciona tarefas do dia com Enter, bloqueios, combinados e observações; decide pendências anteriores (✓ feita / → hoje); "Salvar Daily → próximo" segue para o próximo colaborador. Cada item vira tarefa; o que não for concluído volta como pendência |
| **Minha Agenda** | Tarefas minhas, da equipe ou todas; lista agrupada (atrasadas, hoje, amanhã…) ou Kanban com arrastar; categorias, prioridades, checklist, anexos, horário para reuniões |
| **JOBs** | Tabela ou Kanban, filtros (atrasados, hoje, próximos, responsável, cliente, status, prioridade), página do JOB com histórico de acompanhamento datado, próxima ação, cobranças e tarefas vinculadas |
| **Cobranças** | Cadastro em uma linha (o quê, de quem, quando cobrar), botão "Cobrei" que agenda o próximo follow-up, histórico de contatos, vínculo com JOB |
| **Equipe / Perfil** | Perfil gerencial com Daily (linha do tempo), tarefas, pendências recorrentes, bloqueios, cobranças, JOBs, One a Ones, CPC/Evolução, feedbacks do colaborador e histórico |
| **One a One** | Criado automaticamente todo mês; avaliação dos CPCs anteriores (Cumpriu / Parcialmente / Não cumpriu + observação), novos pontos Continuar/Parar/Começar, 6 perguntas de feedback, fechamento com compromissos (viram tarefas), FINALIZAR e próximo One a One agendado. Rascunho salva sozinho |
| **Histórico** | Todos os eventos (tarefa criada/concluída/atrasada, cobrança feita/resolvida, Daily, One a One, CPC criado/avaliado…) com filtros |
| **Busca global** | `Ctrl K` ou `/` — "JOB 041" acha o JOB, o histórico, cobranças e tarefas relacionadas; "Ana" acha perfil, Dailys, One a Ones, CPC, tarefas e feedbacks |

Atalhos: `T` nova tarefa · `C` nova cobrança · `J` novo JOB · `D` Daily · `Ctrl K` busca.

## Regras automáticas

- Tarefa com prazo vencido e não concluída → **Atrasada** (registrada no histórico uma vez).
- JOB com prazo vencido e não concluído/cancelado → destacado como atrasado e anotado no histórico do JOB.
- Cobrança com follow-up para hoje (ou vencido) → aparece em **Preciso cobrar**.
- One a One do mês criado automaticamente para cada colaborador ativo (desligável em Configurações).
- CPC em acompanhamento cuja avaliação venceu → aparece no painel e no perfil.
- Tarefa de Daily não concluída → volta como pendência na próxima Daily; se for reagendada 2× vira **pendência recorrente**.
- Item sem movimentação há 3 dias → **pendência sem atualização**.

## Arquitetura

```
gestao/
  server/        API Express + SQLite (node:sqlite)
    db.js          esquema do banco
    app.js         rotas REST
    regras.js      atrasos, indicadores, alertas, visão da equipe
    automacoes.js  atraso automático e One a One mensal
    seed.js        dados de exemplo
    tests/         testes de fluxo da API
  shared/        constantes e regras de data usadas no servidor e na interface
  src/           interface React (Vite)
```

Principais tabelas: `colaboradores`, `tarefas` (+ `tarefa_checklist`, `tarefa_anexos`), `jobs` (+ `job_historico`), `dailys` (os itens da Daily são `tarefas` com `daily_id`), `cobrancas` (+ `cobranca_contatos`), `one_on_ones`, `cpc` (+ `cpc_avaliacoes`, uma por One a One), `feedbacks`, `historico`, `config`.
