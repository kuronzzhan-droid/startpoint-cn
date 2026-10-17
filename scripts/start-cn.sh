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
echo "[start] node --env-file=.env scripts/run-cn-logged.cjs"
mkdir -p "$ROOT/.logs"
nohup node --env-file=.env scripts/run-cn-logged.cjs > /dev/null 2>&1 &
LOGGER_PID=$!

sleep 2
if LOG_PATH="$(node -e '
    const fs = require("node:fs");
    try {
        const info = JSON.parse(fs.readFileSync(".logs/cn-server-current.json", "utf8"));
        if (info.loggerPid !== Number(process.argv[1]) || !info.pid || info.exitedAt) process.exit(1);
        process.kill(info.pid, 0);
        process.stdout.write(info.log);
    } catch { process.exit(1); }
' "$LOGGER_PID")"; then
    echo ""
    grep "CN StarPoint\|SEED\|Mode:\|SESSION" "$LOG_PATH" | tail -5 || true
    echo ""
    echo "=== 启动成功 ==="
    echo "  Web:  http://$(hostname -s):8001"
    echo "  Log:  $LOG_PATH"
    echo "  Rotation: 00/04/08/12/16/20 (UTC+08:00)"
    echo "  Current log: .logs/cn-server-current.json"
else
    echo ""
    echo "=== 启动未确认 — 检查 .logs/cn-server-current.json 和对应日志，logger PID=$LOGGER_PID ==="
    exit 1
fi
