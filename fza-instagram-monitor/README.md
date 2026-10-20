# FZA Instagram Monitor

Plataforma interna do Grupo FZA para monitorar perfis públicos do Instagram. Ela acompanha a evolução de seguidores e publicações e transforma isso em indicadores e alertas para a equipe.

- **Fonte de dados:** API oficial da Meta (*Instagram Business Discovery*), consultada pela conta profissional da FZA. Não usa scraping e não guarda senhas. A escolha está em [docs/FASE1-viabilidade.md](docs/FASE1-viabilidade.md).
- **Histórico próprio:** cada coleta bem-sucedida grava um snapshot imutável. O histórico começa na primeira coleta e nenhum dado anterior é fabricado.
- **Coleta automática:** um worker separado da interface roda no servidor, com o navegador aberto ou não.
- **Honestidade dos dados:** o sistema mostra só a **variação líquida** (a fonte não separa ganhos de perdas). Um dado indisponível aparece como "Não disponível", nunca como zero.

## Estrutura

```
src/
  config/      variáveis de ambiente (validadas)
  db/          conexão e migrações
  core/        regras puras: @, crescimento, publicações, diagnóstico, alertas, configurações
  providers/   contrato da fonte + adaptador Meta + fonte DEMO (só desenvolvimento)
  worker/      coletor, fila no PostgreSQL, backoff, logs
  server/      API (Fastify), autenticação, rotas
  cli/         criar usuário, testar a fonte, carteira DEMO
web/           interface (React + Vite + Recharts)
migrations/    SQL versionado
tests/         unitários, integração (PostgreSQL real) e E2E real (opcional)
scripts/       backup e restauração
deploy/        Caddyfile (HTTPS)
docs/          viabilidade, arquitetura, API, provedor, implantação
```

## Desenvolvimento local

Requisitos: Node 22+ e PostgreSQL 16.

```bash
npm ci
cp .env.example .env           # ajuste DATABASE_URL, NODE_ENV=development, APP_ORIGIN=http://localhost:5173
npm run migrate
npm run user:create -- --email voce@grupofza.com.br --name "Seu Nome" --role admin

npm run dev:server             # API em :3000
npm run dev:worker             # worker de coleta
npm run dev:web                # interface em :5173 (proxy para a API)
```

Sem credenciais da Meta, o sistema avisa que nenhuma fonte está configurada e não coleta nada. Para testar a interface com dados sintéticos, use `ALLOW_DEMO_PROVIDER=true` e rode `npm run demo:seed`. Tudo o que esse comando gera aparece com o selo **DEMO**, e a fonte DEMO fica bloqueada em produção.

## Comandos

| Comando | O que faz |
|---|---|
| `npm test` | testes unitários e de integração (precisa de PostgreSQL; banco em `TEST_DATABASE_URL`) |
| `npm run typecheck` | checagem de tipos do servidor e da interface |
| `npm run build` | build da interface (`dist/web`) e do servidor (`dist/`) |
| `npm run migrate` | aplica as migrações pendentes |
| `npm run user:create` | cria um usuário ou redefine sua senha |
| `npm run provider:check -- <@>` | consulta real à Meta para um perfil, sem gravar nada |
| `npm run demo:seed` | carteira DEMO (somente desenvolvimento) |

## Documentação

- [Fase 1: viabilidade e escolha da fonte](docs/FASE1-viabilidade.md)
- [Arquitetura e modelo de dados](docs/ARQUITETURA.md)
- [Provedor Meta: configuração, campos e limitações](docs/PROVEDOR-META.md)
- [API HTTP](docs/API.md)
- [Implantação, backup, restauração e operação](docs/IMPLANTACAO.md)
