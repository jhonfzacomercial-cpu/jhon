#!/bin/sh
# Restaura um backup em um banco. ATENÇÃO: substitui o conteúdo do banco de destino.
# Uso: PGHOST=... PGUSER=... PGPASSWORD=... scripts/restore.sh <arquivo.dump> <banco_destino>
# Recomendado: restaurar primeiro em um banco novo, conferir e só então trocar.
set -eu
FILE="$1"
TARGET="$2"
pg_restore --list "$FILE" > /dev/null
pg_restore --clean --if-exists --no-owner --exit-on-error --dbname="$TARGET" "$FILE"
psql --dbname="$TARGET" -tAc "SELECT 'clientes=' || count(*) FROM clients UNION ALL SELECT 'snapshots=' || count(*) FROM follower_snapshots UNION ALL SELECT 'ultima_migracao=' || max(name) FROM schema_migrations"
echo "restauração concluída em $TARGET"
