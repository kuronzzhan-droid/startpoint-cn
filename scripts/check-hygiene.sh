#!/usr/bin/env bash
# 提交卫生检查:阻止个人 IP / 家目录 / 个人邮箱 / .env / 大二进制 进入提交或仓库。
# 用法:
#   bash scripts/check-hygiene.sh          # 检查已暂存(pre-commit 钩子用)
#   bash scripts/check-hygiene.sh --all     # 检查整树(CI 用)
set -uo pipefail

MODE="${1:-staged}"
fail=0
note() { echo "  [x] $*"; fail=1; }

allowed_nested_tool_line() {
    local kind="$1" path="$2" line="$3" normalized
    normalized=$(printf '%s' "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    case "$kind|$path|$normalized" in
        'ip|tools/fantasy-gauntlet-mod-tools/wf_release_v1/_loopback_http.py|ipaddress.ip_network("192.168.0.0/16"),') return 0 ;;
        'ip|tools/fantasy-gauntlet-mod-tools/wf_release_v1/platform.py|ipaddress.ip_network("192.168.0.0/16"),') return 0 ;;
        'ip|tools/fantasy-gauntlet-mod-tools/wf_release_v1/target.py|ipaddress.ip_network("192.168.0.0/16"),') return 0 ;;
        'home|tools/fantasy-gauntlet-mod-tools/tests/test_release_v1_canonical.py|r"C:\Users\Alice\secret.json",') return 0 ;;
        'home|tools/fantasy-gauntlet-mod-tools/tests/test_release_v1_canonical.py|"C:/Users/Alice/secret.json",') return 0 ;;
        'home|tools/fantasy-gauntlet-mod-tools/tests/test_release_v1_canonical.py|"/Users/Alice/secret.json",') return 0 ;;
        # Preserve the upstream Node.js v20.20.2 copyright notice verbatim.
        # Only this exact public attribution in this exact license is allowed.
        'email|tools/player-save-extractor/NODE-LICENSE.txt|Copyright (c) 2016 Jean-Philippe Aumasson <jeanphilippe.aumasson@gmail.com>') return 0 ;;
    esac
    return 1
}

scan_sensitive_lines() {
    local kind="$1" label="$2" regex="$3" path="$4"
    local hit line found=0 shown=0 grep_flags='-nE'
    [ "$kind" = "email" ] && grep_flags='-niE'
    while IFS= read -r hit; do
        [ -z "$hit" ] && continue
        line="${hit#*:}"
        if [ "$kind" = "ip" ] && printf '%s\n' "$line" | grep -qE "$IP_ALLOW"; then
            continue
        fi
        if allowed_nested_tool_line "$kind" "$path" "$line"; then
            continue
        fi
        if [ "$found" -eq 0 ]; then
            note "$label: $path"
            found=1
        fi
        if [ "$shown" -lt 3 ]; then
            echo "      $hit"
            shown=$((shown + 1))
        fi
    done < <(grep "$grep_flags" "$regex" "$path" 2>/dev/null)
}

tracked_paths() {
    if [ "$MODE" = "--all" ]; then
        git ls-files -z
    else
        git diff --cached --name-only --diff-filter=ACM -z
    fi
}

allowed_legacy_artwork() {
    local path="$1" size="$2" checksum
    # Preserve this existing reproducible source image only. A renamed image,
    # changed image or another large binary must still satisfy the normal rule.
    [ "$path" = "assets/asset-patch/artwork/five-boss/ui-20260911/五重关卡-讨伐页.png" ] || return 1
    [ "$size" -eq 1397251 ] || return 1
    checksum=$(sha256sum -- "$path") || return 1
    [ "${checksum%% *}" = "d93b308b548633fd931000716b71de81a7cf3f278a30e5609cd641fabf5adedb" ]
}

IP_RE='192\.168\.[0-9]+\.[0-9]+'
HOME_RE='/Users/[A-Za-z0-9_]+'
EMAIL_RE='[A-Za-z0-9._%+-]+@(qq|gmail|163|126|outlook|hotmail|foxmail|yahoo)\.com'
# 有意保留的通用占位示例(白名单)
IP_ALLOW='192\.168\.1\.10'

while IFS= read -r -d '' f; do
    [ -z "$f" ] && continue
    [ -f "$f" ] || continue
    case "$f" in
        scripts/check-hygiene.sh|scripts/hooks/*|.github/workflows/hygiene.yml) continue ;;
        tools/fantasy-gauntlet-mod-tools/scripts/check-hygiene.sh) continue ;;
        tools/fantasy-gauntlet-mod-tools/scripts/tests/test-hygiene.sh) continue ;;
    esac

    if [ "$f" = ".env" ]; then note ".env 不得提交(仅提交 .env.example)"; continue; fi

    case "$f" in
        .cdn/cn/archive-*-diff/*.zip)
            note "自定义增量包不得提交到 .cdn；请发布到 assets/asset-patch/active: $f"
            continue
            ;;
    esac

    sz=$(wc -c < "$f" 2>/dev/null || echo 0)
    if [ "$sz" -gt 1048576 ]; then
        case "$f" in
            assets/asset-patch/active/*.zip) ;;   # 部署必需的客户端增量包
            tools/fantasy-gauntlet-mod-tools/WF_PATHLIST_recovered.txt) ;; # MOD 工具路径索引
            *.json|*.csv|*.md) ;;                 # 允许大数据/文档
            *)
                if ! allowed_legacy_artwork "$f" "$sz"; then
                    note "大文件 >1MB(二进制不应入库,改用生成脚本): $f"
                fi
                ;;
        esac
    fi

    # 仅扫描文本文件
    if grep -Iq . "$f" 2>/dev/null; then
        scan_sensitive_lines "ip" "个人 IP" "$IP_RE" "$f"
        scan_sensitive_lines "home" "家目录路径" "$HOME_RE" "$f"
        scan_sensitive_lines "email" "个人邮箱" "$EMAIL_RE" "$f"
    fi
done < <(tracked_paths)

if [ "$fail" -ne 0 ]; then
    echo ""
    echo "提交卫生检查失败:请清除上述 个人 IP / 家目录 / 个人邮箱 / .env / 大二进制 后再提交。"
    echo "(host/port 用 env 或 request.headers.host;路径用相对/__dirname;确为占位示例则加入白名单)"
    exit 1
fi
exit 0
