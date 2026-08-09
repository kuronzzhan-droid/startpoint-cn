param(
    [ValidateRange(1, 3650)]
    [int]$RetentionDays = 30
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $projectRoot ".logs"
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$stdoutPath = Join-Path $logDirectory "cn-server-$timestamp.stdout.log"
$stderrPath = Join-Path $logDirectory "cn-server-$timestamp.stderr.log"

New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null

$cutoff = (Get-Date).AddDays(-$RetentionDays)
Get-ChildItem -LiteralPath $logDirectory -File -Filter "cn-server-*.log" |
    Where-Object { $_.LastWriteTime -lt $cutoff } |
    Remove-Item -Force

$listener = Get-NetTCPConnection -LocalPort 8001 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
if ($listener) {
    throw "Port 8001 is already in use by PID $($listener.OwningProcess)."
}

$process = Start-Process `
    -FilePath $nodeExecutable `
    -ArgumentList "--env-file=.env", "out/cn-server.js" `
    -WorkingDirectory $projectRoot `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath `
    -WindowStyle Hidden `
    -PassThru

$currentLogInfo = [ordered]@{
    pid = $process.Id
    startedAt = (Get-Date).ToString("o")
    stdout = $stdoutPath
    stderr = $stderrPath
}
$currentLogInfo |
    ConvertTo-Json |
    Set-Content -LiteralPath (Join-Path $logDirectory "cn-server-current.json") -Encoding utf8

Write-Output "CN StarPoint started. PID=$($process.Id)"
Write-Output "stdout: $stdoutPath"
Write-Output "stderr: $stderrPath"
