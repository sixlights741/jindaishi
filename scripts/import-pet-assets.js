#!/usr/bin/env node
/*
 * 把 dsh-pet（MIT）的透明动画素材导入本站 public/pet/anim/。
 *
 * 为什么要有这一步：素材原本住在
 *   %USERPROFILE%\.dsh\profiles\<profile>\node_modules\dsh-pet\assets\webm\
 * 这个路径只存在于装了桌宠插件的机器上，部署到服务器就跑不通，
 * 所以必须把用到的那几个 .webm 拷进站点自己的 public 目录。
 *
 * 用法：
 *   npm run pet:assets
 *   node scripts/import-pet-assets.js --source "D:\somewhere\dsh-pet\assets\webm"
 *   node scripts/import-pet-assets.js --all     # 全量 105 个（体积大，慎用）
 *
 * 只拷贝 pet.js 默认动画池用到的 23 个；想加动作就把名字补进下面的 WANTED。
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const WANTED = [
  // 待机 / 转向 / 拖拽
  "待机呼吸休闲",
  "东张西望",
  "被鼠标拖拽悬空反馈",
  // 点击回应（5 选 1）
  "点击回应-开心跃动",
  "点击回应-害羞惊讶",
  "点击回应-傲娇生气",
  "点击回应-挠痒咯咯笑",
  "点击回应-元气挥手",
  // 漫游
  "原地漂浮踏步",
  "螃蟹走路",
  "原地左转奔跑",
  // 随机小动作
  "写代码",
  "原地专心玩魔方",
  "悠闲哼歌",
  "超大伸懒腰",
  "原地小憩沉眠",
  "哈欠连天",
  "蓝鲸现世",
  "吃白饭",
  "照镜子",
  // 问答状态
  "工作状态-思考冒泡",
  "工作状态-雀跃庆祝",
  "工作状态-垂头叹气冒汗",
];

function parseArgs(argv) {
  const args = { source: "", all: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--all") {
      args.all = true;
    } else if (argv[i] === "--source") {
      args.source = argv[i + 1] || "";
      i += 1;
    }
  }
  return args;
}

/** 找插件里 assets/webm 的真实位置：显式指定 → 环境变量 → 扫描各个 profile */
function findSourceDir(explicit) {
  const candidates = [];
  if (explicit) {
    candidates.push(explicit);
  }
  if (process.env.DSH_PET_ASSETS) {
    candidates.push(process.env.DSH_PET_ASSETS);
  }

  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
  const profilesDir = path.join(dshHome, "profiles");
  if (fs.existsSync(profilesDir)) {
    for (const profile of fs.readdirSync(profilesDir)) {
      candidates.push(
        path.join(profilesDir, profile, "node_modules", "dsh-pet", "assets", "webm")
      );
    }
  }
  candidates.push(path.join(dshHome, "node_modules", "dsh-pet", "assets", "webm"));

  return candidates.find((dir) => dir && fs.existsSync(dir)) || "";
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceDir = findSourceDir(args.source);

  if (!sourceDir) {
    console.error("没找到 dsh-pet 的素材目录。");
    console.error("请确认插件已安装，或手动指定：");
    console.error('  node scripts/import-pet-assets.js --source "<...>/dsh-pet/assets/webm"');
    process.exit(1);
  }

  const targetDir = path.join(__dirname, "..", "public", "pet", "anim");
  fs.mkdirSync(targetDir, { recursive: true });

  const available = new Set(
    fs.readdirSync(sourceDir).filter((name) => name.toLowerCase().endsWith(".webm"))
  );
  const names = args.all ? [...available] : WANTED;
  const missing = names.filter((name) => !available.has(`${name}.webm`));

  let copied = 0;
  let bytes = 0;

  for (const name of names) {
    if (!available.has(`${name}.webm`)) {
      continue;
    }
    const from = path.join(sourceDir, `${name}.webm`);
    const to = path.join(targetDir, `${name}.webm`);
    fs.copyFileSync(from, to);
    copied += 1;
    bytes += fs.statSync(to).size;
  }

  // 静态兜底图：素材缺失 / Safari / 微信内置浏览器时显示。
  // 仓库里已经放了一张从待机动画里截好的透明立绘（尺寸与 640×360 对齐），
  // 这里只在它不存在时才用 dsh-pet 的 logo 顶上，避免重新导入素材时把立绘覆盖掉。
  const logo = path.join(sourceDir, "..", "logo.png");
  const fallback = path.join(__dirname, "..", "public", "pet", "fallback.png");
  if (fs.existsSync(logo) && !fs.existsSync(fallback)) {
    fs.copyFileSync(logo, fallback);
  } else if (fs.existsSync(fallback)) {
    console.log("已存在 public/pet/fallback.png，保留现有静态立绘（不覆盖）");
  }

  // 保留 MIT 版权声明
  const license = path.join(sourceDir, "..", "..", "LICENSE");
  if (fs.existsSync(license)) {
    fs.copyFileSync(license, path.join(__dirname, "..", "public", "pet", "LICENSE-dsh-pet.txt"));
  }

  console.log(`素材源：${sourceDir}`);
  console.log(`输出到：${targetDir}`);
  console.log(`已拷贝 ${copied} 个动画，合计 ${formatBytes(bytes)}`);
  if (missing.length) {
    console.warn(`有 ${missing.length} 个动画在源目录里不存在（跳过）：`);
    console.warn(`  ${missing.join("、")}`);
  }
  console.log("完成。刷新页面即可看到桌宠。");
}

main();
