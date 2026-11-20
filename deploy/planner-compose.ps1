# Docker Compose with the operator env file and the ClamAV overlay (Windows Docker Desktop).
#   .\deploy\planner-compose.ps1 <compose arguments>
# PLANNER_ENV_FILE overrides the default %LOCALAPPDATA%\mehran-planner\planner.env.
# compose.lan.yaml is added only when the env file sets PROXY_LAN_BIND.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envFile = if ($env:PLANNER_ENV_FILE) { $env:PLANNER_ENV_FILE } else { Join-Path $env:LOCALAPPDATA 'mehran-planner\planner.env' }
if (-not (Test-Path -LiteralPath $envFile)) { throw "Env file not found: $envFile" }
$files = @('-f', (Join-Path $root 'compose.yaml'), '-f', (Join-Path $root 'compose.clamav.yaml'))
if (Select-String -LiteralPath $envFile -Pattern '^PROXY_LAN_BIND=\S' -Quiet) {
  $files += @('-f', (Join-Path $root 'compose.lan.yaml'))
}
# Compose writes progress to stderr; never let PowerShell 5.1 treat it as fatal.
$ErrorActionPreference = 'Continue'
& docker compose --project-directory $root --env-file $envFile @files @args
exit $LASTEXITCODE
