#!/bin/sh
# Consistent, verified backup: brief API/worker stop, PostgreSQL custom dump and
# private files, signed 30-day manifest, then structural + signature checks.
# The independent control namespaces go to a separate archive (never rolled back
# together with planner data). Copy the result off-host afterwards.
#   sudo sh deploy/backup.sh
set -eu
here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
pc() { sh "$here/planner-compose.sh" "$@"; }
BACKUP_DIR=${BACKUP_DIR:-/var/backups/mehran-planner}
export BACKUP_DIR
project=mehran-planner
pg_image=postgres:18.6-bookworm
stamp=$(date -u +%Y%m%dT%H%M%SZ)
dir="$BACKUP_DIR/$stamp"
umask 077
install -d -m 700 -o 1000 -g 1000 "$BACKUP_DIR"
install -d -m 700 -o 1000 -g 1000 "$dir"

resume() { pc start api worker >/dev/null 2>&1 || true; }
trap resume EXIT
pc stop api worker
pc exec -T postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-privileges' \
  >"$dir/planner.dump"
docker run --rm --network none -v "${project}_private_files:/data:ro" \
  -v "$dir:/out" "$pg_image" tar -C /data -czf /out/files.tar.gz .
docker run --rm --network none \
  -v "${project}_erasure_control:/control/erasure-control:ro" \
  -v "${project}_shared_control:/control/shared-control:ro" \
  -v "$dir:/out" "$pg_image" tar -C /control -czf /out/control.tar.gz .
pc start api worker
trap - EXIT

chown 1000:1000 "$dir"/*
chmod 600 "$dir"/*
pc run --rm --no-deps ops node tooling/scripts/personal-data-admin.ts \
  sign-backup "/backup/$stamp" "/backup/$stamp/manifest.json" planner.dump files.tar.gz

# Verification: archive structure, signed checksums/expiry, local checksum list.
pc exec -T postgres pg_restore --list <"$dir/planner.dump" >/dev/null
docker run --rm --network none -v "$dir:/in:ro" "$pg_image" \
  sh -c 'tar -tzf /in/files.tar.gz >/dev/null && tar -tzf /in/control.tar.gz >/dev/null'
pc run --rm --no-deps ops node tooling/scripts/personal-data-admin.ts \
  verify-backup "/backup/$stamp/manifest.json" "/backup/$stamp"
(cd "$dir" && sha256sum planner.dump files.tar.gz control.tar.gz manifest.json >SHA256SUMS)
chmod 600 "$dir/SHA256SUMS"
echo "PASS: verified backup at $dir. Copy it to off-host storage now."
