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
$listener = Get-NetTCPConnection -LocalPort $configuredPort -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
if ($listener) {
    throw "Port $configuredPort is already in use by PID $($listener.OwningProcess)."
}

$process = Start-Process `
    -FilePath $nodeExecutable `
    -ArgumentList "--env-file=.env", "scripts/run-cn-logged.cjs", "--retention-days", "$RetentionDays" `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -PassThru

# The receipt contains the game PID, not the logger PID, for maintenance tools.
$receiptPath = Join-Path $logDirectory "cn-server-current.json"
$currentLogInfo = $null
$deadline = (Get-Date).AddSeconds(10)
while ((Get-Date) -lt $deadline) {
    if ($process.HasExited) { throw "Log collector exited before server startup. Check .logs." }
    if (Test-Path -LiteralPath $receiptPath) {
        try {
            $candidate = Get-Content -Raw -LiteralPath $receiptPath | ConvertFrom-Json
            if ($candidate.loggerPid -eq $process.Id -and $candidate.pid) {
                $currentLogInfo = $candidate
                break
            }
        } catch {
            # Retry a transient read while the receipt is replaced atomically.
        }
    }
    Start-Sleep -Milliseconds 100
}
if (!$currentLogInfo) { throw "No startup receipt within 10 seconds; inspect logger PID $($process.Id) before retrying." }

Write-Output "CN StarPoint launched. PID=$($currentLogInfo.pid) loggerPID=$($process.Id)"
Write-Output "temp: $tempDirectory"
Write-Output "log: $($currentLogInfo.log)"
Write-Output "Rotation: every 4 hours at 00/04/08/12/16/20 (UTC+08:00)."
