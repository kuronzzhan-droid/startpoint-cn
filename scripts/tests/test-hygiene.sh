#!/usr/bin/env bash
set -euo pipefail

scanner_source=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/check-hygiene.sh
tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT
passed=0

new_repo() {
    local name="$1"
    local repo="$tmp/$name"
    mkdir -p "$repo/scripts"
    cp -- "$scanner_source" "$repo/scripts/check-hygiene.sh"
    (
        cd "$repo"
        git init -q
        git config user.name hygiene-test
        git config user.email hygiene-test@example.invalid
        git config core.quotepath false
        git config core.autocrlf false
        git add -- scripts/check-hygiene.sh
        git commit -qm base
    )
    printf '%s' "$repo"
}

expect_pass() {
    local repo="$1" label="$2"
    if output=$(cd "$repo" && bash scripts/check-hygiene.sh 2>&1); then
        passed=$((passed + 1))
        printf '[PASS] %s\n' "$label"
    else
        printf '[FAIL] %s\n%s\n' "$label" "$output" >&2
        return 1
    fi
}

expect_fail() {
    local repo="$1" label="$2" expected="$3"
    if output=$(cd "$repo" && bash scripts/check-hygiene.sh 2>&1); then
        printf '[FAIL] %s (scanner unexpectedly passed)\n' "$label" >&2
        return 1
    fi
    if [[ "$output" != *"$expected"* ]]; then
        printf '[FAIL] %s (missing %q)\n%s\n' "$label" "$expected" "$output" >&2
        return 1
    fi
    passed=$((passed + 1))
    printf '[PASS] %s\n' "$label"
}

repo=$(new_repo unicode_file)
printf 'ordinary text\n' > "$repo/普通 文件.txt"
(cd "$repo" && git add -- '普通 文件.txt')
expect_pass "$repo" 'ordinary Unicode filename passes'

repo=$(new_repo unicode_directory)
mkdir -p "$repo/角色资料"
printf 'safe markdown\n' > "$repo/角色资料/测试.md"
(cd "$repo" && git add -- '角色资料/测试.md')
expect_pass "$repo" 'nested Unicode path passes'

repo=$(new_repo newline_filename)
newline_file=$'line\nbreak.txt'
printf 'safe text\n' > "$repo/$newline_file"
(cd "$repo" && git add -A)
expect_pass "$repo" 'filename containing a newline is handled as one safe path'

repo=$(new_repo newline_forbidden)
newline_forbidden=$'private\naddress.txt'
printf '192.168.99.99\n' > "$repo/$newline_forbidden"
(cd "$repo" && git add -A)
expect_fail "$repo" 'forbidden content is detected through a newline filename' '个人 IP'

repo=$(new_repo private_ip)
printf 'server=192.168.99.99\n' > "$repo/含IP 中文.md"
(cd "$repo" && git add -- '含IP 中文.md')
expect_fail "$repo" 'private IP is rejected' '个人 IP'

repo=$(new_repo allowed_patch)
mkdir -p "$repo/assets/asset-patch/active"
(
    cd "$repo"
    python - <<'PY'
import os
import zipfile
from pathlib import Path

target = Path("assets/asset-patch/active/pinball-1.4.139-1.4.140-1-mod07150000.zip")
with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_STORED) as archive:
    archive.writestr("payload.bin", os.urandom(1_100_000))
PY
    git add -- assets/asset-patch/active/pinball-1.4.139-1.4.140-1-mod07150000.zip
)
expect_pass "$repo" 'valid named patch ZIP between 1 MiB and 5 MiB passes'

repo=$(new_repo wrong_patch_name)
mkdir -p "$repo/assets/asset-patch/active"
(
    cd "$repo"
    python - <<'PY'
import os
import zipfile
from pathlib import Path

target = Path("assets/asset-patch/active/not-a-patch.zip")
with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_STORED) as archive:
    archive.writestr("payload.bin", os.urandom(1_100_000))
PY
    git add -- assets/asset-patch/active/not-a-patch.zip
)
expect_fail "$repo" 'large ZIP with an unapproved name is rejected' '大文件'

repo=$(new_repo corrupt_patch)
mkdir -p "$repo/assets/asset-patch/active"
(
    cd "$repo"
    dd if=/dev/zero of=assets/asset-patch/active/pinball-1.4.139-1.4.140-1-mod07150001.zip bs=1100000 count=1 status=none
    git add -- assets/asset-patch/active/pinball-1.4.139-1.4.140-1-mod07150001.zip
)
expect_fail "$repo" 'corrupt ZIP is rejected despite an approved filename' '大文件'

repo=$(new_repo dotenv)
printf 'TOKEN=secret\n' > "$repo/.env"
(cd "$repo" && git add -f -- .env)
expect_fail "$repo" '.env is rejected' '.env 不得提交'

# --- CLAUDE.md / AGENTS.md 同步门禁 ---
# 这五个用例覆盖 check_agent_docs_in_sync 的全部分支。加它们的直接原因：
# 初版门禁写成「两份都存在才比较，任一缺失直接放行」，删掉 CLAUDE.md 就能骗过 CI；
# 而上面 9 个既有用例的测试仓里两份文件都不存在，全部走「合法基线」分支，
# 一次都没真正执行过被测逻辑——守卫存在但测试打不中。
# 验收判据：把 check_agent_docs_in_sync 的任一 note 行删掉，对应用例必须变红。

write_pair() {
    local repo="$1" claude_body="$2" agents_body="$3"
    [[ -n "$claude_body" ]] && printf '# CLAUDE.md\n%s' "$claude_body" > "$repo/CLAUDE.md"
    [[ -n "$agents_body" ]] && printf '# AGENTS.md\n%s' "$agents_body" > "$repo/AGENTS.md"
    (cd "$repo" && git add -A -- CLAUDE.md AGENTS.md 2>/dev/null || true)
}

repo=$(new_repo agentdocs_absent)
expect_pass "$repo" 'neither CLAUDE.md nor AGENTS.md present is a legal baseline'

repo=$(new_repo agentdocs_identical)
write_pair "$repo" 'shared body\n' 'shared body\n'
expect_pass "$repo" 'CLAUDE.md and AGENTS.md identical below the title passes'

repo=$(new_repo agentdocs_diverged)
write_pair "$repo" 'shared body\n' 'shared body\nextra line\n'
expect_fail "$repo" 'CLAUDE.md and AGENTS.md content divergence is rejected' '内容分裂'

repo=$(new_repo agentdocs_missing_agents)
write_pair "$repo" 'shared body\n' ''
expect_fail "$repo" 'AGENTS.md missing while CLAUDE.md exists is rejected' 'AGENTS.md 缺失'

repo=$(new_repo agentdocs_missing_claude)
write_pair "$repo" '' 'shared body\n'
expect_fail "$repo" 'CLAUDE.md missing while AGENTS.md exists is rejected' 'CLAUDE.md 缺失'

# 只看「盘上有没有」会留后门：删一份报错，删两份反而放行。判据必须是 git 是否跟踪。
repo=$(new_repo agentdocs_both_deleted)
write_pair "$repo" 'shared body\n' 'shared body\n'
(cd "$repo" && git commit -qm 'add agent docs' && rm -f CLAUDE.md AGENTS.md)
expect_fail "$repo" 'both tracked agent docs deleted from worktree is rejected' '均被跟踪但都不在工作区'

printf '[OK] %d hygiene cases passed\n' "$passed"
