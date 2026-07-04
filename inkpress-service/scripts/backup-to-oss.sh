#!/bin/bash
#
# 服务器侧备份脚本：SQLite 在线备份 → gzip → 上传 OSS → 清理过期备份
#
# 设计要点：
#   - sqlite3 .backup 走 Online Backup API，运行中安全、不锁库
#   - gzip -9 压缩，SQLite 全零页压缩比高
#   - OSS 凭证从 ~/.ossutilconfig 读取（setup-ops.sh 配置）
#   - 本地 + OSS 双通道保留 7 天
#   - 日志写到 /var/log/inkpress-backup.log
#   - flock 防止 cron 重入
#
# 手动执行：/opt/inkpress-service/backup-to-oss.sh
# 排障查日志：tail -100 /var/log/inkpress-backup.log
#
set -euo pipefail

# ========== 配置 ==========
REMOTE_DIR="/opt/inkpress-service"
ENV_FILE="$REMOTE_DIR/.env.production"
DB_FILE="$REMOTE_DIR/data/inkpress-service.db"
LOCAL_BACKUP_DIR="$REMOTE_DIR/backups"
LOG_FILE="/var/log/inkpress-backup.log"
LOCK_FILE="/var/lock/inkpress-backup.lock"
RETENTION_DAYS=7
OSS_PREFIX="inkpress-service/backups"
OSSUTIL="/usr/local/bin/ossutil"
# ==========================

mkdir -p "$(dirname "$LOG_FILE")" "$(dirname "$LOCK_FILE")" "$LOCAL_BACKUP_DIR"

# 日志输出同时进文件和 stderr（手动跑时能看到）
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE" >&2; }

# 单实例锁（cron 重入保护）
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 另一个备份进程正在运行，跳过" >> "$LOG_FILE"
  exit 0
fi

# 读取 OSS 配置（来自 .env.production，单一来源）
get_env() {
  grep "^${1}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d'=' -f2- | tr -d '"' || true
}
OSS_REGION=$(get_env OSS_PUBLISH_REGION)
OSS_BUCKET=$(get_env OSS_PUBLISH_BUCKET)

if [ -z "$OSS_REGION" ] || [ -z "$OSS_BUCKET" ]; then
  log "✗ OSS 配置不完整（检查 $ENV_FILE 中 OSS_PUBLISH_REGION / OSS_PUBLISH_BUCKET）"
  exit 1
fi
OSS_ENDPOINT="oss-${OSS_REGION}.aliyuncs.com"

# 前置检查
[ -f "$DB_FILE" ] || { log "✗ 数据库不存在：$DB_FILE"; exit 1; }
[ -x "$OSSUTIL" ] || { log "✗ ossutil 未安装：$OSSUTIL（重跑 setup-ops.sh）"; exit 1; }
command -v sqlite3 >/dev/null 2>&1 || { log "✗ sqlite3 未安装（apt install sqlite3）"; exit 1; }

TIMESTAMP=$(date '+%Y%m%d-%H%M%S')
BACKUP_NAME="inkpress-service-$TIMESTAMP"
TMP_DB="$LOCAL_BACKUP_DIR/$BACKUP_NAME.db"
ARCHIVE="$LOCAL_BACKUP_DIR/$BACKUP_NAME.tar.gz"

# 1. SQLite 在线备份
log ">>> 开始备份 $DB_FILE"
if ! sqlite3 "$DB_FILE" ".backup '$TMP_DB'" 2>>"$LOG_FILE"; then
  log "✗ sqlite3 backup 失败"
  rm -f "$TMP_DB"
  exit 1
fi

[ -s "$TMP_DB" ] || { log "✗ 备份文件为空"; rm -f "$TMP_DB"; exit 1; }

DB_SIZE=$(du -h "$TMP_DB" | awk '{print $1}')
log "  ✓ SQLite 备份完成（$DB_SIZE）"

# 2. gzip 压缩（-9 最高压缩比，SQLite 全零页压缩效果显著）
gzip -9 -c "$TMP_DB" > "$ARCHIVE"
rm -f "$TMP_DB"
ARCHIVE_SIZE=$(du -h "$ARCHIVE" | awk '{print $1}')
log "  ✓ 压缩完成（$ARCHIVE_SIZE）"

# 3. 上传 OSS
OSS_PATH="oss://$OSS_BUCKET/$OSS_PREFIX/$BACKUP_NAME.tar.gz"
log ">>> 上传到 $OSS_PATH"
if ! "$OSSUTIL" cp "$ARCHIVE" "$OSS_PATH" \
    -e "$OSS_ENDPOINT" --retry-timeout 60 >>"$LOG_FILE" 2>&1; then
  log "✗ OSS 上传失败（endpoint=$OSS_ENDPOINT）"
  rm -f "$ARCHIVE"
  exit 1
fi
log "  ✓ OSS 上传完成"

# 4. 清理 OSS 过期备份（按文件名日期字符串比较，YYYYMMDD-HHMMSS 字典序=时间序）
CUTOFF=$(date -d "$RETENTION_DAYS days ago" '+%Y%m%d-%H%M%S')
log ">>> 清理 OSS 中 $RETENTION_DAYS 天前的备份（cutoff: $CUTOFF）"

DELETED=0
"$OSSUTIL" ls "oss://$OSS_BUCKET/$OSS_PREFIX/" \
  -e "$OSS_ENDPOINT" 2>/dev/null \
  | grep -oE "inkpress-service-[0-9]{8}-[0-9]{6}\.tar\.gz" \
  | sort -u \
  | while read -r fname; do
      fdate=$(printf '%s' "$fname" | grep -oE '[0-9]{8}-[0-9]{6}')
      if [[ "$fdate" < "$CUTOFF" ]]; then
        if "$OSSUTIL" rm "oss://$OSS_BUCKET/$OSS_PREFIX/$fname" \
            -e "$OSS_ENDPOINT" -f >/dev/null 2>&1; then
          log "  ✓ 删除过期 OSS 备份：$fname"
        fi
      fi
    done

# 5. 本地保留最近 7 份（防止磁盘占满）
ls -1t "$LOCAL_BACKUP_DIR"/inkpress-service-*.tar.gz 2>/dev/null \
  | tail -n +$((RETENTION_DAYS + 1)) \
  | while read -r old; do
      rm -f "$old"
      log "  ✓ 清理本地：$(basename "$old")"
    done

log "=== 备份完成（local + OSS 双通道，保留 $RETENTION_DAYS 天）==="
