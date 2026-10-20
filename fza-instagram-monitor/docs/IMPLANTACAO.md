# Implantação, backup e operação

> Status: o sistema **ainda não foi publicado**. Este guia descreve como publicar. O build de produção, a execução com `node dist/...`, o backup e a restauração foram validados localmente. A imagem Docker não pôde ser construída no ambiente de desenvolvimento (sem daemon Docker) e deve ser testada no servidor.

## Infraestrutura recomendada

Um servidor Linux (VPS) com Docker e Docker Compose. 2 vCPU, 2 GB de RAM e 20 GB de disco sobram para centenas de perfis.

O `docker-compose.yml` sobe:

| Serviço | Papel |
|---|---|
| `db` | PostgreSQL 16 com volume persistente, sem porta exposta à internet |
| `web` | API + interface na porta interna 3000 |
| `worker` | coleta contínua (`restart: unless-stopped`) |
| `caddy` | HTTPS automático (Let's Encrypt) nas portas 80/443 |
| `backup` | `pg_dump` diário em `./backups`, mantendo `BACKUP_KEEP_DAYS` dias |

Alternativas gerenciadas como Render, Railway ou Fly.io também servem, desde que ofereçam **PostgreSQL gerenciado com backup**, um **serviço web** e um **worker em segundo plano** (processo contínuo, não função sob demanda). Comandos: `node dist/server/index.js` e `node dist/worker/index.js`. As migrações rodam sozinhas na inicialização de ambos, protegidas por advisory lock.

## Passo a passo (VPS)

1. Aponte o DNS do domínio (ex.: `monitor.grupofza.com.br`) para o IP do servidor.
2. No servidor:
   ```bash
   git clone <repositório> && cd fza-instagram-monitor
   cp .env.example .env && chmod 600 .env
   # Preencha APP_DOMAIN, APP_ORIGIN (https://...), POSTGRES_PASSWORD (longa e aleatória) e META_*
   docker compose up -d --build
   docker compose exec -it web node dist/cli/create-user.js --email voce@grupofza.com.br --name "Seu Nome" --role admin
   ```
3. Acesse `https://<domínio>`, entre e confira **Configurações → Estado da coleta**: a fonte deve estar configurada e o worker ativo.
4. Teste a fonte com um perfil real: `docker compose exec web node dist/cli/provider-check.js <@perfil>`.
5. Cadastre um cliente e acompanhe a primeira coleta em **Histórico de coletas**.

## Checklist de entrada em produção

- [ ] `.env` com `NODE_ENV=production`, `APP_ORIGIN` em https e `ALLOW_DEMO_PROVIDER=false` (o sistema recusa iniciar se for `true`)
- [ ] `.env` fora do Git e com permissão 600
- [ ] HTTPS ativo (cadeado) e HTTP redirecionando
- [ ] Firewall liberando só as portas 22, 80 e 443
- [ ] `provider:check` retornando dados reais
- [ ] Cadastro de um perfil real e confirmação de que o snapshot aparece **sem o navegador aberto** (feche o navegador, espere um ciclo e confira em Histórico de coletas)
- [ ] Primeiro backup gerado em `./backups` e **restauração testada** (abaixo)
- [ ] Usuários criados com o papel mínimo necessário
- [ ] Lembrete para renovar o token da Meta (cerca de 60 dias)

## Backup

- **Automático:** o serviço `backup` roda `scripts/backup.sh` uma vez por dia. Cada arquivo é verificado com `pg_restore --list` antes de ser considerado válido.
- **Manual:** `docker compose run --rm --entrypoint /bin/sh backup /backup.sh /backups`.
- **Cópia externa:** copie `./backups` para fora do servidor (outro provedor ou armazenamento de objetos) diariamente. Backup só no mesmo disco não protege contra perda do servidor.

## Restauração (procedimento testado)

Procedimento validado em 20/10/2026 no ambiente de desenvolvimento: um backup com 753 snapshots foi restaurado em um banco novo e as contagens conferiram.

```bash
# O serviço "backup" já tem PGHOST/PGUSER/PGPASSWORD do banco.
R="docker compose run --rm --entrypoint /bin/sh -v $PWD/scripts:/scripts backup"
# 1. Restaure em um banco NOVO e confira as contagens exibidas
docker compose exec db createdb -U fza fza_restore
$R /scripts/restore.sh /backups/<arquivo>.dump fza_restore
# 2. Se estiver correto: pare web e worker, restaure no banco principal e suba de novo
docker compose stop web worker
$R /scripts/restore.sh /backups/<arquivo>.dump fza_monitor
docker compose start web worker
```

Faça um teste de restauração pelo menos uma vez por trimestre.

## Retenção e exclusão de dados

- **Excluir cliente** na interface = **arquivar**. A coleta para e o histórico é mantido por `archivedClientRetentionDays` (padrão: 180 dias). Nesse prazo, o cliente pode ser restaurado; depois, o worker apaga o cliente definitivamente e registra isso na auditoria.
- **Exclusão imediata:** só administradores, só de clientes arquivados, digitando o @ e `EXCLUIR DEFINITIVAMENTE`.
- **Histórico de seguidores e publicações:** mantido indefinidamente por padrão (`snapshotRetentionDays` vazio).
- **Registros de execução:** `collectionRunRetentionDays` (padrão: 180 dias).
- Os backups seguem `BACKUP_KEEP_DAYS`. Dados excluídos continuam nos backups até que estes expirem.

## Monitoramento e logs

- `docker compose logs -f worker`: logs em JSON por linha (`collection_ok`, `collection_failed`, `runs_abandoned`...), sem segredos.
- `GET /api/health` pode ser usado por um monitor externo (ex.: UptimeRobot).
- O painel mostra um aviso vermelho se o worker parar de dar sinal por mais de 2 min ou se a fonte não estiver configurada.
- **Configurações → Diagnóstico técnico** (admin) mostra erros por código, perfis parados e o tamanho do banco.

## Atualização do sistema e das dependências

```bash
git pull && docker compose up -d --build   # migrações rodam sozinhas
npm audit                                   # no desenvolvimento: auditoria de vulnerabilidades
```

No commit inicial, `npm audit` retornou 0 vulnerabilidades. Repita mensalmente.
