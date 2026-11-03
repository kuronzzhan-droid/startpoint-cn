<#
  Registers the daily fallback run of sync.ps1 (04:30 local time)
  and locks down the token file.
  Run once in an elevated PowerShell on the test server.
#>
param(
    [string]$SyncRoot = 'C:\startpoint-sync',
    [string]$At = '04:30'
)
$ErrorActionPreference = 'Stop'

$script = Join-Path $SyncRoot 'sync.ps1'
if (-not (Test-Path $script)) { Copy-Item (Join-Path $PSScriptRoot 'sync.ps1') $script }

$token = Join-Path $SyncRoot 'token.txt'
if (Test-Path $token) {
    # Only SYSTEM and Administrators may read the token.
    & icacls $token /inheritance:r /grant:r 'SYSTEM:R' 'Administrators:R' | Out-Null
}

$action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`""
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -StartWhenAvailable
Register-ScheduledTask -TaskName 'StartPoint test-server sync' -Action $action -Trigger $trigger `
    -Settings $settings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
Write-Host "registered daily sync at $At"
