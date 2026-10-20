# FASE 1 — Viabilidade técnica das fontes de dados

Status: **concluída — aguardando confirmação da fonte principal pela FZA.**
Data da avaliação: 2026-10-20.

> Observação de método: o ambiente de desenvolvimento usado nesta fase bloqueia
> o acesso de rede a `developers.facebook.com`, `graph.facebook.com`,
> `apify.com` e `api.apify.com`. As informações abaixo vêm de buscas na
> documentação oficial e em resumos dela; **nenhuma chamada real foi feita**.
> Itens marcados com **[confirmar]** precisam ser validados no primeiro teste
> real com credenciais.

## 1. O que é público x o que é métrica interna

| Dado | Visível publicamente | Precisa de Insights (autorização do dono) |
|---|---|---|
| Total atual de seguidores | Sim | — |
| Variação líquida entre duas coletas | Sim (calculada pelo sistema) | — |
| Seguidores ganhos / perdidos separadamente | **Não** | Sim |
| Total de publicações, datas, tipo, link | Sim (perfis públicos) | — |
| Alcance, impressões/visualizações, visitas | Não | Sim |

Conclusão: monitorando apenas pelo @, o sistema exibirá **somente a variação
líquida calculada**, nunca "novos seguidores" ou "unfollows".

## 2. Fontes avaliadas

### 2.1 API oficial da Meta — Business Discovery (recomendada)

- Requisição: `GET /{ig-user-id-da-FZA}?fields=business_discovery.username(<@>){...}`.
- Exige que a **conta da FZA** seja profissional, vinculada a uma Página do
  Facebook, com app Meta usando **Facebook Login for Business** (o caminho
  "Instagram Login" não suporta Business Discovery).
- Permissões: `instagram_basic`, `pages_read_engagement`; se a Página tiver
  papel via Business Manager, também `ads_read` ou `ads_management`.
- Não exige autorização dos perfis consultados. O sistema guarda **um token**,
  nunca senha.
- Campos do perfil: `id`, `ig_id`, `username`, `name`, `biography`, `website`,
  `profile_picture_url`, `followers_count`, `follows_count`, `media_count`.
- Campos de mídia (aninhados em `media`, paginados por cursor): `id`,
  `caption`, `comments_count`, `like_count`, `media_type`
  (IMAGE / VIDEO / CAROUSEL_ALBUM), `media_url`, `permalink`, `timestamp`,
  `children`.
- Limitações:
  - Só perfis **Business ou Creator**; pessoais não são retornados e o erro
    não distingue "inexistente" de "pessoal".
  - Contas com restrição de idade não retornam dados.
  - `media_url` omitido em vídeos com áudio licenciado.
  - Distinção Reel x vídeo (`media_product_type`) **não confirmada** neste
    endpoint **[confirmar]**.
  - Rate limit: 200 chamadas/hora × número de usuários do app (compartilhado
    com hashtags).
  - Nível de acesso: se uso interno por administradores do app basta com
    Standard Access ou se exige App Review **[confirmar]**.
- Custo: gratuito.

### 2.2 Provedores de dados públicos (alternativa opcional)

- **Apify — `apify/instagram-profile-scraper`**: a partir de ~US$ 1,60 por
  1.000 perfis; retorna seguidores, total de posts e posts recentes. Chamada via
  `POST /v2/acts/{actor}/run-sync-get-dataset-items` (limite de 300 s).
  Nomes exatos dos campos de saída **[confirmar com execução real]**.
- HikerAPI, EnsembleData, ScrapeCreators, Bright Data: preços e coberturas
  divergentes entre fontes (a maioria das comparações é escrita pelos próprios
  fornecedores). Alguns acessam dados por trás do login — **descartados**.
- Risco: os Termos do Instagram restringem coleta automatizada. A decisão
  *Meta v. Bright Data* (N.D. Cal., 2024) favoreceu a coleta **deslogada** de
  dados públicos, mas é decisão de primeira instância. Uso fica a critério da
  FZA, desligado por padrão.

### 2.3 Login com usuário e senha do Instagram da agência — **rejeitado**

Automação com conta logada viola os Termos, expõe a conta da FZA a bloqueio e
exigiria armazenar senha e contornar verificações de segurança.

### 2.4 Clientes que concedem acesso (complemento futuro)

Contas de clientes já gerenciadas pela FZA via Business Manager podem ser
conectadas pela mesma integração oficial, liberando Insights (possivelmente
ganhos e perdas separados) **[confirmar métrica]**.

## 3. Decisão proposta

1. **Fonte principal:** Meta Business Discovery, via conta profissional da FZA.
2. **Fonte opcional:** Apify, apenas para perfis pessoais, desligada por padrão.
3. Camada de integração desacoplada (adaptadores) para trocar ou somar fontes.

## 4. Requisitos que não podem ser cumpridos só com o @

- Seguidores ganhos e perdidos separadamente.
- Histórico anterior à primeira coleta (não será fabricado).
- Perfis pessoais pela fonte oficial.
- Tempo real: a frequência efetiva será a do agendamento (padrão 60 min).

## 5. O que a FZA precisa providenciar

1. Converter o Instagram da FZA em conta profissional e vinculá-lo a uma Página.
2. Criar um app no Meta for Developers com Facebook Login for Business.
3. Gerar token de longa duração com as permissões acima.
4. (Opcional) Conta Apify e token, se quiser cobrir perfis pessoais.

## Fontes

- [IG User Business Discovery (Meta)](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/business_discovery)
- [Business Discovery — Instagram API with Facebook Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-discovery)
- [IG User reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user)
- [Rate Limits (Meta)](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/)
- [Instagram Official APIs — referência comunitária (abr/2026)](https://gist.github.com/jameschapman2c/65eff9f54a2d350b17a6ce5127b9fe42)
- [Apify Instagram Profile Scraper](https://apify.com/apify/instagram-profile-scraper)
- [Apify API — run sync get dataset items](https://docs.apify.com/api/v2/act-run-sync-get-dataset-items-post)
- [Meta v. Bright Data — análise jurídica (Farella Braun + Martel)](https://www.fbm.com/post/102kqw7/)
- [Comparativo de APIs de dados do Instagram (SocialCrawl)](https://www.socialcrawl.dev/blog/best-instagram-data-apis-2026)
