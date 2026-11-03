<#
  One-time setup on the test server (elevated PowerShell):
    - copies sync.cjs into the sync root
    - restricts token.txt to SYSTEM and Administrators
    - registers a daily scheduled task (default 04:00 server time) running the sync as SYSTEM;
      pass -EveryMinutes N for an interval instead
  Re-running it is safe; it replaces the task.
#>
param(
    [string]$SyncRoot = 'C:\startpoint-sync',
    [string]$Node = 'C:\Program Files\nodejs\node.exe',
    [string]$At = '04:00',
    [int]$EveryMinutes = 0
)
$ErrorActionPreference = 'Stop'

New-Item -ItemType Directory -Force -Path $SyncRoot | Out-Null
$src = Join-Path $PSScriptRoot 'sync.cjs'
$dst = Join-Path $SyncRoot 'sync.cjs'
if ((Resolve-Path $src).Path -ne [IO.Path]::GetFullPath($dst)) { Copy-Item -Force $src $dst }

$token = Join-Path $SyncRoot 'token.txt'
if (-not (Test-Path $token)) { throw "put the GitHub token in $token first" }
& icacls $token /inheritance:r /grant:r 'SYSTEM:R' 'Administrators:R' | Out-Null

$script = Join-Path $SyncRoot 'sync.cjs'
$action = New-ScheduledTaskAction -Execute $Node -Argument "`"$script`"" -WorkingDirectory $SyncRoot
if ($EveryMinutes -gt 0) {
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) `
        -RepetitionInterval (New-TimeSpan -Minutes $EveryMinutes)
    $when = "every $EveryMinutes min"
} else {
    $trigger = New-ScheduledTaskTrigger -Daily -At $At
    $when = "daily at $At"
}
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -StartWhenAvailable -MultipleInstances IgnoreNew -Priority 7
Register-ScheduledTask -TaskName 'StartPoint test-server sync' -Action $action -Trigger $trigger `
    -Settings $settings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
Write-Host "registered: $when, log $SyncRoot\sync.log"
