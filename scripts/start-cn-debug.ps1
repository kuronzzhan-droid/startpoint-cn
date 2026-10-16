param(
    [ValidateRange(1, 3650)]
    [int]$RetentionDays = 3
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$tempDirectory = & (Join-Path $PSScriptRoot "set-cn-temp.ps1") -ProjectRoot $projectRoot
$logDirectory = Join-Path $projectRoot ".logs"
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$logPath = Join-Path $logDirectory "cn-server-debug-$timestamp.log"

New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$cutoff = (Get-Date).AddDays(-$RetentionDays)
Get-ChildItem -LiteralPath $logDirectory -File -Filter "cn-server-debug-*.log" |
    Where-Object { $_.LastWriteTime -lt $cutoff } |
    Remove-Item -Force

Write-Host "CN StarPoint debug mode"
Write-Host "Temp directory: $tempDirectory"
Write-Host "Log file: $logPath"
Write-Host "Closing this window stops the server."
Write-Host ""

# Keep the Node process in the foreground so output remains visible. Tee-Object
# writes the same combined output to disk for a short, reproducible debug trace.
& $nodeExecutable "--env-file=.env" "out/cn-server.js" 2>&1 |
    Tee-Object -FilePath $logPath
$exitCode = $LASTEXITCODE
if ($null -eq $exitCode) { $exitCode = 1 }
exit $exitCode
