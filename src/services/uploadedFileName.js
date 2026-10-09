// multer 1.x 底层的 busboy 按 latin1 解析 multipart 的文件名，
// 于是「测试图片.jpg」读进来是「æµ‹è¯•å›¾ç‰‡.jpg」。
// 这里集中处理这类编码问题：上传时还原文件名，读取历史数据时修复误存的乱码。
const path = require("path");

const CJK_PATTERN = /[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

function asLatin1Bytes(text) {
  return Buffer.from(text, "latin1");
}

function isUtf8RoundTrip(bytes) {
  return Buffer.from(bytes.toString("utf8"), "utf8").equals(bytes);
}

// 还原 multipart 文件名；返回 null 表示这份字节不是合法 UTF-8，无法可靠还原。
function tryDecodeUploadedFileName(rawName) {
  const name = String(rawName || "");
  if (!name) {
    return "";
  }
  // 出现 U+00FF 以上的字符，说明 busboy 已正确解码（如 RFC 5987 的 filename*）
  if (/[^\u0000-\u00ff]/.test(name)) {
    return name;
  }
  const bytes = asLatin1Bytes(name);
  if (isUtf8RoundTrip(bytes)) {
    return bytes.toString("utf8");
  }
  // 不是 UTF-8 字节：字符串里没有 C1 控制符时，说明它本来就是可读文本（如 café）
  return /[\u0080-\u009f]/.test(name) ? null : name;
}

function decodeUploadedFileName(rawName) {
  const decoded = tryDecodeUploadedFileName(rawName);
  return decoded === null ? String(rawName || "") : decoded;
}

// 管理员没填说明时用文件名兜底；文件名无法还原则退回通用名称，避免乱码出现在页面上。
function captionFromUploadedFile(file, index) {
  const decoded = tryDecodeUploadedFileName(file?.originalname);
  const base =
    decoded === null
      ? ""
      : path
          .basename(decoded.replace(/\\/g, "/"))
          .replace(/\.[^.]+$/, "")
          .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
          .trim();
  if (!base || base.includes("\uFFFD")) {
    return `上传图 ${index + 1}`;
  }
  return base;
}

// 修复历史数据里已存成乱码的文本（读取时还原，不改动磁盘文件）。
// 只处理「全部字符都在 Latin-1 范围内、按 UTF-8 还原合法、且还原后含中日韩字符」的文本：
// 正常的中文文本含 U+00FF 以上的字符，不会被误改。
function repairMojibakeText(value) {
  const text = String(value ?? "");
  if (!text || /[^\u0000-\u00ff]/.test(text)) {
    return text;
  }
  const bytes = asLatin1Bytes(text);
  if (!isUtf8RoundTrip(bytes)) {
    return text;
  }
  const decoded = bytes.toString("utf8");
  return CJK_PATTERN.test(decoded) ? decoded : text;
}

module.exports = {
  decodeUploadedFileName,
  captionFromUploadedFile,
  repairMojibakeText,
};
