param(
    [ValidateRange(1, 3650)]
    [int]$RetentionDays = 3
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$tempDirectory = & (Join-Path $PSScriptRoot "set-cn-temp.ps1") -ProjectRoot $projectRoot
$logDirectory = Join-Path $projectRoot ".logs"
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source

Write-Host "CN StarPoint debug mode"
Write-Host "Temp directory: $tempDirectory"
Write-Host "Logs: $logDirectory (4-hour buckets, UTC+08:00)"
Write-Host "Closing this window stops the server."
Write-Host ""

# The collector mirrors both streams without PowerShell per-line processing.
Push-Location $projectRoot
try {
    & $nodeExecutable "--env-file=.env" "scripts/run-cn-logged.cjs" "--debug" "--console" "--retention-days" "$RetentionDays"
    $exitCode = $LASTEXITCODE
} finally {
    Pop-Location
}
if ($null -eq $exitCode) { $exitCode = 1 }
exit $exitCode
