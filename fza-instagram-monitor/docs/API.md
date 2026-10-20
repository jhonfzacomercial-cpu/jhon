# API HTTP

Base: `/api`. Respostas em JSON e datas em ISO 8601 (UTC).

- **Autenticação:** cookie de sessão `fza_session`, obtido em `POST /api/auth/login`.
- **Métodos que alteram dados** (`POST`/`PATCH`/`DELETE`) exigem o cabeçalho `X-FZA-CSRF: 1`. Se houver `Origin`, ela precisa ser igual a `APP_ORIGIN`.
- **Papéis:** `viewer` só lê; `analyst` gerencia clientes, coletas e alertas; `admin` faz tudo, inclusive configurações, usuários e exclusão definitiva.
- **Erros:** `{ "error": "<código>", "message": "<texto>", "issues"?: [{ "path", "message" }] }`. Códigos HTTP: 400 validação, 401 sem login, 403 sem permissão ou CSRF, 404, 409 conflito ou duplicidade, 429 excesso de tentativas.

## Autenticação

| Método | Rota | Corpo / resposta |
|---|---|---|
| POST | `/auth/login` | `{ email, password }` → `{ user }` + cookie. Limite de 10 por 15 min por IP |
| POST | `/auth/logout` | encerra a sessão |
| GET | `/auth/me` | `{ user }` ou `{}` |
| GET | `/health` | `{ ok: true }` (público, testa o banco) |

## Clientes

| Método | Rota | Papel | Descrição |
|---|---|---|---|
| GET | `/clients?search&status=all\|active\|paused\|archived\|attention&sort=name\|followers\|change7d\|change30d\|lastSuccess\|alerts&dir&page&pageSize` | viewer | lista paginada com resumo (seguidores, variações 24h/7d/30d, estado, próxima coleta) |
| POST | `/clients` | analyst | `{ name, instagram, category?, notes?, postingGoalPerWeek?, inactivityAlertDays?, negativeChangeThreshold?, growthGoalPct30d? }`. O @ é normalizado; responde 409 se duplicado |
| GET | `/clients/:id` | viewer | detalhe: resumo, crescimento, último snapshot com qualidade, publicações, diagnóstico, capacidades da fonte |
| PATCH | `/clients/:id` | analyst | edição parcial; trocar `instagram` mantém o histórico |
| POST | `/clients/:id/pause` · `/resume` | analyst | pausa ou reativa o monitoramento |
| POST | `/clients/:id/archive` | analyst | `{ confirmUsername }`: arquiva e agenda a exclusão para o fim do prazo de retenção |
| POST | `/clients/:id/restore` | analyst | restaura (fica pausado) |
| DELETE | `/clients/:id` | admin | `{ confirmUsername, confirmText: "EXCLUIR DEFINITIVAMENTE" }`, só para arquivados |
| POST | `/clients/:id/collect` | analyst | coleta manual (fila prioritária) |
| GET | `/clients/:id/series?from=YYYY-MM-DD&to=YYYY-MM-DD` | viewer | série diária (fechamento e variação; `null` = sem coleta), melhor e pior dia |
| GET | `/clients/:id/snapshots?limit` | viewer | snapshots brutos |
| GET | `/clients/:id/history` | viewer | auditoria do cliente |

## Painéis

| Método | Rota | Descrição |
|---|---|---|
| GET | `/overview?from&to&clientIds=a,b` | indicadores da carteira e dados dos gráficos (evolução, variação diária, semanal e mensal, por cliente, publicações) |
| GET | `/media?clientId&type&from&to&page&pageSize` | publicações observadas |
| GET | `/runs?status&clientId&errorCode&page` | execuções de coleta |
| GET | `/alerts?status=active\|open\|acknowledged\|resolved\|all&category=profile\|collector&clientId&page` | central de alertas |
| POST | `/alerts/:id/acknowledge` · `/resolve` | analyst |

## Configurações e sistema

| Método | Rota | Papel | Descrição |
|---|---|---|---|
| GET | `/settings` | viewer | parâmetros e fontes (só indica se o token existe, nunca o valor) |
| PATCH | `/settings` | admin | atualização parcial validada |
| GET | `/system/status` | viewer | worker, fila, cota usada, pausa da fonte, última e próxima execução |
| GET | `/system/diagnostics` | admin | erros por código, erros recentes, perfis parados, tamanho do banco |
| POST | `/system/provider/resume` | admin | remove a pausa da fonte |
| GET/POST/PATCH | `/users`, `/users/:id` | admin | gestão de usuários (desativar ou trocar a senha encerra as sessões) |

## Exportação (CSV, `;`, UTF-8 com BOM)

`/export/clients.csv`, `/export/snapshots.csv?clientId`, `/export/media.csv?clientId`. Os horários vêm em UTC e no horário local.
