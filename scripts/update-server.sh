#!/usr/bin/env bash
# 东北大学校史地图：服务器更新代码（保护线上数据）
#
# 用法：sudo bash /tmp/xsdt-update.sh
#
# 做的事：备份 → 停服务 → 把 data/ 和 public/uploads/ 移出项目目录 → 拉取代码
#         → 把线上数据放回 → 装依赖 → 重启 → 验收
#
# 线上数据（后台上传的图片、地点视频、手绘图说明、账号、AI 配置）永远以服务器为准，
# 不会被仓库里的旧版本覆盖。任何一步出错都会把数据放回并重启服务，然后带着报错退出。
set -e

APP_DIR="${APP_DIR:-/var/www/xiaoshiditu/jindaishi}"
REPO_HTTP="${REPO_HTTP:-https://github.com/sixlights741/jindaishi.git}"
CODELOAD_URL="${CODELOAD_URL:-https://codeload.github.com/sixlights741/jindaishi/tar.gz/refs/heads/main}"
BACKUP_DIR="${BACKUP_DIR:-/root}"
TMP_TGZ="${TMP_TGZ:-/tmp/jindaishi-main.tar.gz}"
TMP_DIR="${TMP_DIR:-/tmp/jindaishi-main}"

# 把线上数据挪出项目目录（同一分区内只是改名，瞬间完成，不占额外空间）
stash_data() {
  cd "$APP_DIR" || return 1
  mv data data.online
  mv public/uploads public/uploads.online
  return 0
}

# 把线上数据放回原位。可重复调用（幂等）：data.online / public/uploads.online 存在才动手。
restore_data() {
  cd "$APP_DIR" || return 1
  if [ -d data.online ]; then
    rm -rf data
    mv data.online data
    echo "  已放回 data/"
  fi
  if [ -d public/uploads.online ]; then
    rm -rf public/uploads
    mv public/uploads.online public/uploads
    echo "  已放回 public/uploads/"
  fi
  return 0
}

# 出错统一走这里：放回数据、恢复服务、然后退出（绝不让脚本带着半成品状态继续往下跑）
fail() {
  trap - ERR
  set +e
  echo ""
  echo "[ERROR] $1"
  echo "        正在把线上数据放回并恢复服务..."
  restore_data
  sudo pm2 restart all || true
  echo "[ERROR] 已回到更新前的状态，网站应该还能访问。把上面的报错发出来即可根因排查。"
  exit 1
}

trap 'fail "更新中断"' ERR

echo "[1/7] 基础配置..."
git config --global --add safe.directory "$APP_DIR" || true
git config --global http.version HTTP/1.1
git config --global http.lowSpeedLimit 0
git config --global http.lowSpeedTime 999999
sudo chown -R admin:admin "$APP_DIR" 2>/dev/null || true
cd "$APP_DIR"

if [ -e data.online ] || [ -e public/uploads.online ]; then
  echo "[STOP] 发现上次更新遗留的 data.online / public/uploads.online（那是线上数据）。"
  echo "       先执行下面这一行把它放回，再重新运行本脚本："
  echo "       cd $APP_DIR && [ -d data.online ] && { rm -rf data; mv data.online data; }; [ -d public/uploads.online ] && { rm -rf public/uploads; mv public/uploads.online public/uploads; }"
  exit 1
fi

echo "[2/7] 备份线上数据到 $BACKUP_DIR ..."
sudo mkdir -p "$BACKUP_DIR"
sudo tar czf "$BACKUP_DIR/xsdt-backup-$(date +%F-%H%M).tgz" data public/uploads
sudo ls -lh "$BACKUP_DIR"/xsdt-backup-*.tgz | tail -1

echo "[3/7] 停服务，把线上数据就地挪开（只是改名，不占额外空间）..."
sudo pm2 stop all || true
stash_data || fail "挪开线上数据失败"

echo "[4/7] 拉取代码..."
git remote set-url origin "$REPO_HTTP" || true
if git fetch --depth=1 origin main && git reset --hard origin/main; then
  echo "[OK] Git 拉取成功"
else
  echo "[WARN] Git 拉取失败，改用压缩包兜底..."
  if curl -L --retry 5 --retry-delay 2 -o "$TMP_TGZ" "$CODELOAD_URL" \
    && tar -xzf "$TMP_TGZ" -C /tmp \
    && rsync -av --delete \
      --exclude ".git" \
      --exclude "node_modules" \
      --exclude "data/" \
      --exclude "public/uploads/" \
      "$TMP_DIR"/ "$APP_DIR"/; then
    echo "[OK] 压缩包覆盖完成"
  else
    fail "代码拉取失败：Git 和压缩包都没成功，已放弃更新"
  fi
fi

echo "[5/7] 放回线上数据..."
mv data data.fromrepo
rm -rf public/uploads
restore_data || fail "放回线上数据失败"

if [ -f data.fromrepo/places.json ]; then
  # 如果组员手改过 places.json 后推了代码，这里会提示线上缺哪些地点
  node -e '
    const fs = require("fs");
    const repo = JSON.parse(fs.readFileSync("data.fromrepo/places.json", "utf8"));
    const live = JSON.parse(fs.readFileSync("data/places.json", "utf8"));
    const ids = new Set(live.map((p) => p.id));
    const onlyRepo = repo.filter((p) => !ids.has(p.id)).map((p) => `${p.id}(${p.name})`);
    console.log(onlyRepo.length ? `[注意] 仓库版里有线上没有的地点：${onlyRepo.join("、")}` : "[OK] 仓库版没有线上缺失的地点");
  ' || echo "[WARN] 对比失败，请手动核对 data.fromrepo/places.json"
  rm -rf data.fromrepo
fi

echo "[6/7] 安装依赖并重启..."
npm install --omit=dev
sudo pm2 restart all || sudo pm2 start src/server.js --name neu-xsdt
sudo pm2 save

echo "[7/7] 验收..."
if [ -f data/places.json ]; then
  echo "[OK] 线上数据已就位（data/places.json）"
else
  echo "[ERROR] 线上数据不完整！请用备份恢复：sudo tar xzf $BACKUP_DIR/xsdt-backup-*.tgz -C $APP_DIR/"
fi
if [ -f src/services/uploadedFileName.js ]; then
  echo "[OK] 新模块 src/services/uploadedFileName.js 已就位"
else
  echo "[ERROR] 缺少 src/services/uploadedFileName.js，代码没更新完整！"
fi
sudo pm2 status
curl -I https://neu-xsdt.top || true

trap - ERR
echo ""
echo "完成。验收要点："
echo "  1) 上面的 pm2 状态是 online，curl 返回 200"
echo "  2) 打开一个最近在后台加过内容的地点，图片/视频/手绘图说明都在"
echo "  3) 后台编辑该地点：说明框自动带出已有说明，视频框带出已有链接（最多 5 条）"
echo "备份文件在 $BACKUP_DIR/xsdt-backup-*.tgz，确认页面正常后可删除较旧的备份。"
