#!/usr/bin/env bash
# 提交卫生检查：阻止个人 IP、家目录、个人邮箱、.env 和无授权大二进制进入仓库。
# 用法：
#   bash scripts/check-hygiene.sh          # 检查已暂存文件（pre-commit）
#   bash scripts/check-hygiene.sh --all    # 检查全部已跟踪文件（CI）
set -uo pipefail

MODE="${1:-staged}"
fail=0
note() { printf '  [x] %s\n' "$*"; fail=1; }

# 先锚定 git 顶层再干活：本脚本全程用相对路径（git ls-files 的输出、[[ -f ]] 判定、
# 规则书路径都是相对 toplevel 的），从子目录直接运行会得到与根目录不一致的结果。
repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || {
    printf '  [x] 无法解析 git 仓库根目录——本脚本必须在 git 工作区内运行\n' >&2
    exit 1
}
cd "$repo_root" || exit 1

IP_RE='192\.168\.[0-9]+\.[0-9]+'
HOME_RE='(/Users/[A-Za-z0-9._-]+|[A-Za-z]:\\Users\\[A-Za-z0-9._-]+)'
EMAIL_RE='[A-Za-z0-9._%+-]+@(qq|gmail|163|126|outlook|hotmail|foxmail|yahoo)\.com'
# 有意保留的通用占位示例。
IP_ALLOW='192\.168\.1\.10'

paths_file=$(mktemp)
trap 'rm -f -- "$paths_file"' EXIT

is_allowed_patch_zip() {
    local path="$1" size="$2"
    [[ "$path" =~ ^assets/asset-patch/(active|inactive|archive)/pinball-[0-9]+\.[0-9]+\.[0-9]+-[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9][A-Za-z0-9._-]*)?\.zip$ ]] || return 1
    (( size <= 5242880 )) || return 1
    unzip -tqq -- "$path" >/dev/null 2>&1
}

is_allowed_large_runtime_text() {
    local path="$1" size="$2"
    [[ "$path" == 'mod-tools/WF_PATHLIST_recovered.txt' ]] && (( size <= 8388608 ))
}

print_matches() {
    printf '%s\n' "$1" | sed -n '1,3{s/^/      /;p;}'
}

# 保留 NUL 分隔，不把路径列表放进普通 shell 字符串。
scan_paths() {
    local path
    while IFS= read -r -d '' path; do
        [[ -f "$path" ]] || continue
        # 只有包含测试策略字面量的两个文件需要精确豁免。
        case "$path" in
            scripts/check-hygiene.sh|scripts/tests/test-hygiene.sh) continue ;;
        esac
        printf '%s\0' "$path" >> "$paths_file"
        if [[ "$path" == '.env' ]]; then
            note '.env 不得提交（仅提交 .env.example）'
        fi
    done
}

scan_sizes() {
    local size path
    while IFS= read -r -d '' size && IFS= read -r -d '' path; do
        (( size > 1048576 )) || continue
        case "$path" in
            *.json|*.csv|*.md)
                ;;
            *)
                if ! is_allowed_patch_zip "$path" "$size" && ! is_allowed_large_runtime_text "$path" "$size"; then
                    note "大文件 >1MiB（仅允许命名合规、有效且不超过 5MiB 的资产补丁 ZIP）：$path"
                fi
                ;;
        esac
    done
}

scan_ip_matches() {
    local path hits
    while IFS= read -r -d '' path; do
        # 只豁免 IP 规则，不豁免其他检查。名单必须随内容收缩：曾经因为三个测试
        # 文件长期挂着豁免，作者真实的内网地址在里面躺了三周没人发现。
        # 它们现在用 TEST-NET-1（192.0.2.x，本就不匹配 IP_RE），豁免已无作用，
        # 留着只会让同一个地址再次悄悄回来。
        # 2026-08-11：计划文档已按「计划书不入库」迁往 work/（gitignore），
        # 原豁免项 docs/superpowers/plans/2026-07-15-engineering-hardening.md
        # 随之失效并移除——白名单必须随内容收缩，这就是上面那段教训的执行。
        # 当前白名单为空；确需新增时只加精确路径，不加目录或通配。
        :
        hits=$(grep -nE "$IP_RE" "$path" 2>/dev/null || true)
        hits=$(printf '%s\n' "$hits" | grep -vE "$IP_ALLOW" || true)
        if [[ -n "$hits" ]]; then
            note "个人 IP：$path"
            print_matches "$hits"
        fi
    done
}

scan_simple_matches() {
    local pattern="$1" label="$2" path hits
    while IFS= read -r -d '' path; do
        hits=$(grep -niE "$pattern" "$path" 2>/dev/null || true)
        if [[ -n "$hits" ]]; then
            note "$label：$path"
            print_matches "$hits"
        fi
    done
}

# CLAUDE.md 与 AGENTS.md 分别被 Claude / Codex 读取。两份内容一旦分裂，两个执行者
# 就会依据不同规则施工——实际发生过：AGENTS.md 在 2026-07-15 加了工程基线，CLAUDE.md
# 停在 07-04，Claude 因此一个月不知道「新角色整包必须走 wf_character_flow.py」。
# 首行标题允许不同，其余必须逐字相同。
#
# 判据分三层，前两层决定「该不该有」，第三层才比内容：
#
#   ① 血缘：AGENTS.md 是否在 HEAD 血缘中出现过。
#      不能用 CLAUDE.md —— 上游 main 在 199f37a8(2026-07-23) 主动删过它，
#      拿它当信号会把上游基线误判成 fork。AGENTS.md 在上游历史里从未出现。
#   ② index 跟踪状态：CLAUDE.md 与 AGENTS.md 必须**分别**校验。
#      聚合成单一 tracked 位时，「一份 tracked、另一份 untracked」会被放行。
#   ③ 内容：staged 模式比 index blob（即将提交的内容），--all 模式比工作树。
#      拿工作树内容冒充 staged 内容，会让「index 分裂但工作树一致」蒙混过关。
#
# 前两版都栽在同一处：初版看「盘上有没有」（删一份报错、删两份放行），
# v1.11 看「index 有没有」（git rm 双删并提交后 index 已空，被误判成合法基线）。
# 两者都不是「该不该有」。
#
# 浅克隆无父提交时 git 把树内文件全当新增，rev-list 查不到 AGENTS.md，
# 血缘不可判 —— 必须 fail closed，否则 `--depth=1` 就是现成的绕过路径。
# 代价是：以上游为基线的浅克隆也会被拒。若上游将来引入 AGENTS.md，
# 本判据失效，rebase 前必须换成显式标记（已记入 docs/协作对齐-Claude-Codex.md）。
# index 条目是否是一份「正常的规则书」：stage 0、mode 100644、非 intent-to-add。
# 三项缺一不可 —— `git ls-files --error-unmatch` 对下面两种都返回 0：
#   · intent-to-add（`git add -N`）：stage 0 / mode 100644，但 blob 是空的（flags 带 0x20000000）
#   · symlink（mode 120000）：blob 只有一行目标路径，剥掉首行后两边都为空会比成「一致」
agent_doc_index_ok() {
    local path="$1" line mode stage flags
    line=$(git ls-files --stage -- "$path" 2>/dev/null) || return 1
    [[ -n "$line" ]] || return 1
    mode=${line%% *}
    stage=$(printf '%s' "$line" | awk '{print $3; exit}')
    [[ "$mode" == '100644' ]] || return 1
    [[ "$stage" == '0' ]] || return 1
    flags=$(git ls-files --debug -- "$path" 2>/dev/null | awk '/flags:/ {print $NF; exit}')
    if [[ "$flags" =~ ^[0-9a-fA-F]+$ ]]; then
        (( (0x$flags & 0x20000000) == 0 )) || return 1
    fi
    return 0
}

# 取出规则书正文并校验形状。source=index 取即将提交的 blob，source=worktree 取工作树文件。
# 拒绝：读不到、0 字节、首行标题不符、只有标题没有正文。
agent_doc_body() {
    local path="$1" source="$2" out="$3" first
    if [[ "$source" == 'index' ]]; then
        git show ":$path" > "$out" 2>/dev/null || return 1
    else
        [[ -f "$path" && ! -L "$path" ]] || return 1
        cat -- "$path" > "$out" 2>/dev/null || return 1
    fi
    [[ -s "$out" ]] || return 1
    first=$(head -n 1 -- "$out")
    [[ "$first" == "# $path" ]] || return 1
    tail -n +2 -- "$out" | grep -q '[^[:space:]]' || return 1
    return 0
}

check_agent_docs_in_sync() {
    local in_index_claude=0 in_index_agents=0 ok_claude=0 ok_agents=0
    local has_claude=0 has_agents=0 shallow lineage
    local lineage_known=0 has_lineage=0 ctx bad='' source label
    local body_claude body_agents

    git ls-files --error-unmatch CLAUDE.md >/dev/null 2>&1 && in_index_claude=1
    git ls-files --error-unmatch AGENTS.md >/dev/null 2>&1 && in_index_agents=1
    agent_doc_index_ok CLAUDE.md && ok_claude=1
    agent_doc_index_ok AGENTS.md && ok_agents=1
    [[ -e CLAUDE.md || -L CLAUDE.md ]] && has_claude=1
    [[ -e AGENTS.md || -L AGENTS.md ]] && has_agents=1

    # 血缘判定。三条硬要求：
    #   ① 用 --full-history —— 默认 rev-list 会做 merge path-history simplification：
    #      普通双父 merge 中规则书只存在于第二父、merge 最终树又删掉两份时，默认查询返回空，
    #      血缘被漏判，staged/--all/fresh clone 全部放行。
    #   ② 不把 git 查询失败吞成「无血缘」—— 缺祖先对象的非浅仓里 rev-list rc=128。
    #   ③ unborn HEAD 单独判定：确定没有任何历史，血缘可判定为「无」。
    if ! git rev-parse --verify --quiet HEAD >/dev/null 2>&1; then
        lineage_known=1
        has_lineage=0
    else
        shallow=$(git rev-parse --is-shallow-repository 2>/dev/null || printf 'unknown')
        if [[ "$shallow" == 'false' ]]; then
            if lineage=$(git rev-list --full-history --max-count=1 HEAD -- AGENTS.md 2>/dev/null); then
                lineage_known=1
                [[ -n "$lineage" ]] && has_lineage=1
            fi
        fi
    fi

    # 合法上游基线只有一种形态：血缘可判定且为「无」，且两份既不在 index 也不在磁盘。
    # 少一个条件都不算 —— 单个 untracked 规则书、或两份分裂的 untracked 规则书，都必须拒绝。
    if (( lineage_known && !has_lineage )) \
        && (( !in_index_claude && !in_index_agents && !has_claude && !has_agents )); then
        return 0
    fi

    ctx='本仓血缘要求'
    (( lineage_known )) || ctx='血缘不可判定（浅克隆或历史对象缺失），保守要求'

    if (( !ok_claude || !ok_agents )); then
        (( ok_claude )) || bad='CLAUDE.md'
        (( ok_agents )) || bad="${bad:+$bad 与 }AGENTS.md"
        note "${ctx}两份规则书都作为普通文件被 git 跟踪，但 ${bad} 不满足（需 stage 0、mode 100644、非 intent-to-add）"
        return 0
    fi

    if [[ "$MODE" == '--all' ]]; then
        source='worktree'
        label='工作树'
        if (( !has_claude && !has_agents )); then
            note 'CLAUDE.md 与 AGENTS.md 均被跟踪但都不在工作区——两份必须同时存在且内容一致'
            return 0
        fi
        if (( has_claude != has_agents )); then
            if (( has_claude )); then
                note 'AGENTS.md 缺失（CLAUDE.md 存在）——两份必须同时存在且内容一致'
            else
                note 'CLAUDE.md 缺失（AGENTS.md 存在）——两份必须同时存在且内容一致'
            fi
            return 0
        fi
    else
        source='index'
        label='index'
    fi

    body_claude=$(mktemp)
    body_agents=$(mktemp)
    if ! agent_doc_body CLAUDE.md "$source" "$body_claude"; then
        note "CLAUDE.md 在${label}里不是合法规则书（0 字节、首行标题不是 '# CLAUDE.md'、或只有标题没有正文）"
        rm -f -- "$body_claude" "$body_agents"
        return 0
    fi
    if ! agent_doc_body AGENTS.md "$source" "$body_agents"; then
        note "AGENTS.md 在${label}里不是合法规则书（0 字节、首行标题不是 '# AGENTS.md'、或只有标题没有正文）"
        rm -f -- "$body_claude" "$body_agents"
        return 0
    fi
    if ! diff -q <(tail -n +2 -- "$body_claude") <(tail -n +2 -- "$body_agents") >/dev/null 2>&1; then
        note "CLAUDE.md 与 AGENTS.md 内容分裂（除首行标题外必须逐字相同；${MODE} 模式比对${label}）"
        printf '%s\n' '      差异预览：'
        diff <(tail -n +2 -- "$body_claude") <(tail -n +2 -- "$body_agents") 2>/dev/null \
            | sed -n '1,10{s/^/        /;p;}'
    fi
    rm -f -- "$body_claude" "$body_agents"
}

check_agent_docs_in_sync

if [[ "$MODE" == '--all' ]]; then
    scan_paths < <(git ls-files -z)
else
    scan_paths < <(git diff --cached --name-only --diff-filter=ACM -z)
fi

if [[ -s "$paths_file" ]]; then
    # stat/grep 由 xargs 分批调用，避免 Windows 上逐文件启动数万个进程。
    scan_sizes < <(xargs -0 -r stat --printf='%s\0%n\0' -- < "$paths_file" 2>/dev/null)
    scan_ip_matches < <(xargs -0 -r grep -IlZ -E "$IP_RE" -- < "$paths_file" 2>/dev/null)
    scan_simple_matches "$HOME_RE" '家目录路径' < <(xargs -0 -r grep -IlZ -E "$HOME_RE" -- < "$paths_file" 2>/dev/null)
    scan_simple_matches "$EMAIL_RE" '个人邮箱' < <(xargs -0 -r grep -IlZ -E "$EMAIL_RE" -- < "$paths_file" 2>/dev/null)
fi

if (( fail != 0 )); then
    printf '\n提交卫生检查失败：请清除上述个人 IP、家目录、个人邮箱、.env、无授权大二进制，\n'
    printf '%s\n' '或修复 CLAUDE.md / AGENTS.md 的内容分裂后再提交。'
    printf '%s\n' '（host/port 用 env 或 request.headers.host；路径用相对路径；确为占位示例时仅加窄白名单。）'
    exit 1
fi
exit 0
