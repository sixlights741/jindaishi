const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const session = require("express-session");
const {
  ensureUserFile,
  verifyUser,
  updatePassword,
  getUserByStudentId,
} = require("./services/userStore");
const {
  getPlaces,
  getPlaceById,
  addPlace,
  updatePlace,
  deletePlace,
} = require("./services/placeStore");

const app = express();
const PORT = process.env.PORT || 3000;

const uploadDir = path.join(__dirname, "../public/uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// multer 1.x 底层的 busboy 按 latin1 解析 multipart 文件名，中文名会读成
// 「æµ‹è¯•」这类乱码，交给 uploadedFileName 里的工具还原。
const { decodeUploadedFileName, captionFromUploadedFile } = require("./services/uploadedFileName");

// 只信任文件真实内容，不信任客户端声明的 Content-Type：
// 把纯文本/HTML 改名成 .jpg 再写上 image/jpeg 头就能骗过 fileFilter。
// public/uploads 是静态目录，一旦混进 .html/.svg 就等于给了上传者一个 XSS 落脚点。
const IMAGE_SIGNATURES = [
  { name: "JPEG", bytes: [0xff, 0xd8, 0xff] },
  { name: "PNG", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { name: "GIF", bytes: [0x47, 0x49, 0x46, 0x38] },
  { name: "BMP", bytes: [0x42, 0x4d] },
];

function readFileHead(filePath, length) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const read = fs.readSync(fd, buffer, 0, length, 0);
    return buffer.subarray(0, read);
  } finally {
    fs.closeSync(fd);
  }
}

function hasImageSignature(head) {
  if (!head || head.length < 2) {
    return false;
  }
  const matches = (bytes) =>
    head.length >= bytes.length && bytes.every((byte, index) => head[index] === byte);

  if (IMAGE_SIGNATURES.some((item) => matches(item.bytes))) {
    return true;
  }
  // WEBP = RIFF....WEBP
  return (
    head.length >= 12 &&
    head.toString("latin1", 0, 4) === "RIFF" &&
    head.toString("latin1", 8, 12) === "WEBP"
  );
}

// 校验本次落盘的上传文件里有没有"内容不是图片"的；返回错误信息，没问题返回 null。
// 注意：只有在要拒绝这次提交时才删除文件——校验通过的文件必须留在 public/uploads 里，
// 因为后面的保存逻辑会直接引用它们（曾经误删过一次，导致新上传的图全部 404）。
function collectInvalidUpload(req) {
  const files = Object.values(req.files || {}).flat().filter(Boolean);
  let invalid = null;
  files.forEach((file) => {
    if (!file.path || !fs.existsSync(file.path)) {
      return;
    }
    if (!hasImageSignature(readFileHead(file.path, 12))) {
      invalid = invalid || file;
    }
  });

  const message = invalid
    ? `文件「${decodeUploadedFileName(invalid.originalname)}」不是有效的图片（内容与图片格式不符），已拒绝保存`
    : req.fileValidationError || null;

  if (!message) {
    return null;
  }

  files.forEach((file) => {
    if (!file.path) {
      return;
    }
    try {
      fs.unlinkSync(file.path);
    } catch (error) {
      console.error("清理未通过校验的上传文件失败：", file.path, error.message);
    }
  });
  return message;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(decodeUploadedFileName(file.originalname)).toLowerCase();
      const safeName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext || ".jpg"}`;
      cb(null, safeName);
    },
  }),
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith("image/")) {
      cb(null, true);
      return;
    }
    req.fileValidationError = "仅支持上传图片文件";
    cb(null, false);
  },
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
});

const aiConfigPath = path.join(__dirname, "../data/ai_config.json");

ensureUserFile();

// ===== 访问计数器 =====
const visitCounterPath = path.join(__dirname, "../data/visit-counter.json");

function getVisitCount() {
  try {
    const raw = fs.readFileSync(visitCounterPath, "utf-8");
    const data = JSON.parse(raw);
    return typeof data.count === "number" ? data.count : 0;
  } catch {
    return 0;
  }
}

function incrementVisitCount() {
  const current = getVisitCount();
  const next = current + 1;
  fs.writeFileSync(visitCounterPath, JSON.stringify({ count: next }, null, 2), "utf-8");
  return next;
}

function getAiConfig() {
  try {
    const raw = fs.readFileSync(aiConfigPath, "utf-8");
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") {
      return {};
    }
    return {
      apiKey: (data.apiKey || "").trim(),
      baseUrl: (data.baseUrl || "").trim(),
      apiUrl: (data.apiUrl || "").trim(),
      model: (data.model || "").trim(),
    };
  } catch (error) {
    return {};
  }
}

function detectProviderLabel(config) {
  const baseUrl = String(config.baseUrl || "").toLowerCase();
  const apiUrl = String(config.apiUrl || "").toLowerCase();
  const model = String(config.model || "").toLowerCase();
  const combined = `${baseUrl} ${apiUrl} ${model}`;

  if (combined.includes("deepseek")) {
    return "DeepSeek";
  }
  if (combined.includes("dashscope") || combined.includes("qwen")) {
    return "通义千问";
  }
  if (!baseUrl && !apiUrl) {
    return "OpenAI";
  }
  return "自定义模型";
}

function maskApiKey(rawKey) {
  const key = String(rawKey || "").trim();
  if (!key) {
    return "未配置";
  }
  if (key.length <= 8) {
    return `${key.slice(0, 2)}****`;
  }
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

function saveAiConfig(payload) {
  const next = {
    apiKey: (payload.apiKey || "").trim(),
    baseUrl: (payload.baseUrl || "").trim(),
    apiUrl: (payload.apiUrl || "").trim(),
    model: (payload.model || "").trim(),
  };
  fs.writeFileSync(aiConfigPath, JSON.stringify(next, null, 2), "utf-8");
}

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("view cache", false);

// HTTP → HTTPS 重定向（适用于 nginx / 反向代理之后）
app.use((req, res, next) => {
  const proto = req.headers["x-forwarded-proto"];
  if (proto && proto !== "https") {
    return res.redirect(301, "https://" + req.headers.host + req.originalUrl);
  }
  next();
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || require("crypto").randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 4,
    },
  })
);
app.use(express.static(path.join(__dirname, "../public")));

// 每次新会话首次访问时计数 +1，避免刷新重复计数
app.use((req, res, next) => {
  res.locals.visitCount = getVisitCount();
  if (!req.session.visitCounted) {
    req.session.visitCounted = true;
    res.locals.visitCount = incrementVisitCount();
  }
  next();
});

function requireAuth(req, res, next) {
  if (req.session.user) {
    return next();
  }
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "登录已失效，请重新登录后再试" });
  }
  return res.redirect("/login");
}

function requireAdmin(req, res, next) {
  if (req.session.user && req.session.user.isAdmin) {
    return next();
  }
  return res.status(403).render("not-found", { message: "无权限访问管理员页面" });
}

// 访客没有真实账号，禁止改密码等账号相关页面
function requireRealUser(req, res, next) {
  if (req.session.user && req.session.user.isGuest) {
    return res.redirect("/");
  }
  return next();
}

// 首次登录必须改密：只靠登录时跳一次 /profile/password 是拦不住的，
// 用户直接敲 "/" 或 "/place/xxx" 就能绕过，所以每个需要真实身份的页面都要自己挡一道。
// （改密流程本身、退出登录、静态资源不走这个中间件，否则会死循环。）
function requirePasswordChanged(req, res, next) {
  if (req.session.user && req.session.user.mustChangePassword) {
    if (req.path.startsWith("/api/")) {
      return res.status(403).json({ error: "请先修改初始密码后再使用讲解助手" });
    }
    return res.redirect("/profile/password");
  }
  return next();
}

// 每张图只有一个自由文字字段 note（想写什么写什么，不要求格式）。
// caption/credit -> note 的合并放在 placeStore.toViewPlace 里，那是所有读取的必经之路。
//
// drawingsText 只存 URL，一行一个 —— 文字不放在这里。
// 文字由后台的逐图输入框按数组下标另外提交（见 mergeUploadedDrawings）。
// 之所以拆开：文字是自由文本、允许换行，如果和 URL 挤在同一个换行分隔的字段里，
// 文字里的换行就会被当成「下一张图」，一张图会被拆成两张。
function parseDrawingUrls(rawText) {
  if (!rawText || !rawText.trim()) {
    return [];
  }
  return rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    // 兼容历史上 "url | 文字" 的旧格式：只取竖线前的部分
    .map((line) => {
      const separator = line.indexOf("|");
      return (separator === -1 ? line : line.slice(0, separator)).trim();
    })
    .filter(Boolean);
}

// 由 URL 列表构造 drawings；若给了按序的文字数组，就按下标配上
function buildDrawings(urls, notes) {
  const list = Array.isArray(notes) ? notes : [];
  return urls.map((url, index) => ({
    url,
    note: list[index] !== undefined ? list[index] : "",
  }));
}

// 隐藏字段只放 URL，一行一个
function drawingsToText(drawings) {
  if (!Array.isArray(drawings) || drawings.length === 0) {
    return "";
  }
  return drawings.map((item) => item.url).join("\n");
}

// 逐图输入框用的回填数组：顺序与画廊一致，下标即第几张图
function drawingsToNoteArray(drawings) {
  return Array.isArray(drawings) ? drawings.map((item) => item.note || "") : [];
}

function parseQaRules(rawText) {
  if (!rawText || !rawText.trim()) {
    return [];
  }

  return rawText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [questionPart, ...answerParts] = line.split("|");
      return {
        question: (questionPart || "").trim(),
        answer: (answerParts.join("|") || "").trim(),
      };
    })
    .filter((item) => item.question && item.answer);
}

function qaRulesToText(qaRules) {
  if (!Array.isArray(qaRules) || qaRules.length === 0) {
    return "";
  }
  return qaRules.map((item) => `${item.question} | ${item.answer}`).join("\n");
}

// 一个地点最多挂 5 条视频
const MAX_VIDEO_COUNT = 5;

// 视频链接按行填写，一行一条（粘贴 B 站链接或 BV/av 号都行）
function parseVideoUrls(rawText) {
  if (!rawText || !rawText.trim()) {
    return [];
  }
  return rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}


// 后台每张图旁边有一个自由文字输入框（name="drawingNotes"），同名控件会提交成数组。
// 单张图时浏览器只提交一个字符串而非数组，这里统一成数组。
// 末尾的空值要保留：它代表「这张图暂时不填」，而不是「这一项不存在」，
// 否则后面几张图的文字会整体错位到前一张上。
function toFieldList(value) {
  if (value === undefined || value === null) {
    return [];
  }
  const list = (Array.isArray(value) ? value : [value]).map((item) =>
    String(item == null ? "" : item).trim()
  );
  while (list.length > 0 && list[list.length - 1] === "") {
    list.pop();
  }
  return list;
}

// 由「已有图的 URL 列表 + 本次新上传的文件 + 按序的文字数组」组装最终的 drawings。
// 文字按下标对应页面上的第 1、2、3 张图（已有图在前、新上传追加在后，与页面一致），
// 所以不存在数错行的问题；留空表示这张图不写文字。
function mergeUploadedDrawings(drawingsText, uploadedFiles, notes) {
  const baseUrls = parseDrawingUrls(drawingsText || "");
  const files = Array.isArray(uploadedFiles) ? uploadedFiles : [];
  const uploadedUrls = files.map((file) => `/uploads/${file.filename}`);
  const urls = [...baseUrls, ...uploadedUrls];

  const noteList = toFieldList(notes);
  if (noteList.length === 0) {
    // 没提交任何文字：新上传的图用文件名兜底，已有图保持为空
    return urls.map((url, index) => ({
      url,
      note: index >= baseUrls.length && files[index - baseUrls.length]
        ? captionFromUploadedFile(files[index - baseUrls.length], index)
        : "",
    }));
  }

  return urls.map((url, index) => ({
    url,
    note: noteList[index] !== undefined ? noteList[index] : "",
  }));
}

function normalizePlaceFromBody(body) {
  return {
    id: (body.id || "").trim(),
    name: (body.name || "").trim(),
    px: Math.round(Number(body.px)),
    py: Math.round(Number(body.py)),
    period: (body.period || "").trim(),
    summary: (body.summary || "").trim(),
    content: (body.content || "").trim(),
    image: (body.image || "").trim(),
    // 主图的说明与署名（署名格式约定：届别 专业 姓名，如「2023级 建筑学 张三」）
    imageCaption: (body.imageCaption || "").trim(),
    imageCredit: (body.imageCredit || "").trim(),
    videoUrls: parseVideoUrls(body.videoUrls || ""),
    drawings: [],
    qaRules: parseQaRules(body.qaRulesText || ""),
  };
}

function validatePlace(place, isCreate) {
  if (isCreate && !place.id) {
    return "地点 ID 不能为空";
  }
  if (!place.name) {
    return "地点名称不能为空";
  }
  if (Number.isNaN(place.px) || Number.isNaN(place.py)) {
    return "坐标必须是数字，请在底图上点击选点";
  }
  if (Array.isArray(place.videoUrls) && place.videoUrls.length > MAX_VIDEO_COUNT) {
    return `最多支持 ${MAX_VIDEO_COUNT} 条视频链接，请删减后再保存`;
  }
  return null;
}

function buildLocalAssistantAnswer(place, question) {
  const normalized = (question || "").trim().toLowerCase();
  const drawingCount = Array.isArray(place.drawings) ? place.drawings.length : 0;
  const firstDrawingNote = drawingCount > 0 ? (place.drawings[0].note || "暂无说明") : null;

  if (!normalized) {
    return `这是“${place.name}”。它属于 ${place.period} 时期。你可以问我：历史背景、主要功能、手绘图看点。`;
  }

  // 问到作者/署名/谁做的：把每张图的文字列出来（现在文字是自由内容，作者信息通常写在里面）
  if (
    normalized.includes("谁") || normalized.includes("作者") || normalized.includes("署名") ||
    normalized.includes("哪一届") || normalized.includes("哪届") || normalized.includes("专业") ||
    normalized.includes("做的") || normalized.includes("画的")
  ) {
    const credited = [];
    if (place.image && place.imageCredit) {
      credited.push(`主图：${place.imageCredit}`);
    }
    (place.drawings || []).forEach((item, index) => {
      if (item.note) {
        credited.push(`第 ${index + 1} 张：${item.note}`);
      }
    });
    if (credited.length === 0) {
      return `${place.name} 的图片暂时还没有填写文字说明。`;
    }
    return `${place.name} 的图片说明如下：${credited.join("；")}。`;
  }

  if (normalized.includes("手绘") || normalized.includes("图") || normalized.includes("draw")) {
    if (drawingCount === 0) {
      // 没有手绘图，但可能有主图，主图也可能有署名
      if (place.image && place.imageCredit) {
        return `${place.name} 当前还没有上传手绘图，主图由 ${place.imageCredit} 完成。`;
      }
      return `${place.name} 当前还没有上传手绘图，你可以先查看主图和文字介绍。`;
    }
    const detail = formatImageFacts({ image: "", drawings: place.drawings })
      .slice(1) // 去掉“手绘图共 N 张”那行标题，避免与下面的话重复
      .map((line) => line.trim())
      .join("；");
    return `${place.name} 目前有 ${drawingCount} 张手绘图。${detail}。`;
  }

  if (normalized.includes("时间") || normalized.includes("时期") || normalized.includes("年代")) {
    return `${place.name} 的历史时期是：${place.period}。`; 
  }

  if (normalized.includes("总结") || normalized.includes("概括") || normalized.includes("一句话")) {
    return `${place.name}：${place.summary}`;
  }

  return `${place.summary}\n\n补充讲解：${place.content}`;
}

function findMatchedPresetQa(place, question) {
  if (!place || !Array.isArray(place.qaRules) || place.qaRules.length === 0) {
    return null;
  }

  const normalizedQuestion = String(question || "").trim().toLowerCase();
  if (!normalizedQuestion) {
    return null;
  }

  return place.qaRules.find((item) => {
    const candidate = String(item.question || "").trim().toLowerCase();
    return Boolean(candidate) && candidate === normalizedQuestion;
  }) || null;
}

// 把主图与手绘图的说明、署名整理成给 AI 的资料文本。
// 署名格式约定为「届别 专业 姓名」，所以学生问「这图谁画的 / 哪一届做的」时能直接答上来。
function formatImageFacts(place) {
  const lines = [];

  if (place.image) {
    const bits = [];
    if (place.imageCaption) bits.push(`说明：${place.imageCaption}`);
    if (place.imageCredit) bits.push(`作者：${place.imageCredit}`);
    lines.push(bits.length ? `主图（${bits.join("，")}）` : "主图（暂无说明与署名）");
  }

  const drawings = Array.isArray(place.drawings) ? place.drawings : [];
  if (drawings.length > 0) {
    lines.push(`手绘图共 ${drawings.length} 张：`);
    drawings.forEach((item, index) => {
      lines.push(`  第 ${index + 1} 张${item.note ? `（${item.note}）` : "（暂无文字）"}`);
    });
  }

  return lines;
}

async function callCloudAssistant(place, question) {
  const aiConfig = getAiConfig();
  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || aiConfig.apiKey;
  if (!apiKey) {
    return null;
  }

  const baseUrl = (aiConfig.baseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const apiUrl = (aiConfig.apiUrl || process.env.AI_API_URL || `${baseUrl}/chat/completions`).trim();
  const model = aiConfig.model || process.env.AI_MODEL || "gpt-4o-mini";

  // 提示词分两层：
  //   1) 事实底座：地点资料，用于回答“这个地点本身”的问题；
  //   2) 允许发散：校史、工业史、建筑史的通识背景、同类对比、对今天的启示都可以讲，
  //      只对“年份/人名/数字”这类硬信息要求不编造。
  const systemPrompt = [
    "你是东北大学校史地图的 AI 讲解小助手，服务对象是来参观的学生、校友和访客。",
    "回答不要只复述页面资料：以给定地点资料为事实底座，结合你对中国近现代史、东北大学校史、工业史、建筑史和高等教育的通识理解，做有信息量的展开。",
    "可以补充时代背景、相关人物与事件、同类建筑或院系的对比、这段历史对今天的启示，也可以回答“为什么重要”“对当时意味着什么”“和现在有什么关系”这类需要理解而不是照抄资料的问题。",
    "",
    "回答原则：",
    "1. 事实优先级：地点资料 > 公认史实 > 你的合理推断。资料明确写到的内容，以资料为准。",
    "2. 鼓励发散，但不编造硬信息：年份、人名、数字、题词、建筑尺寸这类细节，资料没写且你不确定时，用“据我所知 / 一般来说”限定，或坦率说明“资料里没提到，不过从背景看……”。",
    "3. 问题只和这个地点沾一点边时，也先正面回答，再自然引回这个地点，不要生硬拒绝。",
    "4. 图片相关：资料里有每张图的说明与作者署名（格式为「届别 专业 姓名」）。问到作者、届别、专业、张数时按资料直答；资料没写的不要猜。",
    "5. 语气像带队讲解的学长学姐：口语、友好、有画面感。默认 3~5 句、约 250~400 字，除非用户明确要求更长或更短。",
    "6. 不要用“根据您提供的资料”“作为 AI”这类机械开头，直接进入内容。",
    "7. 涉及历史评价时保持客观、克制，不做过度延伸的政治表态。",
  ].join("\n");
  const userPrompt = [
    `地点名称：${place.name}`,
    `历史时期：${place.period}`,
    `摘要：${place.summary}`,
    `详细介绍：${place.content}`,
    ...formatImageFacts(place),
    `用户问题：${question}`,
  ].join("\n");

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.65,
      max_tokens: 800,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI API 请求失败：${response.status} ${text}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("AI API 返回内容为空");
  }

  return {
    answer: String(content).trim(),
    model,
    providerLabel: detectProviderLabel(aiConfig),
  };
}

function normalizeCloudErrorMessage(error) {
  if (!error || !error.message) {
    return "未知错误";
  }

  const raw = String(error.message).replace(/\s+/g, " ").trim();
  const lower = raw.toLowerCase();
  if (lower.includes("fetch failed")) {
    return "网络请求失败";
  }
  if (raw.length > 120) {
    return `${raw.slice(0, 120)}...`;
  }
  return raw;
}

function isRetryableCloudError(error) {
  const message = normalizeCloudErrorMessage(error).toLowerCase();
  return (
    message.includes("timeout")
    || message.includes("abort")
    || message.includes("429")
    || message.includes("500")
    || message.includes("502")
    || message.includes("503")
    || message.includes("504")
    || message.includes("network")
  );
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function callCloudAssistantWithRetry(place, question) {
  const maxRetry = 1;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetry; attempt += 1) {
    try {
      const cloudResult = await callCloudAssistant(place, question);
      if (!cloudResult) {
        return {
          cloudResult: null,
          fallbackReason: "未配置云端密钥，已使用本地规则",
        };
      }
      return {
        cloudResult,
        fallbackReason: null,
      };
    } catch (error) {
      lastError = error;
      const shouldRetry = attempt < maxRetry && isRetryableCloudError(error);
      if (!shouldRetry) {
        break;
      }
      await wait(250);
    }
  }

  return {
    cloudResult: null,
    fallbackReason: `云端调用失败：${normalizeCloudErrorMessage(lastError)}`,
  };
}

// 登录方式选择页：左「登录」跳账号密码登录，右「访客」直接进主页
app.get("/login", (req, res) => {
  if (req.session.user) {
    return res.redirect("/");
  }
  return res.render("login", { error: null });
});

app.get("/login/account", (req, res) => {
  if (req.session.user) {
    return res.redirect("/");
  }
  return res.render("login-account", { error: null, studentId: "" });
});

app.post("/login/guest", (req, res) => {
  req.session.user = {
    studentId: "访客",
    mustChangePassword: false,
    isAdmin: false,
    isGuest: true,
  };
  return res.redirect("/");
});

app.post("/login", async (req, res) => {
  const { studentId, password } = req.body;
  if (!studentId || !password) {
    return res.status(400).render("login-account", { error: "请输入学号和密码", studentId: studentId || "" });
  }

  const user = await verifyUser(studentId.trim(), password);
  if (!user) {
    return res.status(401).render("login-account", { error: "学号或密码错误", studentId });
  }

  req.session.user = {
    studentId: user.studentId,
    mustChangePassword: user.mustChangePassword,
    isAdmin: Boolean(user.isAdmin),
  };

  if (user.mustChangePassword) {
    return res.redirect("/profile/password");
  }
  return res.redirect("/");
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

app.get("/", requireAuth, requirePasswordChanged, (req, res) => {
  const places = getPlaces();
  res.render("index", {
    user: req.session.user,
    places,
  });
});

app.get("/place/:id", requireAuth, requirePasswordChanged, (req, res) => {
  const place = getPlaceById(req.params.id);
  if (!place) {
    return res.status(404).render("not-found", { message: "未找到该地点" });
  }
  return res.render("place", { user: req.session.user, place });
});

app.post("/api/assistant", requireAuth, requirePasswordChanged, async (req, res) => {
  const placeId = (req.body.placeId || "").trim();
  const question = (req.body.question || "").trim();

  if (!placeId) {
    return res.status(400).json({ error: "缺少 placeId" });
  }

  if (!question) {
    return res.status(400).json({ error: "问题不能为空" });
  }

  if (question.length > 300) {
    return res.status(400).json({ error: "问题过长，请控制在 300 字以内" });
  }

  const place = getPlaceById(placeId);
  if (!place) {
    return res.status(404).json({ error: "未找到对应地点" });
  }

  const cloudAttempt = await callCloudAssistantWithRetry(place, question);
  if (cloudAttempt.cloudResult) {
    return res.json({
      answer: cloudAttempt.cloudResult.answer,
      source: "cloud",
      model: cloudAttempt.cloudResult.model,
      providerLabel: cloudAttempt.cloudResult.providerLabel,
    });
  }

  if (cloudAttempt.fallbackReason) {
    console.error("AI 云端调用失败，已降级为本地讲解：", cloudAttempt.fallbackReason);
  }

  // 云端不可用时（未配置密钥、网络中断、限流、超时等）回退到本地规则。
  // 这里以前返回的是一句固定的玩笑话，导致「云端失败自动降级为本地规则」的承诺
  // 落空，也让人误以为助手坏了。现在改为：先匹配后台配置的预设问答，再走本地规则。
  const presetQa = findMatchedPresetQa(place, question);
  if (presetQa) {
    return res.json({
      answer: presetQa.answer,
      source: "preset",
      model: "preset-qa",
      fallbackReason: cloudAttempt.fallbackReason,
    });
  }

  return res.json({
    answer: buildLocalAssistantAnswer(place, question),
    source: "local",
    model: "local-rules",
    fallbackReason: cloudAttempt.fallbackReason,
  });
});

app.get("/profile/password", requireAuth, requireRealUser, (req, res) => {
  res.render("change-password", {
    user: req.session.user,
    error: null,
    success: null,
    autoRedirectToLogin: false,
  });
});

app.post("/profile/password", requireAuth, requireRealUser, async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  const studentId = req.session.user.studentId;

  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.status(400).render("change-password", {
      user: req.session.user,
      error: "请完整填写所有字段",
      success: null,
      autoRedirectToLogin: false,
    });
  }

  if (newPassword.length < 6) {
    return res.status(400).render("change-password", {
      user: req.session.user,
      error: "新密码至少 6 位",
      success: null,
      autoRedirectToLogin: false,
    });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).render("change-password", {
      user: req.session.user,
      error: "两次输入的新密码不一致",
      success: null,
      autoRedirectToLogin: false,
    });
  }

  const verified = await verifyUser(studentId, currentPassword);
  if (!verified) {
    return res.status(401).render("change-password", {
      user: req.session.user,
      error: "当前密码错误",
      success: null,
      autoRedirectToLogin: false,
    });
  }

  await updatePassword(studentId, newPassword);
  const user = getUserByStudentId(studentId);
  req.session.user.mustChangePassword = user.mustChangePassword;
  req.session.user.isAdmin = user.isAdmin;
  const viewUser = { ...req.session.user };

  return req.session.destroy(() => {
    res.render("change-password", {
      user: viewUser,
      error: null,
      success: "改动成功",
      autoRedirectToLogin: true,
    });
  });
});

app.get("/admin", requireAuth, requireAdmin, (req, res) => {
  const places = getPlaces();
  res.render("admin-dashboard", {
    user: req.session.user,
    places,
  });
});

app.get("/admin/ai-settings", requireAuth, requireAdmin, (req, res) => {
  const config = getAiConfig();
  res.render("admin-ai-settings", {
    user: req.session.user,
    config,
    success: req.query.success === "1",
  });
});

app.post("/admin/ai-settings", requireAuth, requireAdmin, (req, res) => {
  const current = getAiConfig();
  const shouldClear = String(req.body.clearKey || "").toLowerCase() === "on";
  const apiKey = shouldClear ? "" : (req.body.apiKey || current.apiKey || "");
  const baseUrl = (req.body.baseUrl || current.baseUrl || "").trim();
  const apiUrl = (req.body.apiUrl || current.apiUrl || "").trim();
  const model = (req.body.model || current.model || "").trim();
  saveAiConfig({ apiKey, baseUrl, apiUrl, model });
  return res.redirect("/admin/ai-settings?success=1");
});

app.get("/admin/ai-settings/info", requireAuth, requireAdmin, (req, res) => {
  const config = getAiConfig();
  const apiKey = process.env.AI_API_KEY || process.env.OPENAI_API_KEY || config.apiKey || "";
  const model = config.model || process.env.AI_MODEL || "";
  return res.json({
    apiKeyMasked: maskApiKey(apiKey),
    model: model || "未配置",
    providerLabel: detectProviderLabel(config),
  });
});

app.post("/admin/ai-settings/test", requireAuth, requireAdmin, async (req, res) => {
  const question = (req.body.question || "").trim() || "请简单介绍一下这个地点";
  const places = getPlaces();
  const place = places[0] || {
    name: "示例地点",
    period: "未知",
    summary: "暂无摘要",
    content: "暂无详细介绍",
    drawings: [],
  };

  try {
    const result = await callCloudAssistant(place, question);
    if (!result) {
      return res.status(400).json({ error: "未配置 AI 密钥或密钥为空" });
    }
    return res.json({ answer: result.answer, model: result.model });
  } catch (error) {
    return res.status(500).json({ error: normalizeCloudErrorMessage(error) });
  }
});

app.get("/admin/place/new", requireAuth, requireAdmin, (req, res) => {
  res.render("admin-place-form", {
    user: req.session.user,
    mode: "create",
    place: {
      id: "",
      name: "",
      px: "",
      py: "",
      period: "",
      summary: "",
      content: "",
      image: "",
      videoUrls: [],
      drawingsText: "",
      qaRulesText: "",
    },
    error: null,
  });
});

app.post("/admin/place/new", requireAuth, requireAdmin, upload.fields([
  { name: "imageFile", maxCount: 1 },
  { name: "drawingFiles", maxCount: 12 },
]), (req, res) => {
  // 先校验上传内容（会顺手删掉本次落盘的临时文件），不通过就不要往下走
  const uploadError = collectInvalidUpload(req);
  if (uploadError) {
    return res.status(400).render("admin-place-form", {
      user: req.session.user,
      mode: "create",
      place: {
        ...normalizePlaceFromBody(req.body),
        image: "",
        drawings: [],
        drawingsText: req.body.drawingsText || "",

        // 逐图输入框带回填：下标与画廊顺序一致

        drawingNotes: toFieldList(req.body.drawingNotes),

        qaRulesText: req.body.qaRulesText || "",
      },
      error: uploadError,
    });
  }

  const place = normalizePlaceFromBody(req.body);
  const imageFile = req.files?.imageFile?.[0];
  if (imageFile) {
    place.image = `/uploads/${imageFile.filename}`;
  }
  place.drawings = mergeUploadedDrawings(
    req.body.drawingsText,
    req.files?.drawingFiles,
    req.body.drawingNotes
  );
  const error = validatePlace(place, true);
  if (error) {
    return res.status(400).render("admin-place-form", {
      user: req.session.user,
      mode: "create",
      place: {
        ...place,
        drawingsText: req.body.drawingsText || "",

        // 逐图输入框带回填：下标与画廊顺序一致

        drawingNotes: toFieldList(req.body.drawingNotes),

        qaRulesText: req.body.qaRulesText || "",
      },
      error,
    });
  }

  if (getPlaceById(place.id)) {
    return res.status(400).render("admin-place-form", {
      user: req.session.user,
      mode: "create",
      place: {
        ...place,
        drawingsText: req.body.drawingsText || "",

        // 逐图输入框带回填：下标与画廊顺序一致

        drawingNotes: toFieldList(req.body.drawingNotes),

        qaRulesText: req.body.qaRulesText || "",
      },
      error: "地点 ID 已存在，请更换",
    });
  }

  addPlace(place);
  return res.redirect("/admin");
});

app.get("/admin/place/:id/edit", requireAuth, requireAdmin, (req, res) => {
  const place = getPlaceById(req.params.id);
  if (!place) {
    return res.status(404).render("not-found", { message: "未找到该地点" });
  }

  return res.render("admin-place-form", {
    user: req.session.user,
    mode: "edit",
    place: {
      ...place,
      imageCaption: place.imageCaption || "",
      imageCredit: place.imageCredit || "",
      drawingsText: drawingsToText(place.drawings),
      drawingNotes: drawingsToNoteArray(place.drawings),
      qaRulesText: qaRulesToText(place.qaRules),
    },
    error: null,
  });
});

app.post("/admin/place/:id/edit", requireAuth, requireAdmin, upload.fields([
  { name: "imageFile", maxCount: 1 },
  { name: "drawingFiles", maxCount: 12 },
]), (req, res) => {
  const currentId = req.params.id;
  const existing = getPlaceById(currentId);
  if (!existing) {
    return res.status(404).render("not-found", { message: "未找到该地点" });
  }

  // 先校验上传内容（会顺手删掉本次落盘的临时文件），不通过就保留原图原样回填
  const uploadError = collectInvalidUpload(req);
  if (uploadError) {
    return res.status(400).render("admin-place-form", {
      user: req.session.user,
      mode: "edit",
      place: {
        ...normalizePlaceFromBody({ ...req.body, id: currentId }),
        image: existing.image || "",
        drawings: existing.drawings || [],
        drawingsText: req.body.drawingsText || "",

        // 逐图输入框带回填：下标与画廊顺序一致

        drawingNotes: toFieldList(req.body.drawingNotes),

        qaRulesText: req.body.qaRulesText || "",
      },
      error: uploadError,
    });
  }

  const payload = normalizePlaceFromBody({
    ...req.body,
    id: currentId,
  });
  const imageFile = req.files?.imageFile?.[0];
  if (imageFile) {
    payload.image = `/uploads/${imageFile.filename}`;
  }
  if (!payload.image) {
    payload.image = existing.image;
  }
  payload.drawings = mergeUploadedDrawings(
    req.body.drawingsText,
    req.files?.drawingFiles,
    req.body.drawingNotes
  );
  if (!payload.drawings || payload.drawings.length === 0) {
    payload.drawings = existing.drawings || [];
  }
  const error = validatePlace(payload, false);
  if (error) {
    return res.status(400).render("admin-place-form", {
      user: req.session.user,
      mode: "edit",
      place: {
        ...payload,
        drawingsText: req.body.drawingsText || "",

        // 逐图输入框带回填：下标与画廊顺序一致

        drawingNotes: toFieldList(req.body.drawingNotes),

        qaRulesText: req.body.qaRulesText || "",
      },
      error,
    });
  }

  updatePlace(currentId, payload);
  return res.redirect("/admin");
});

app.post("/admin/place/:id/delete", requireAuth, requireAdmin, (req, res) => {
  deletePlace(req.params.id);
  return res.redirect("/admin");
});

// 删除已上传的主图或手绘图（只允许管理员）
app.post('/admin/place/:id/image/delete', requireAuth, requireAdmin, (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body || {};
    const type = String(body.type || '').trim(); // 'main' or 'drawing'
    const url = String(body.url || '').trim();

    if (!id || !type || !url) {
      return res.status(400).json({ success: false, error: '缺少参数' });
    }

    const place = getPlaceById(id);
    if (!place) {
      return res.status(404).json({ success: false, error: '未找到地点' });
    }

    let changed = false;

    // Helper to delete file under uploadDir when url references /uploads/
    function tryUnlinkUploadedUrl(resourceUrl) {
      try {
        if (!resourceUrl || typeof resourceUrl !== 'string') return false;
        if (!resourceUrl.startsWith('/uploads/')) return false;
        const filename = resourceUrl.replace('/uploads/', '');
        if (!filename || filename.includes('..') || filename.includes('/')) return false;
        const filePath = path.join(uploadDir, filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          return true;
        }
      } catch (e) {
        // ignore unlink errors
      }
      return false;
    }

    if (type === 'main') {
      if (place.image && place.image === url) {
        // clear the image reference
        place.image = '';
        changed = true;
        tryUnlinkUploadedUrl(url);
      } else {
        return res.status(400).json({ success: false, error: '主图地址不匹配' });
      }
    } else if (type === 'drawing') {
      if (!Array.isArray(place.drawings) || place.drawings.length === 0) {
        return res.status(400).json({ success: false, error: '该地点没有手绘图' });
      }
      const beforeLen = place.drawings.length;
      place.drawings = place.drawings.filter((d) => String(d.url || '') !== url);
      if (place.drawings.length !== beforeLen) {
        changed = true;
        tryUnlinkUploadedUrl(url);
      } else {
        return res.status(400).json({ success: false, error: '未找到对应的手绘图' });
      }
    } else {
      return res.status(400).json({ success: false, error: '未知的删除类型' });
    }

    if (changed) {
      // persist change
      updatePlace(id, place);
      // return updated place (including drawings array)
      return res.json({ success: true, place });
    }

    return res.status(500).json({ success: false, error: '未发生变更' });
  } catch (error) {
    console.error('删除图片时出错', error && error.stack ? error.stack : error);
    return res.status(500).json({ success: false, error: '服务器错误' });
  }
});

app.use((req, res) => {
  res.status(404).render("not-found", { message: "页面不存在" });
});

// 兜底错误处理：Express 默认处理器会把完整堆栈（含服务器绝对路径）当成 HTML 回给客户端，
// 一个畸形的 JSON 请求体就能拿到 node_modules 的目录结构，所以这里全部换成干净响应。
app.use((err, req, res, next) => {
  const isJsonRequest = Boolean(req.path && req.path.startsWith("/api/")) ||
    String(req.headers.accept || "").includes("application/json") ||
    String(req.headers["content-type"] || "").includes("application/json");

  if (err && (err.type === "entity.parse.failed" || err instanceof SyntaxError && "body" in err)) {
    console.error("请求体解析失败：", req.method, req.originalUrl, err.message);
    return isJsonRequest
      ? res.status(400).json({ error: "请求体不是合法的 JSON" })
      : res.status(400).render("not-found", { message: "请求格式不正确" });
  }

  if (err && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "上传文件超过 20MB 限制，请压缩后再试" });
  }

  console.error("未处理的请求错误：", req.method, req.originalUrl, err && err.stack ? err.stack : err);
  if (res.headersSent) {
    return next(err);
  }
  return isJsonRequest
    ? res.status(500).json({ error: "服务器内部错误" })
    : res.status(500).render("not-found", { message: "服务器内部错误" });
});

const server = app.listen(PORT, () => {
  console.log(`NEU 校史地图运行中: http://localhost:${PORT}`);
});

server.on("error", (error) => {
  if (error && error.code === "EADDRINUSE") {
    console.error(`端口 ${PORT} 已被占用，请先关闭占用进程，或使用其他端口后重试。`);
    process.exit(1);
  }
  throw error;
});