#!/usr/bin/env bash
# 东北大学校史地图：把服务器上的数据反向同步回 GitHub
#
# 用法：
#   sudo bash scripts/push-data-back.sh            # 正式提交并推送
#   sudo bash scripts/push-data-back.sh --dry-run  # 只看会改什么，不提交不推送
#
# 为什么需要这个脚本：
#   线上 data/places.json 比仓库版本多若干地点（含图片），这些内容只存在于服务器上。
#   scripts/update-server.sh 以线上数据为准，所以更新不会丢；但服务器 data/ 一旦损坏
#   （误删、磁盘故障、换机器）就无从恢复。本脚本把线上数据提交回仓库，等于做一份
#   git 备份。新电脑 clone 下来也能直接看到完整的线上内容。
#
# 安全边界（重要）：
#   只暂存 data/places.json 和 public/uploads/ 两项，绝不使用 `git add -A`。
#   data/users.json（含学号与密码哈希）、data/ai_config.json（含真实 API Key）、
#   data/student_ids.json、data/visit-counter.json 都已被 .gitignore 排除，本脚本
#   也不会碰它们；执行前还会再扫一遍暂存区，发现敏感文件名就中止。
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/xiaoshiditu/jindaishi}"
BRANCH="${BRANCH:-main}"
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --dry-run|-n) DRY_RUN=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "[ERROR] 未知参数：$arg（用 --help 看用法）"; exit 1 ;;
  esac
done

cd "$APP_DIR"

echo "=============================================="
echo " 把线上数据同步回 GitHub"
echo "   目录   : $APP_DIR"
echo "   分支   : $BRANCH"
echo "   模式   : $([ "$DRY_RUN" = "1" ] && echo '试运行（不提交不推送）' || echo '正式提交并推送')"
echo "=============================================="
echo ""

# ---------- 0. 前置检查 ----------
if [ ! -d .git ]; then
  echo "[ERROR] $APP_DIR 不是 git 仓库"
  exit 1
fi

if [ ! -f data/places.json ]; then
  echo "[ERROR] 找不到 data/places.json，确认 APP_DIR 是否正确"
  exit 1
fi

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "[ERROR] 没有配置 origin 远程仓库"
  exit 1
fi

# 先确认能连上远程。这里刻意用 fetch 而不是 pull：
# 服务器工作区长期处于「data/places.json 已修改」状态，pull 会被 Git 拒绝，
# 而 fetch 只更新远程引用，不碰工作区文件。
echo "[1/6] 连接远程仓库..."
git config --global --add safe.directory "$APP_DIR" >/dev/null 2>&1 || true
if ! git fetch origin "$BRANCH"; then
  echo "[ERROR] 无法读取远程仓库。先确认服务器能用 SSH 访问 GitHub："
  echo "        ssh -T git@github.com"
  echo "        若提示 Permission denied，见本仓库 docs/ 里的服务器部署说明。"
  exit 1
fi
echo "      远程 HEAD: $(git rev-parse --short "origin/$BRANCH")"

echo ""
echo "[2/6] 统计线上数据..."
PLACE_TOTAL=$(node -e "const p=require('./data/places.json');console.log(p.length)")
if git show "origin/$BRANCH:data/places.json" >/tmp/.xsdt-repo-places.json 2>/dev/null; then
  node -e '
    const fs = require("fs");
    const repo = JSON.parse(fs.readFileSync("/tmp/.xsdt-repo-places.json", "utf8").replace(/^\uFEFF/, ""));
    const live = JSON.parse(fs.readFileSync("data/places.json", "utf8").replace(/^\uFEFF/, ""));
    const repoIds = new Set(repo.map((p) => String(p.id)));
    const added = live.filter((p) => !repoIds.has(String(p.id)));
    console.log(`      仓库版本 ${repo.length} 个地点，线上 ${live.length} 个`);
    if (added.length === 0) {
      console.log("      线上没有仓库缺失的地点");
    } else {
      console.log(`      本次将补进仓库 ${added.length} 个地点：`);
      added.forEach((p) => console.log(`        + ${p.name}  [id=${p.id}]`));
    }
  '
  rm -f /tmp/.xsdt-repo-places.json
else
  echo "      仓库里还没有 data/places.json，本次将新建"
fi

UPLOAD_TOTAL=$(find public/uploads -maxdepth 1 -type f ! -name '.gitkeep' 2>/dev/null | wc -l | tr -d ' ')
UPLOAD_MB=$(du -sm public/uploads 2>/dev/null | cut -f1 || echo '?')
echo "      public/uploads: ${UPLOAD_TOTAL} 个文件，约 ${UPLOAD_MB} MB"

# ---------- 3. 只暂存允许推送的两项 ----------
echo ""
echo "[3/6] 暂存 data/places.json 与 public/uploads/ ..."
# 故意用明确的路径，不用 git add -A / git add .：
# 避免把 data/users.json、data/ai_config.json 等被忽略或未忽略的敏感文件卷进来。
git add -- data/places.json public/uploads

# 再扫一遍暂存区兜底
STAGED=$(git diff --cached --name-only)
if [ -z "$STAGED" ]; then
  echo ""
  echo "线上数据与仓库版本完全一致，没有需要提交的内容。"
  echo "（如果你改的是代码，那是另一回事：代码请在本机开发并推送。）"
  exit 0
fi

SECRET_HIT=$(printf '%s\n' "$STAGED" | grep -E 'users\.json|ai_config\.json|student_ids\.json|visit-counter\.json|\.env' || true)
if [ -n "$SECRET_HIT" ]; then
  echo "[ERROR] 暂存区里出现了不该提交的敏感文件，已中止："
  printf '%s\n' "$SECRET_HIT" | sed 's/^/        /'
  echo "        请执行 git reset 取消暂存后检查。"
  exit 1
fi

echo "      本次将提交以下改动："
git diff --cached --stat | sed 's/^/        /'

if [ "$DRY_RUN" = "1" ]; then
  echo ""
  echo "[试运行] 已暂存以上内容但未提交。若要取消暂存： git reset"
  exit 0
fi

# ---------- 4. 提交 ----------
echo ""
echo "[4/6] 提交..."
STAMP=$(date +%F)
git commit -q -m "data: 同步线上地点数据与图片（${STAMP}）

线上 data/places.json 共 ${PLACE_TOTAL} 个地点、public/uploads 共 ${UPLOAD_TOTAL} 个文件。
本提交由服务器上的 scripts/push-data-back.sh 生成，用于给只存在于服务器上的
地点内容与图片做 git 备份。

未包含任何账号（users.json）、密钥（ai_config.json）等敏感文件。"
echo "      提交完成: $(git log -1 --pretty='%h %s')"

# ---------- 5. 确认后再推送 ----------
echo ""
echo "本次改动内容："
git show --stat --oneline HEAD | tail -n +2 | sed 's/^/        /'
echo ""
printf "把这次提交推送到 GitHub 的 %s 分支？[y/N] " "$BRANCH"
read -r REPLY
case "$REPLY" in
  y|Y|yes|YES)
    echo "[5/6] 推送中..."
    if git push origin "HEAD:$BRANCH"; then
      echo "      推送成功"
    else
      echo "[ERROR] 推送失败。提交已保留在服务器本地，修好认证后可用下面命令重推："
      echo "        cd $APP_DIR && git push origin HEAD:$BRANCH"
      exit 1
    fi
    ;;
  *)
    echo "[5/6] 已跳过推送。提交保留在服务器本地，随时可以手动推送："
    echo "        cd $APP_DIR && git push origin HEAD:$BRANCH"
    ;;
esac

# ---------- 6. 验收 ----------
echo ""
echo "[6/6] 结果"
echo "      本地 HEAD : $(git rev-parse --short HEAD)"
if git rev-parse --verify --quiet "origin/$BRANCH" >/dev/null; then
  echo "      远程 HEAD : $(git rev-parse --short "origin/$BRANCH")"
  AHEAD=$(git rev-list --count "origin/$BRANCH..HEAD")
  if [ "$AHEAD" = "0" ]; then
    echo "      线上数据已进入仓库，与远程一致。"
  else
    echo "      仍有 ${AHEAD} 个提交未推送。"
  fi
fi
echo ""
echo "注意：服务器工作区会继续保持 data/places.json 与仓库不一致的状态"
echo "      （后台每加一个地点就变一次），这是正常的，不是错误。"
echo "      下次后台改动后，再跑一次本脚本即可同步。"
