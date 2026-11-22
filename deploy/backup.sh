#!/usr/bin/env bash
set -euo pipefail
APP=/opt/yujian
DIR=/opt/yujian/backups
mkdir -p "$DIR"
STAMP=$(date +%Y%m%d-%H%M%S)

# SQLite 一致性备份（必须用 .backup，不能直接 cp）
sqlite3 "$APP/data/app.db" ".backup '$DIR/app-$STAMP.db'"
tar -czf "$DIR/uploads-$STAMP.tar.gz" -C "$APP" uploads

# 只保留最近 7 份
ls -1t "$DIR"/app-*.db 2>/dev/null | tail -n +8 | xargs -r rm -f
ls -1t "$DIR"/uploads-*.tar.gz 2>/dev/null | tail -n +8 | xargs -r rm -f

echo "[backup] $STAMP done"
