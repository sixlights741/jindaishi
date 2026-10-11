// JSON 文件读写的小工具。
//
// 为什么要单独抽出来：Windows 上的 PowerShell 5.1 用 `Set-Content -Encoding UTF8`
// 写文件会在开头加上 UTF-8 BOM（EF BB BF），而 JSON.parse 遇到 BOM 会直接抛错。
// 本次踩到的真实后果是：手工编辑 data/admin_ids.json 后，userStore 静默回退到默认
// 管理员列表，账号失去管理员权限且没有任何日志——非常难排查。
// 所以在读取处统一剥掉 BOM，把"静默失效"变成"照常工作"。
const fs = require("fs");

// 只剥开头那一个 BOM，中间出现的 U+FEFF（零宽不换行空格）保持原样
const LEADING_BOM = /^\uFEFF/;

function readJsonFile(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw.replace(LEADING_BOM, ""));
  } catch (error) {
    return fallback;
  }
}

// 始终写成不带 BOM 的 UTF-8
function writeJsonFile(filePath, content) {
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2), "utf-8");
}

module.exports = {
  readJsonFile,
  writeJsonFile,
};
