# Docker Compose with the operator env file and the ClamAV overlay (Windows Docker Desktop).
#   .\deploy\planner-compose.ps1 <compose arguments>
# PLANNER_ENV_FILE overrides the default %LOCALAPPDATA%\mehran-planner\planner.env.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envFile = if ($env:PLANNER_ENV_FILE) { $env:PLANNER_ENV_FILE } else { Join-Path $env:LOCALAPPDATA 'mehran-planner\planner.env' }
if (-not (Test-Path -LiteralPath $envFile)) { throw "Env file not found: $envFile" }
& docker compose --project-directory $root --env-file $envFile `
  -f (Join-Path $root 'compose.yaml') -f (Join-Path $root 'compose.clamav.yaml') @args
exit $LASTEXITCODE
