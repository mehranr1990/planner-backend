#!/bin/sh
# Docker Compose with the operator env file and the ClamAV overlay.
#   sh deploy/planner-compose.sh <compose arguments>
# PLANNER_ENV_FILE overrides the default env file location.
set -eu
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
env_file=${PLANNER_ENV_FILE:-/etc/mehran-planner/planner.env}
if [ ! -r "$env_file" ]; then
  echo "Env file not readable: $env_file" >&2
  exit 1
fi
exec docker compose --project-directory "$root" --env-file "$env_file" \
  -f "$root/compose.yaml" -f "$root/compose.clamav.yaml" "$@"
