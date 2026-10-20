# Arquitetura

```
 Navegador ──HTTPS──> Caddy ──> web (Fastify: API + interface)  ─┐
                                                                 ├──> PostgreSQL
                         worker (coletor contínuo) ──────────────┘
                              │
                              └──HTTPS──> graph.facebook.com (Business Discovery)
```

- **web** (`src/server`) serve a API autenticada e os arquivos da interface (`dist/web`). Não faz coletas.
- **worker** (`src/worker`) é um processo separado e independente do navegador. Os dois se comunicam só pelo banco.
- **PostgreSQL** guarda os dados, a fila e o estado do worker. Todos os horários ficam em UTC (`timestamptz`) e a exibição usa `America/Campo_Grande` (UTC−4, sem horário de verão).

## Fila e agendamento (durável)

A fila é a própria tabela `instagram_profiles`:

- `next_collection_at`: próxima coleta agendada (`NULL` = parada por erro permanente);
- `manual_requested_at`: pedido manual, que tem prioridade;
- `lease_owner` / `lease_until`: "arrendamento" do perfil enquanto é coletado (10 min).

A cada `WORKER_POLL_SECONDS`, o worker:

1. carrega as configurações e a fonte ativa e para se ela não estiver configurada ou estiver pausada (`provider_state`);
2. calcula a cota restante da hora (`maxRequestsPerHour` menos as execuções da última hora, contadas no banco, o que vale para vários workers);
3. reivindica até `min(concorrência livre, cota)` perfis vencidos com `FOR UPDATE SKIP LOCKED`;
4. coleta, persiste em transação e reagenda.

**Reinício:** pedidos e agendamentos estão no banco. Leases vencidos são retomados, e execuções `running` com mais de 15 min viram `abandoned` na manutenção. O teste `11. persistência após reiniciar o worker` cobre esse fluxo.

**Retentativas:**
- erro temporário: backoff exponencial com jitter (`retryBaseSeconds × 2^(n−1)`, limitado a `retryMaxMinutes`, metade fixa e metade aleatória), respeitando o `retry-after` da fonte;
- erro permanente (perfil não encontrado, campo não suportado): nova tentativa após `permanentRetryHours`; após `maxPermanentFailures`, a coleta para até um pedido manual;
- limite de requisições, token inválido ou fonte não configurada: pausa a fonte inteira.

**Manutenção** (a cada 5 min): marca execuções abandonadas, expira sessões, reavalia alertas que dependem do relógio e aplica a retenção. O worker envia sinal de vida (`worker_heartbeats`) a cada 30 s.

## Integridade dos dados

- `follower_snapshots` é **imutável**: um gatilho impede `UPDATE`. Cada coleta gera uma linha nova com `observed_at`, `collected_at`, `source`, `validity` e `run_id`.
- Uma falha nunca grava zero, nunca apaga histórico e nunca altera `last_success_at` nem `current_*`.
- Um salto de 50% ou mais em até 48 h, em perfis com 1.000 seguidores ou mais, é gravado como `suspect` e fica fora dos cálculos.
- `instagram_profiles.current_*` é só um cache do último valor válido; a fonte da verdade são os snapshots.

## Cálculos (`src/core`)

- **Variação líquida** = atual − anterior. **Percentual** = líquida ÷ anterior × 100. Com anterior igual a zero, o percentual fica indefinido (não vira zero).
- **Período (24 h / 7 d / 30 d):** compara o último snapshot com o último snapshot em `[alvo − tolerância, alvo]`, com tolerância de 25% do período, entre 3 h e 3 dias. Fora disso, o resultado é "histórico insuficiente" ou "sem coleta no início do período", com o intervalo real exibido.
- **Série diária:** o fechamento do dia é o último snapshot válido do dia em Campo Grande. Dias sem coleta ficam `null` e aparecem como lacuna nos gráficos, sem interpolação.
- **Carteira:** soma só os perfis com dados comparáveis e informa quantos foram incluídos. No gráfico de evolução, um dia em que falta algum perfil esperado fica em branco.
- **Diagnóstico:** cada achado informa período e quantidade de dados e não atribui causas.

## Modelo de dados (`migrations/001_init.sql`)

| Tabela | Conteúdo |
|---|---|
| `users` | usuários internos, papel (`admin`/`analyst`/`viewer`), estado, bloqueio por tentativas |
| `sessions` | sessões (só o SHA-256 do token) |
| `clients` | cliente, categoria, observações, status (`active`/`paused`/`archived`), metas e limites, prazo de retenção |
| `instagram_profiles` | @ normalizado (único), URL, id externo (único), estado, agendamento, último valor válido, cobertura de mídia |
| `follower_snapshots` | observações imutáveis |
| `media_items` | publicações deduplicadas por `(profile_id, dedupe_key)`, `published_at` × `first_seen_at` |
| `collection_runs` | cada execução: fonte, início, fim, resultado, código de erro, tentativa, registros |
| `alerts` | tipo, categoria (perfil × coletor), nível, estado, ocorrências, silêncio, reabertura |
| `settings` | parâmetros operacionais (sem segredos) |
| `provider_state` | pausa global por fonte |
| `worker_heartbeats` | saúde dos workers |
| `audit_log` | quem fez o quê (cadastros, edições, exclusões, logins) |

## Alertas

Tipos: `no_posts`, `negative_change`, `low_growth`, `posting_below_goal` (problemas do **perfil**) e `collection_failing`, `stale_data` (problemas do **coletor**). O tipo `profile_unavailable` é do perfil.

- **Deduplicação:** um índice único parcial garante um único alerta ativo por perfil e tipo. Reavaliações só incrementam `occurrences`.
- **Resolução automática:** acontece quando a condição some.
- **Resolução manual:** silencia o mesmo tipo por `alertCooldownHours`. Se a condição persistir depois desse prazo, um **novo** alerta é criado com `reopened_from`.
- **Sem afirmar inatividade:** "sem publicações" só é avaliado quando as publicações foram coletadas com sucesso.
- Não há envio por WhatsApp ou e-mail. Para isso seria preciso configurar uma integração autorizada.

## Segurança

- Sessão por cookie `httpOnly`, `Secure` (produção) e `SameSite=Strict`, com token aleatório de 256 bits. O banco guarda só o hash.
- Senhas com bcrypt (custo 12), mínimo de 12 caracteres. Bloqueio de 15 min após 5 erros, mais limite de 10 tentativas de login por IP a cada 15 min.
- Todas as rotas `/api` exigem login, exceto `login`, `me` e `health`. Papéis são verificados no servidor.
- CSRF: `SameSite=Strict`, cabeçalho obrigatório `X-FZA-CSRF` e checagem de `Origin` em métodos que alteram dados. Não há CORS (mesma origem).
- Entradas validadas com zod e SQL sempre parametrizado. O React escapa o conteúdo (sem `dangerouslySetInnerHTML`). O CSV tem proteção contra injeção de fórmulas.
- Helmet: CSP restritiva (imagens só das CDNs do Instagram/Facebook), `frame-ancestors 'none'` e HSTS em produção.
- Logs estruturados sem cookies, tokens ou senhas.
- O banco não é exposto à internet no docker-compose.
