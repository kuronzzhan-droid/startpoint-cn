<#
  Test server -> GitHub sync (one-way, test-server branch only).

  Copies a whitelist of paths from the live test server install into a
  dedicated git working copy, runs secret / size checks, then commits and
  pushes to the `test-server` branch. main is never touched.

  Run after every deploy, and daily from Task Scheduler (see install-task.ps1).
  Safe to run when nothing changed: it exits without a commit.

  The token file holds a fine-grained GitHub token (Contents: read/write,
  this repository only). It is passed per command as an HTTP header and is
  never written into .git/config or the remote URL.
#>
[CmdletBinding()]
param(
    [string]$ServerDir  = 'C:\startpoint-test',
    [string]$SyncRoot   = 'C:\startpoint-sync',
    [string]$RepoUrl    = 'https://github.com/kuronzzhan-droid/startpoint-cn.git',
    [string]$Branch     = 'test-server',
    [string]$BaseBranch = 'main',
    [int]   $MaxFileMB  = 20,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoDir   = Join-Path $SyncRoot 'repo'
$TokenFile = Join-Path $SyncRoot 'token.txt'
$Gitleaks  = Join-Path $SyncRoot 'gitleaks.exe'
$LogFile   = Join-Path $SyncRoot 'sync.log'
$LockFile  = Join-Path $SyncRoot 'sync.lock'

# Top-level paths copied from the server. Anything not listed stays out.
# Directories are mirrored (files deleted on the server are deleted here too).
$IncludeDirs  = @('src', 'assets', 'web', 'scripts', 'tools', 'admin', 'data', 'docs', 'client-patch', 'apk-patches', 'deployment')
$IncludeFiles = @('package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.cn.json', 'tailwind.config.js', 'README.md')

# Never copied, wherever they appear.
$ExcludeDirs  = @('node_modules', '.git', '.cdn', '.database', '.logs', 'logs', 'tmp', 'out', 'dist', 'build',
                  'config', '.migration-backups', '.codex-backups', '__pycache__', 'gacha_odds', 'cn-traffic')
$ExcludeFiles = @('.env', '.env.*', '*.apk', '*.aab', '*.keystore', '*.jks', '*.pem', '*.key', '*.p12',
                  '*.log', '*.db', '*.db-*', '*.sqlite', '*.sqlite3', 'save_*.json', 'save_data.json',
                  'confirmed_seeds.json', '*.backup.json', '*.bak', '*.zip', '*.7z', '*.exe', '*.dll')

function Log([string]$msg) {
    $line = '{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $msg
    Write-Host $line
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

# Native git writes progress to stderr; under 'Stop' Windows PowerShell 5
# would turn that into an exception, so the wrappers relax it locally.
function RepoGit {
    $ErrorActionPreference = 'Continue'
    $out = & git -C $RepoDir @args 2>&1
    if ($LASTEXITCODE -ne 0) { throw "git $($args -join ' ') failed: $out" }
    return $out
}

function GitAuth {
    $ErrorActionPreference = 'Continue'
    # Token goes in a one-off header; nothing is persisted.
    $token = (Get-Content -Raw -Path $TokenFile).Trim()
    $basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("x-access-token:$token"))
    $out = & git -C $RepoDir -c "http.extraheader=AUTHORIZATION: basic $basic" @args 2>&1
    $code = $LASTEXITCODE
    $text = ($out | Out-String).Replace($basic, '***').Replace($token, '***')
    if ($code -ne 0) { throw "git $($args[0]) failed: $text" }
    return $text
}

New-Item -ItemType Directory -Force -Path $SyncRoot | Out-Null

# Single instance: deploy hook and scheduled task may overlap.
try { $lock = [IO.File]::Open($LockFile, 'OpenOrCreate', 'ReadWrite', 'None') }
catch { Log 'another sync is running, skip'; exit 0 }

try {
    if (-not (Test-Path $TokenFile)) { throw "token file missing: $TokenFile" }
    if (-not (Test-Path $Gitleaks))  { throw "gitleaks missing: $Gitleaks (refusing to push to a public repo without a secret scan)" }
    if (-not (Test-Path $ServerDir)) { throw "server dir missing: $ServerDir" }

    # 1. Working copy on the sync branch.
    if (-not (Test-Path (Join-Path $RepoDir '.git'))) {
        Log "cloning $RepoUrl"
        $ErrorActionPreference = 'Continue'
        & git clone --no-checkout --filter=blob:none $RepoUrl $RepoDir 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'clone failed' }
        $ErrorActionPreference = 'Stop'
        RepoGit config core.autocrlf false | Out-Null
        RepoGit config user.name 'startpoint-test-sync' | Out-Null
        RepoGit config user.email 'kuronzzhan-droid@users.noreply.github.com' | Out-Null
    }
    $env:GIT_LFS_SKIP_SMUDGE = '1'
    GitAuth fetch --quiet origin $BaseBranch | Out-Null
    $remoteHasBranch = RepoGit ls-remote --heads origin $Branch
    if ($remoteHasBranch) {
        GitAuth fetch --quiet origin $Branch | Out-Null
        RepoGit checkout -q -B $Branch "origin/$Branch" | Out-Null
    } else {
        Log "branch $Branch not on remote yet, starting from $BaseBranch"
        RepoGit checkout -q -B $Branch "origin/$BaseBranch" | Out-Null
    }
    RepoGit reset -q --hard | Out-Null
    RepoGit clean -q -fd | Out-Null

    # 2. Copy whitelist. robocopy never purges files it was told to exclude,
    #    so zips already tracked on the branch are left as they are.
    foreach ($d in $IncludeDirs) {
        $src = Join-Path $ServerDir $d
        if (-not (Test-Path $src)) { continue }
        $dst = Join-Path $RepoDir $d
        & robocopy $src $dst /MIR /NJH /NJS /NP /NFL /NDL /R:1 /W:1 /XD @ExcludeDirs /XF @ExcludeFiles | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "robocopy $d failed ($LASTEXITCODE)" }
    }
    foreach ($f in $IncludeFiles) {
        $src = Join-Path $ServerDir $f
        if (Test-Path $src) { Copy-Item -Force $src (Join-Path $RepoDir $f) }
    }

    RepoGit add -A | Out-Null
    $staged = RepoGit diff --cached --name-only
    if (-not $staged) { Log 'no changes'; exit 0 }

    # 3. Size gate: unstage anything too big and report it.
    $limit = $MaxFileMB * 1MB
    foreach ($p in @($staged)) {
        $full = Join-Path $RepoDir $p
        if ((Test-Path $full) -and (Get-Item $full).Length -gt $limit) {
            Log "skip large file ($([math]::Round((Get-Item $full).Length / 1MB))MB): $p"
            RepoGit reset -q -- $p | Out-Null
        }
    }
    $staged = RepoGit diff --cached --name-only
    if (-not $staged) { Log 'only oversized changes, nothing to commit'; exit 0 }

    # 4. Secret scan of exactly what is staged. Any hit aborts the run.
    & $Gitleaks protect --staged --source $RepoDir --no-banner --redact 2>&1 | ForEach-Object { Log "gitleaks: $_" }
    if ($LASTEXITCODE -ne 0) {
        RepoGit reset -q --hard | Out-Null
        throw 'gitleaks found possible secrets; nothing committed'
    }

    # 4b. Repo hygiene check (personal IPs, home paths, emails, .env) when Git Bash exists.
    $bash = 'C:\Program Files\Git\bin\bash.exe'
    if (Test-Path $bash) {
        Push-Location $RepoDir
        try { & $bash scripts/check-hygiene.sh 2>&1 | ForEach-Object { Log "hygiene: $_" }; $hy = $LASTEXITCODE }
        finally { Pop-Location }
        if ($hy -ne 0) { RepoGit reset -q --hard | Out-Null; throw 'hygiene check failed; nothing committed' }
    }

    # 5. Commit, message like the manual syncs: "sync: 测试服 <from>–<to>".
    $manifest = Join-Path $RepoDir 'assets\asset-patch\manifest.json'
    $now = (Get-Content -Raw -Encoding UTF8 $manifest | ConvertFrom-Json).cdn_version
    $prevText = try { RepoGit show "HEAD:assets/asset-patch/manifest.json" } catch { $null }
    $prev = if ($prevText) { (($prevText | Out-String) | ConvertFrom-Json).cdn_version } else { '' }
    $label = [regex]::Unescape('\u6d4b\u8bd5\u670d')   # 测试服
    $dash  = [regex]::Unescape('\u2013')
    $range = if ($prev -and $prev -ne $now) { "$prev$dash$now" } else { $now }
    $count = @($staged).Count
    $msg = "sync: $label $range`n`nAutomatic sync from the test server, $count files.`n"
    $msgFile = Join-Path $SyncRoot 'commit-msg.txt'
    [IO.File]::WriteAllText($msgFile, $msg, (New-Object Text.UTF8Encoding $false))
    RepoGit commit -q --no-verify -F $msgFile | Out-Null
    Log "committed $range ($count files)"

    if ($DryRun) { Log 'dry run: not pushing'; Git reset -q --hard HEAD~1 | Out-Null; exit 0 }

    # 6. Push with retries; the box is in mainland China and GitHub is flaky.
    $delays = @(5, 15, 45, 120)
    for ($i = 0; ; $i++) {
        try { GitAuth push --quiet origin "HEAD:refs/heads/$Branch" | Out-Null; Log "pushed $Branch"; break }
        catch {
            if ($i -ge $delays.Count) { throw "push failed after retries; commit kept locally, next run retries. $_" }
            Log "push failed, retry in $($delays[$i])s"
            Start-Sleep -Seconds $delays[$i]
        }
    }
}
catch {
    Log "ERROR: $_"
    exit 1
}
finally {
    $lock.Close()
}
