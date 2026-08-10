#!/usr/bin/env bash
# 提交卫生检查：阻止个人 IP、家目录、个人邮箱、.env 和无授权大二进制进入仓库。
# 用法：
#   bash scripts/check-hygiene.sh          # 检查已暂存文件（pre-commit）
#   bash scripts/check-hygiene.sh --all    # 检查全部已跟踪文件（CI）
set -uo pipefail

MODE="${1:-staged}"
fail=0
note() { printf '  [x] %s\n' "$*"; fail=1; }

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
check_agent_docs_in_sync() {
    [[ -f CLAUDE.md && -f AGENTS.md ]] || return 0
    if ! diff -q <(tail -n +2 CLAUDE.md) <(tail -n +2 AGENTS.md) >/dev/null 2>&1; then
        note 'CLAUDE.md 与 AGENTS.md 内容分裂（除首行标题外必须逐字相同）'
        printf '%s\n' '      差异预览：'
        diff <(tail -n +2 CLAUDE.md) <(tail -n +2 AGENTS.md) 2>/dev/null | sed -n '1,10{s/^/        /;p;}'
    fi
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
