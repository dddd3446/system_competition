#!/usr/bin/env bash
# 還原 Firebase 資料到備份時的狀態。
#
#   bash backup/restore.sh backup/firebase-full-<timestamp>.json
#
# 注意：這會覆蓋資料庫上 wushu_data/ 的全部內容。
# 規則若已改成 auth != null，此腳本會被拒絕（需先在 Console 改回全開放）。

set -euo pipefail

DB="https://wushu-competition-system-default-rtdb.asia-southeast1.firebasedatabase.app"
FILE="${1:-}"

if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "用法: bash backup/restore.sh <備份檔.json>"
  echo "可用備份："
  ls -1 backup/firebase-full-*.json 2>/dev/null || echo "  (找不到備份檔)"
  exit 1
fi

node -e "require('./$FILE')" >/dev/null 2>&1 || { echo "備份檔不是有效 JSON，中止"; exit 1; }

echo "即將用 $FILE 覆蓋資料庫的 wushu_data/"
read -p "確定嗎？(yes/no) " ans
[ "$ans" = "yes" ] || { echo "已取消"; exit 0; }

node -e "
const d = require('./$FILE');
process.stdout.write(JSON.stringify(d.wushu_data || {}));
" > /tmp/_restore_payload.json

code=$(curl -sS -o /dev/null -w "%{http_code}" -X PUT \
  --data-binary @/tmp/_restore_payload.json \
  "$DB/wushu_data.json")

rm -f /tmp/_restore_payload.json

if [ "$code" = "200" ]; then
  echo "還原完成 (HTTP 200)"
else
  echo "還原失敗 (HTTP $code) — 若為 401，表示規則已要求登入，請先到 Console 把規則改回全開放"
  exit 1
fi
