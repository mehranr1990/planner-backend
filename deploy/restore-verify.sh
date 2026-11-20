#!/bin/sh
# Isolated restore check. Restores a backup into a throwaway PostgreSQL container
# without networking; never touches the live database or volumes.
#   sudo sh deploy/restore-verify.sh /var/backups/mehran-planner/<stamp>
set -eu
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
pc() { sh "$here/planner-compose.sh" "$@"; }
dir=$(CDPATH='' cd -- "${1:?Usage: restore-verify.sh <backup directory>}" && pwd)
BACKUP_DIR=$(dirname -- "$dir")
export BACKUP_DIR
stamp=$(basename -- "$dir")
pg_image=postgres:18.6-bookworm
name="mehran-restore-check-$$"

(cd "$dir" && sha256sum -c --quiet SHA256SUMS)
pc run --rm --no-deps ops node tooling/scripts/personal-data-admin.ts \
  verify-backup "/backup/$stamp/manifest.json" "/backup/$stamp"

cleanup() { docker rm -f -v "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$name" --network none \
  -e POSTGRES_PASSWORD="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')" \
  -e POSTGRES_DB=restore_check "$pg_image" >/dev/null
# Wait for the final server, not the entrypoint's temporary init server.
tries=0
until docker logs "$name" 2>&1 | grep -q 'PostgreSQL init process complete' &&
  docker exec "$name" pg_isready -U postgres -d restore_check -q; do
  tries=$((tries + 1))
  [ "$tries" -lt 60 ] || { echo "Restore target did not start" >&2; exit 1; }
  sleep 2
done
docker exec -i "$name" pg_restore -U postgres -d restore_check \
  --no-owner --no-privileges --exit-on-error <"$dir/planner.dump"
docker exec "$name" psql -U postgres -d restore_check -Atc \
  "select 'migrations=' || count(*) || ' latest=' || max(migration_name) from _prisma_migrations where finished_at is not null and rolled_back_at is null"
docker exec "$name" psql -U postgres -d restore_check -Atc \
  "select 'users=' || count(*) from \"User\""
docker run --rm --network none -v "$dir:/in:ro" "$pg_image" \
  sh -c 'echo "files=$(tar -tzf /in/files.tar.gz | grep -vc /$)"'
echo "PASS: isolated restore verified for $dir (throwaway container removed)."
