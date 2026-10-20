#!/bin/sh
# Backup lógico do PostgreSQL (formato custom, compactado).
# Uso: PGHOST=... PGUSER=... PGPASSWORD=... PGDATABASE=... scripts/backup.sh <pasta>
set -eu
DIR="${1:-./backups}"
KEEP="${BACKUP_KEEP_DAYS:-14}"
mkdir -p "$DIR"
FILE="$DIR/fza_monitor_$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --no-owner --file="$FILE.partial"
mv "$FILE.partial" "$FILE"
# Confere se o arquivo é legível antes de considerar o backup válido.
pg_restore --list "$FILE" > /dev/null
echo "backup ok: $FILE ($(du -h "$FILE" | cut -f1))"
find "$DIR" -name 'fza_monitor_*.dump' -mtime +"$KEEP" -delete
