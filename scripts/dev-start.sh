#!/usr/bin/env bash
# dev-start.sh —— campus-trade 本地开发一键启动（Git Bash 下运行）
# 顺序：探测局域网主 IP → 同步 miniprogram/config.ts → MySQL → server(3000) → admin-web(5173)
# 用法：bash scripts/dev-start.sh [--no-miniprogram-config]
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MYSQL_DIR="$ROOT/.local-mysql/mysql-8.0.40-winx64"
CONFIG="$ROOT/miniprogram/config.ts"

# 1. 探测默认路由网卡的 IPv4（DHCP 环境下每次开机可能变化）
LAN_IP=$(powershell -NoProfile -Command "Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object RouteMetric | Select-Object -First 1 | ForEach-Object { (Get-NetIPAddress -InterfaceIndex \$_.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).IPAddress }" | tr -d '\r')
if [ -z "$LAN_IP" ]; then echo "[warn] 未探测到局域网 IP，跳过 config.ts 同步"; fi

# 2. 同步小程序 API_BASE / STATIC_BASE
if [ -n "$LAN_IP" ] && [ "${1:-}" != "--no-miniprogram-config" ]; then
  sed -i -E "s|http://[0-9.]+:3000/api/v1|http://$LAN_IP:3000/api/v1|; s|http://[0-9.]+:3000'|http://$LAN_IP:3000'|" "$CONFIG"
  echo "[ok] config.ts → $LAN_IP"
fi

port_busy() { netstat -ano | grep -q ":$1.*LISTENING"; }

# 3. MySQL 8.0（便携版）
if port_busy 3306; then
  echo "[skip] MySQL 3306 已在运行"
else
  (cd "$MYSQL_DIR" && ./bin/mysqld.exe --datadir="$MYSQL_DIR\\data" --port=3306 \
    --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci --console \
    > "$ROOT/.local-mysql/mysqld.log" 2>&1 &)
  sleep 5
  port_busy 3306 && echo "[ok] MySQL 3306" || { echo "[fail] MySQL 启动失败，看 .local-mysql/mysqld.log"; exit 1; }
fi

# 4. 后端 server（ts-node，改代码需重启）
if port_busy 3000; then
  echo "[skip] server 3000 已在运行"
else
  (cd "$ROOT/server" && npm run dev > "$ROOT/.local-mysql/server.log" 2>&1 &)
  for i in $(seq 1 15); do sleep 1; curl -sf http://localhost:3000/health >/dev/null 2>&1 && break; done
  curl -sf http://localhost:3000/health >/dev/null 2>&1 && echo "[ok] server 3000" || { echo "[fail] server 启动失败，看 .local-mysql/server.log"; exit 1; }
fi

# 5. 管理后台 admin-web（vite 5173）
if port_busy 5173; then
  echo "[skip] admin-web 5173 已在运行"
else
  (cd "$ROOT" && npm run dev --workspace admin-web > "$ROOT/.local-mysql/vite.log" 2>&1 &)
  sleep 4
  port_busy 5173 && echo "[ok] admin-web 5173" || echo "[fail] admin-web 启动失败，看 .local-mysql/vite.log"
fi

echo "----"
echo "管理后台:  http://localhost:5173  (admin / Admin@2026)"
echo "后端 API:  http://localhost:3000  (局域网: http://$LAN_IP:3000)"
echo "小程序:    微信开发者工具打开 miniprogram/ 即可"
