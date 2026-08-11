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
# 血缘判据：AGENTS.md 是否在 HEAD 血缘中出现过。
#   上游 main 曾主动删除 CLAUDE.md（199f37a8），所以「CLAUDE.md 曾存在」不能当 fork 信号；
#   AGENTS.md 在上游历史里从未出现，是当前唯一可用的区分信号。
# 浅克隆无法可靠判血缘（无父提交时 git 视树内文件为全新增），必须 fail closed。
# staged 模式判 index blob（即将提交的内容），--all 模式判工作树内容，
#   但两种模式都必须分别校验 CLAUDE.md 与 AGENTS.md 的 index tracked 状态，不得聚合成一个位。
# 验收判据：注掉或反转任一判定后，对应用例必须真实变红。

# 同时断言两种模式；mode 为空串表示默认 staged 模式。
expect_mode() {
    local repo="$1" mode="$2" want="$3" label="$4" needle="${5:-}" output rc
    if output=$(cd "$repo" && bash scripts/check-hygiene.sh ${mode:+"$mode"} 2>&1); then rc=0; else rc=$?; fi
    if [[ "$want" == 'pass' ]]; then
        if (( rc == 0 )); then
            passed=$((passed + 1)); printf '[PASS] %s\n' "$label"; return 0
        fi
        printf '[FAIL] %s (expected pass, rc=%d)\n%s\n' "$label" "$rc" "$output" >&2
        return 1
    fi
    if (( rc == 0 )); then
        printf '[FAIL] %s (expected fail, scanner passed)\n' "$label" >&2
        return 1
    fi
    if [[ -n "$needle" && "$output" != *"$needle"* ]]; then
        printf '[FAIL] %s (missing %q)\n%s\n' "$label" "$needle" "$output" >&2
        return 1
    fi
    passed=$((passed + 1)); printf '[PASS] %s\n' "$label"
}

# fork 血缘仓：两份规则书都进过历史（AGENTS.md 出现在 HEAD 血缘中）。
fork_repo() {
    local repo
    repo=$(new_repo "$1")
    printf '# CLAUDE.md\nshared body\n' > "$repo/CLAUDE.md"
    printf '# AGENTS.md\nshared body\n' > "$repo/AGENTS.md"
    (cd "$repo" && git add -- CLAUDE.md AGENTS.md && git commit -qm 'add agent docs')
    printf '%s' "$repo"
}

# 1) 合法上游基线：CLAUDE.md 曾在历史里、AGENTS.md 从未有、当前两份都缺 → 放行。
#    这条钉死「不得拿 CLAUDE.md 当血缘信号」。
repo=$(new_repo upstream_baseline)
printf '# CLAUDE.md\nbody\n' > "$repo/CLAUDE.md"
(cd "$repo" && git add -- CLAUDE.md && git commit -qm 'add claude md' \
    && git rm -q CLAUDE.md && git commit -qm 'drop claude md')
expect_mode "$repo" '' pass 'upstream baseline (CLAUDE.md once existed, AGENTS.md never) passes staged'
expect_mode "$repo" '--all' pass 'upstream baseline passes --all'

# 2) fork 血缘且两份一致 → 两种模式都放行。
repo=$(fork_repo fork_consistent)
expect_mode "$repo" '' pass 'fork lineage with identical docs passes staged'
expect_mode "$repo" '--all' pass 'fork lineage with identical docs passes --all'

# 3) 工作树分裂而 index 一致 → staged 按 index 放行，--all 按工作树拒绝。
repo=$(fork_repo worktree_diverged)
printf '# AGENTS.md\nshared body\nworktree drift\n' > "$repo/AGENTS.md"
expect_mode "$repo" '' pass 'worktree divergence with clean index passes staged'
expect_mode "$repo" '--all' fail 'worktree divergence is rejected by --all' '内容分裂'

# 4) index 分裂而工作树一致 → staged 拒绝（不得拿工作树内容冒充 staged 内容）。
repo=$(fork_repo index_diverged)
printf '# AGENTS.md\nshared body\nstaged drift\n' > "$repo/AGENTS.md"
(cd "$repo" && git add -- AGENTS.md)
printf '# AGENTS.md\nshared body\n' > "$repo/AGENTS.md"
expect_mode "$repo" '' fail 'index divergence with clean worktree is rejected by staged' '内容分裂'
expect_mode "$repo" '--all' pass 'index divergence with clean worktree passes --all'

# 5) 只剩一份（工作树层）→ --all 拒绝并点名缺哪份。
repo=$(fork_repo only_claude_worktree)
rm -f "$repo/AGENTS.md"
expect_mode "$repo" '--all' fail 'AGENTS.md missing from worktree is rejected by --all' 'AGENTS.md 缺失'

repo=$(fork_repo only_agents_worktree)
rm -f "$repo/CLAUDE.md"
expect_mode "$repo" '--all' fail 'CLAUDE.md missing from worktree is rejected by --all' 'CLAUDE.md 缺失'

# 6) 只剩一份（index 层，git rm 单删）→ staged 拒绝。
repo=$(fork_repo only_claude_index)
(cd "$repo" && git rm -q AGENTS.md)
expect_mode "$repo" '' fail 'AGENTS.md removed from index is rejected by staged' 'AGENTS.md'

repo=$(fork_repo only_agents_index)
(cd "$repo" && git rm -q CLAUDE.md)
expect_mode "$repo" '' fail 'CLAUDE.md removed from index is rejected by staged' 'CLAUDE.md'

# 7) 普通未暂存 rm 双删 → staged 放行（index 未动），--all 拒绝（工作树没了）。
repo=$(fork_repo plain_rm_both)
rm -f "$repo/CLAUDE.md" "$repo/AGENTS.md"
expect_mode "$repo" '' pass 'plain unstaged rm of both passes staged'
expect_mode "$repo" '--all' fail 'plain unstaged rm of both is rejected by --all' '不在工作区'

# 8) git rm 双删但未提交 → 两种模式都拒绝（index 已空，血缘仍在）。
repo=$(fork_repo gitrm_uncommitted)
(cd "$repo" && git rm -q CLAUDE.md AGENTS.md)
expect_mode "$repo" '' fail 'staged git rm of both is rejected by staged' '血缘'
expect_mode "$repo" '--all' fail 'staged git rm of both is rejected by --all' '血缘'

# 9) 双删并提交后 → 两种模式都拒绝。这是初版与 v1.11 都放行的 Blocker。
repo=$(fork_repo gitrm_committed)
(cd "$repo" && git rm -q CLAUDE.md AGENTS.md && git commit -qm 'delete both')
expect_mode "$repo" '' fail 'committed deletion of both is rejected by staged' '血缘'
expect_mode "$repo" '--all' fail 'committed deletion of both is rejected by --all' '血缘'

# 10) 双删提交后的 fresh clone（CI checkout 形态）→ --all 拒绝。
src=$(fork_repo clone_source)
(cd "$src" && git rm -q CLAUDE.md AGENTS.md && git commit -qm 'delete both')
clone="$tmp/clone_fresh"
git clone -q "$src" "$clone"
expect_mode "$clone" '--all' fail 'fresh clone of a both-deleted repo is rejected by --all' '血缘'

# 11) 一份 tracked、另一份 untracked（内容相同）→ 两种模式都拒绝。
#     聚合成单一 tracked 位时这条会放行。
repo=$(fork_repo one_untracked_same)
(cd "$repo" && git rm -q --cached AGENTS.md && git commit -qm 'untrack agents')
expect_mode "$repo" '' fail 'tracked/untracked split with same content is rejected by staged' '跟踪'
expect_mode "$repo" '--all' fail 'tracked/untracked split with same content is rejected by --all' '跟踪'

# 12) 一份 tracked、另一份 untracked（内容不同）→ 两种模式都拒绝。
repo=$(fork_repo one_untracked_diff)
(cd "$repo" && git rm -q --cached AGENTS.md && git commit -qm 'untrack agents')
printf '# AGENTS.md\nshared body\ndifferent\n' > "$repo/AGENTS.md"
expect_mode "$repo" '' fail 'tracked/untracked split with different content is rejected by staged' '跟踪'
expect_mode "$repo" '--all' fail 'tracked/untracked split with different content is rejected by --all' '跟踪'

# 13) 浅克隆双删 → 血缘不可判，保守拒绝。
#     浅克隆无父提交时 git 视树内文件为全新增，rev-list 查不到 AGENTS.md，
#     没有这条 fail-closed 就会误放行。
src=$(fork_repo shallow_source)
(cd "$src" && git rm -q CLAUDE.md AGENTS.md && git commit -qm 'delete both')
shallow="$tmp/clone_shallow"
if git clone -q --depth=1 "file://$(cd "$src" && pwd)" "$shallow" 2>/dev/null \
    && [[ "$(cd "$shallow" && git rev-parse --is-shallow-repository)" == 'true' ]]; then
    expect_mode "$shallow" '--all' fail 'shallow clone with both deleted is rejected (fail closed)' '浅克隆'
else
    printf '[SKIP] shallow clone unsupported in this environment\n' >&2
fi


# --- Round 2：Codex round-1 复核指出的 1 Blocker + 3 Important ---

# R2-1 Blocker：普通双父 merge，规则书只在第二父，merge 最终树两份都没有。
#   默认 rev-list 受 path-history simplification 影响返回空 → 血缘漏判 → 全模式放行。
#   本用例同时证明「默认为空、完整历史非空」这个前提本身成立。
merge_repo() {
    local repo main
    repo=$(new_repo "$1")
    (
        cd "$repo"
        main=$(git rev-parse --abbrev-ref HEAD)
        git checkout -qb side
        printf '# CLAUDE.md\nshared body\n' > CLAUDE.md
        printf '# AGENTS.md\nshared body\n' > AGENTS.md
        git add -- CLAUDE.md AGENTS.md && git commit -qm 'side adds agent docs'
        git checkout -q "$main"
        printf 'main moves on\n' > main.txt
        git add -- main.txt && git commit -qm 'main moves on'
        git merge -q --no-ff side -m 'merge side' >/dev/null 2>&1
        git rm -q --cached CLAUDE.md AGENTS.md >/dev/null 2>&1
        rm -f CLAUDE.md AGENTS.md
        git commit -q --amend --no-edit
    )
    printf '%s' "$repo"
}

repo=$(merge_repo merge_second_parent)
default_lineage=$(cd "$repo" && git rev-list --max-count=1 HEAD -- AGENTS.md)
full_lineage=$(cd "$repo" && git rev-list --full-history --max-count=1 HEAD -- AGENTS.md)
if [[ -z "$default_lineage" && -n "$full_lineage" ]]; then
    passed=$((passed + 1))
    printf '[PASS] merge simplification premise holds (default empty, --full-history non-empty)\n'
else
    printf '[FAIL] merge simplification premise (default=%q full=%q)\n' "$default_lineage" "$full_lineage" >&2
    exit 1
fi
expect_mode "$repo" '' fail 'lineage hidden by merge simplification is rejected by staged' '血缘'
expect_mode "$repo" '--all' fail 'lineage hidden by merge simplification is rejected by --all' '血缘'
merge_clone="$tmp/clone_merge"
git clone -q "$repo" "$merge_clone"
expect_mode "$merge_clone" '--all' fail 'fresh clone of merge-hidden lineage is rejected by --all' '血缘'

# R2-2 Important 1：无 AGENTS 血缘时，untracked 规则书不构成合法基线。
#   合法基线只允许「两份均未跟踪且磁盘也均不存在」。
repo=$(new_repo untracked_single)
printf '# CLAUDE.md\nshared body\n' > "$repo/CLAUDE.md"
expect_mode "$repo" '' fail 'single untracked CLAUDE.md without lineage is rejected by staged' '跟踪'
expect_mode "$repo" '--all' fail 'single untracked CLAUDE.md without lineage is rejected by --all' '跟踪'

repo=$(new_repo untracked_divergent)
printf '# CLAUDE.md\nshared body\n' > "$repo/CLAUDE.md"
printf '# AGENTS.md\nshared body\ndrift\n' > "$repo/AGENTS.md"
expect_mode "$repo" '' fail 'two divergent untracked docs without lineage is rejected by staged' '跟踪'
expect_mode "$repo" '--all' fail 'two divergent untracked docs without lineage is rejected by --all' '跟踪'

# R2-3 Important 2a：intent-to-add 是空 blob，stage 0 / mode 100644 都骗得过。
repo=$(fork_repo intent_to_add)
(
    cd "$repo"
    git rm -q CLAUDE.md AGENTS.md && git commit -qm 'delete both'
    printf '# CLAUDE.md\nshared body\n' > CLAUDE.md
    printf '# AGENTS.md\nshared body\n' > AGENTS.md
    git add -N -- CLAUDE.md AGENTS.md
)
expect_mode "$repo" '' fail 'intent-to-add entries are rejected by staged' '跟踪'
expect_mode "$repo" '--all' fail 'intent-to-add entries are rejected by --all' '跟踪'

# R2-4 Important 2b：两个 mode=120000 且目标不同的 index entry。
#   剥掉唯一首行后两者都为空，内容比对会误判为一致，必须靠 mode 校验拦下。
repo=$(new_repo symlink_entries)
(
    cd "$repo"
    git update-index --add --cacheinfo "120000,$(printf 'target-one' | git hash-object -w --stdin),CLAUDE.md"
    git update-index --add --cacheinfo "120000,$(printf 'target-two' | git hash-object -w --stdin),AGENTS.md"
)
expect_mode "$repo" '' fail 'symlink index entries are rejected by staged' '跟踪'

# R2-5 Important 3：非浅仓缺祖先对象 → rev-list rc=128，不得吞成「无血缘」。
repo=$(fork_repo broken_ancestor)
(
    cd "$repo"
    git rm -q CLAUDE.md AGENTS.md && git commit -qm 'delete both'
    parent=$(git rev-parse 'HEAD~1')
    rm -f ".git/objects/${parent:0:2}/${parent:2}"
)
if [[ "$(cd "$repo" && git rev-parse --is-shallow-repository)" == 'false' ]] \
    && ! (cd "$repo" && git rev-list --full-history --max-count=1 HEAD -- AGENTS.md >/dev/null 2>&1); then
    passed=$((passed + 1))
    printf '[PASS] broken-ancestor premise holds (non-shallow, rev-list fails)\n'
else
    printf '[FAIL] broken-ancestor premise did not hold\n' >&2
    exit 1
fi
expect_mode "$repo" '' fail 'undeterminable lineage fails closed in staged' '血缘不可判定'
expect_mode "$repo" '--all' fail 'undeterminable lineage fails closed in --all' '血缘不可判定'

# R2-6a 从仓库子目录运行，结果必须与根目录一致。
repo=$(fork_repo subdir_consistency)
mkdir -p "$repo/nested/deep"
expect_mode "$repo" '' pass 'consistent docs pass from repo root'
if output=$(cd "$repo/nested/deep" && bash ../../scripts/check-hygiene.sh --all 2>&1); then
    passed=$((passed + 1)); printf '[PASS] running from a subdirectory matches the root result\n'
else
    printf '[FAIL] running from a subdirectory matches the root result\n%s\n' "$output" >&2
    exit 1
fi

repo=$(fork_repo subdir_reject)
printf '# AGENTS.md\nshared body\nsubdir drift\n' > "$repo/AGENTS.md"
mkdir -p "$repo/nested"
if output=$(cd "$repo/nested" && bash ../scripts/check-hygiene.sh --all 2>&1); then
    printf '[FAIL] subdirectory run must also reject divergence\n' >&2
    exit 1
else
    passed=$((passed + 1)); printf '[PASS] subdirectory run also rejects divergence\n'
fi

# R2-6b 0 字节 / 错标题 / 仅标题无正文，全部拒绝。
repo=$(fork_repo zero_byte)
(cd "$repo" && : > CLAUDE.md && git add -- CLAUDE.md)
expect_mode "$repo" '' fail 'zero-byte rule book is rejected by staged' '合法规则书'

repo=$(fork_repo wrong_title)
(cd "$repo" && printf '# WRONG.md\nshared body\n' > CLAUDE.md && git add -- CLAUDE.md)
expect_mode "$repo" '' fail 'wrong first-line title is rejected by staged' '合法规则书'

repo=$(fork_repo title_only)
(
    cd "$repo"
    printf '# CLAUDE.md\n' > CLAUDE.md
    printf '# AGENTS.md\n' > AGENTS.md
    git add -- CLAUDE.md AGENTS.md
)
expect_mode "$repo" '' fail 'title-only rule books are rejected by staged' '合法规则书'

printf '[OK] %d hygiene cases passed\n' "$passed"
