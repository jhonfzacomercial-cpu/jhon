# Provedor de dados: Meta — Instagram Business Discovery

Adaptador: `src/providers/meta.ts`. Contrato comum a todas as fontes: `src/providers/types.ts`.

## Como funciona

A conta **profissional do Instagram da FZA** consulta outros perfis profissionais pelo @:

```
GET https://graph.facebook.com/{META_GRAPH_API_VERSION}/{META_IG_USER_ID}
    ?fields=business_discovery.username(<alvo>){id,username,name,profile_picture_url,
             followers_count,follows_count,media_count,
             media.limit(N){id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count}}
    &access_token=<token>&appsecret_proof=<hmac>
```

- A consulta precisa de autorização da FZA, mas não dos perfis consultados.
- O token fica só nas variáveis de ambiente do servidor e do worker. Ele nunca vai para o navegador, para o banco ou para os logs (as mensagens de erro passam por `redactSecrets`).
- Publicações são solicitadas no máximo a cada `mediaIntervalMinutes`, para economizar cota.

## Configuração (passo a passo)

1. Converta o Instagram da FZA em **conta profissional** (Business ou Creator) e vincule-o a uma **Página do Facebook**.
2. Em developers.facebook.com, crie um app do tipo Business e adicione **Facebook Login for Business**. O "Instagram Login" não oferece Business Discovery.
3. Gere um token de usuário com `instagram_basic` e `pages_read_engagement`. Se a Página tiver papel via Business Manager, inclua também `ads_read` ou `ads_management`. Depois troque esse token por um **token de longa duração**.
4. Descubra o ID da conta do Instagram: `GET /{page-id}?fields=instagram_business_account`.
5. Configure `META_IG_USER_ID`, `META_ACCESS_TOKEN` e, se quiser, `META_APP_SECRET` no `.env` do servidor.
6. Valide com `npm run provider:check -- <@ de um perfil profissional>`. O comando imprime o que a fonte devolveu e quais campos vieram vazios.
7. Rode o E2E real em um banco de teste separado:
   `META_IG_USER_ID=... META_ACCESS_TOKEN=... META_E2E_USERNAME=<perfil> npx vitest run tests/e2e-real.test.ts`

**[confirmar no 1º teste]**
- Se, para uso interno com administradores do app, o acesso Standard basta ou se é preciso App Review e Advanced Access.
- Se o campo `media_product_type` (que identificaria Reels) é aceito dentro de `business_discovery`. Se for, o adaptador pode passar a separar Reels.

**Renovação do token:** tokens de longa duração expiram (cerca de 60 dias, segundo a Meta). Quando expirar, o worker recebe `PROVIDER_AUTH_FAILED`, pausa a fonte por 30 minutos e gera alerta de coletor. Renove o token e reinicie web e worker.

## Mapeamento de campos

| Sistema | Meta | Observações |
|---|---|---|
| `followers_count` (snapshot) | `followers_count` | ausente → `null`, nunca zero; sem total, a coleta fica "parcial" e não gera snapshot |
| `follows_count` | `follows_count` | |
| `media_count` | `media_count` | total de publicações do perfil |
| `media_items.external_id` | `media.id` | chave de deduplicação |
| `media_type` | `IMAGE` → imagem, `CAROUSEL_ALBUM` → carrossel, `VIDEO` → vídeo | Reels vêm como `VIDEO` |
| `published_at` | `timestamp` | data de publicação (diferente de `first_seen_at`, quando o sistema a viu) |
| `thumbnail_url` | `media_url` (só imagem/carrossel) | vídeo não tem miniatura nesta consulta |
| `observed_at` | horário da resposta | a Meta não informa outro horário de observação |

**Deduplicação:** pelo `id` da Meta. Se uma fonte futura não fornecer id, a chave alternativa documentada é `permalink:<url>`.

**Publicação mais recente:** é o maior `timestamp` entre as publicações observadas, e não a primeira da lista (publicações fixadas no topo podem ser antigas).

**Cobertura:** a Meta devolve as N publicações mais recentes. Quando há mais páginas, o sistema só tem certeza de ter visto tudo a partir da mais antiga retornada (`media_coverage_start`). Contagens que começam antes disso aparecem como "pelo menos N".

## Erros

| Resposta da Meta | Código no sistema | Comportamento |
|---|---|---|
| `code 110` / `subcode 2207013` | `PROFILE_NOT_FOUND_OR_PERSONAL` | problema do perfil; tenta de novo a cada 24 h; após 3 falhas, para até nova tentativa manual |
| `code 190`, `102`, `10`, `2xx` | `PROVIDER_AUTH_FAILED` | problema do coletor; pausa a fonte por 30 min |
| `code 4`, `17`, `32`, `613`, `80002`, HTTP 429 | `RATE_LIMITED` | pausa a fonte pelo tempo indicado em `x-business-use-case-usage`/`x-app-usage` (mínimo 15 min) |
| `code 100` com campo inexistente | `UNSUPPORTED_FIELD` | erro permanente |
| `code 1`, `2`, `is_transient`, HTTP 5xx, falha de rede | `SOURCE_UNAVAILABLE` | backoff exponencial com jitter |
| sem resposta no prazo (20 s) | `TIMEOUT` | backoff |
| JSON fora do formato | `INVALID_RESPONSE` | backoff |

A API não distingue "perfil inexistente", "conta pessoal", "@ alterado" e "restrição de idade". Por isso o sistema mostra uma mensagem única que cobre todas essas possibilidades.

## Limites

- Meta: 200 chamadas por hora × número de usuários do app, compartilhadas com consultas de hashtag. O padrão do sistema é 150/h (`maxRequestsPerHour`), com 1 chamada por perfil por coleta.
- Com intervalo de 60 min, isso comporta cerca de 150 perfis. Para mais perfis, aumente o intervalo.

## O que esta fonte NÃO oferece

- Seguidores ganhos e perdidos separadamente: só existem nos Insights, com autorização do dono da conta.
- Histórico anterior ao cadastro (sem backfill).
- Perfis pessoais.
- Alcance, impressões e visitas (métricas internas).
- Tempo real: a atualização segue o intervalo configurado.

## Trocar ou somar fontes

Implemente `ProfileProvider` (`src/providers/types.ts`), registre o adaptador em `src/providers/registry.ts` e declare as `capabilities` com honestidade. A interface usa essas capacidades para mostrar o que é ou não suportado.
