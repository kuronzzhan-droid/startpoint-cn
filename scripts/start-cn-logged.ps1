param(
    [ValidateRange(1, 3650)]
    [int]$RetentionDays = 30
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
if (Test-Path -LiteralPath (Join-Path $projectRoot ".storage-maintenance\active.lock")) {
    throw "Storage maintenance is still active. Use maintain-cn-recover.bat."
}
$tempDirectory = & (Join-Path $PSScriptRoot "set-cn-temp.ps1") -ProjectRoot $projectRoot
$logDirectory = Join-Path $projectRoot ".logs"
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
$envFilePath = Join-Path $projectRoot ".env"
$configuredPortText = & $nodeExecutable "--env-file=$envFilePath" -e "process.stdout.write(process.env.CN_LISTEN_PORT || '8001')"
if ($LASTEXITCODE -ne 0 -or $configuredPortText -notmatch '^\d+$') { throw "Cannot read CN_LISTEN_PORT from server configuration." }
$configuredPort = [int]$configuredPortText
if ($configuredPort -lt 1 -or $configuredPort -gt 65535) { throw "CN_LISTEN_PORT is out of range." }
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$stdoutPath = Join-Path $logDirectory "cn-server-$timestamp.stdout.log"
$stderrPath = Join-Path $logDirectory "cn-server-$timestamp.stderr.log"

New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null

$cutoff = (Get-Date).AddDays(-$RetentionDays)
Get-ChildItem -LiteralPath $logDirectory -File -Filter "cn-server-*.log" |
    Where-Object { $_.LastWriteTime -lt $cutoff } |
    Remove-Item -Force

$listener = Get-NetTCPConnection -LocalPort $configuredPort -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
if ($listener) {
    throw "Port $configuredPort is already in use by PID $($listener.OwningProcess)."
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
    temp = $tempDirectory
}
$currentLogInfo |
    ConvertTo-Json |
    Set-Content -LiteralPath (Join-Path $logDirectory "cn-server-current.json") -Encoding utf8

Write-Output "CN StarPoint started. PID=$($process.Id)"
Write-Output "temp: $tempDirectory"
Write-Output "stdout: $stdoutPath"
Write-Output "stderr: $stderrPath"
