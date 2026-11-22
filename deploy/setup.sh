#!/usr/bin/env bash
# 在服务器上以 root 执行：bash setup.sh
set -euo pipefail
APP=/opt/yujian

echo "== 1/6 安装基础包 =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates nginx sqlite3 rsync

echo "== 2/6 安装 Node.js 22 =="
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "== 3/6 创建运行用户与目录 =="
id -u yujian >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin yujian
mkdir -p "$APP/data" "$APP/uploads" "$APP/backups"
chown -R yujian:yujian "$APP"

echo "== 4/6 生成 .env（已存在则跳过）=="
if [ ! -f "$APP/.env" ]; then
  cat > "$APP/.env" <<ENVEOF
PORT=5173
JWT_SECRET=$(openssl rand -hex 32)
MEMBER_MODE=free
PUBLISH_MODE=admin
FORCE_HTTPS=0
ENVEOF
  echo "已写入 $APP/.env"
else
  echo ".env 已存在，保持不动"
fi
chown yujian:yujian "$APP/.env"
chmod 600 "$APP/.env"

echo "== 5/6 安装 systemd 服务 =="
cp "$(dirname "$0")/yujian.service" /etc/systemd/system/yujian.service
systemctl daemon-reload
systemctl enable --now yujian
sleep 2

echo "== 6/6 健康检查 =="
if curl -fsS -o /dev/null http://127.0.0.1:5173/; then
  echo "✅ 应用已启动：http://127.0.0.1:5173"
else
  echo "❌ 启动失败，看日志：journalctl -u yujian -n 50 --no-pager"
  exit 1
fi
systemctl --no-pager status yujian | head -8
