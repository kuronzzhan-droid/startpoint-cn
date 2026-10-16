#!/usr/bin/env bash
# =============================================================================
# CN Server 启动脚本
# 用法: bash scripts/start-cn.sh
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== CN StarPoint Server ==="

# Kill old process
if pkill -f "cn-server.js" 2>/dev/null; then
    echo "[kill] 已终止旧进程"
    sleep 1
fi

# Build
echo "[build] npm run build..."
npm run build 2>&1 | sed '/Browserslist/d;/caniuse/d'

# Start
echo "[start] node --env-file=.env out/cn-server.js"
mkdir -p "$ROOT/.logs"
nohup node --env-file=.env out/cn-server.js > "$ROOT/.logs/cn-server.log" 2>&1 &

sleep 2
if pgrep -f "cn-server.js" > /dev/null; then
    echo ""
    grep "CN StarPoint\|SEED\|Mode:\|SESSION" "$ROOT/.logs/cn-server.log" | tail -5
    echo ""
    echo "=== 启动成功 ==="
    echo "  Web:  http://$(hostname -s):8001"
    echo "  Log:  tail -f $ROOT/.logs/cn-server.log"
else
    echo ""
    echo "=== 启动失败 — 检查 $ROOT/.logs/cn-server.log ==="
    tail -10 "$ROOT/.logs/cn-server.log"
    exit 1
fi
