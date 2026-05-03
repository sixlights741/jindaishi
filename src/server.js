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

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase();
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
    fileSize: 5 * 1024 * 1024,
  },
});

const aiConfigPath = path.join(__dirname, "../data/ai_config.json");

ensureUserFile();

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

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "neu-history-map-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 4,
    },
  })
);
app.use(express.static(path.join(__dirname, "../public")));

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

function parseDrawings(rawText) {
  if (!rawText || !rawText.trim()) {
    return [];
  }

  return rawText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [urlPart, captionPart] = line.split("|");
      return {
        url: (urlPart || "").trim(),
        caption: (captionPart || "").trim(),
      };
    })
    .filter((item) => item.url);
}

function drawingsToText(drawings) {
  if (!Array.isArray(drawings) || drawings.length === 0) {
    return "";
  }
  return drawings.map((item) => `${item.url} | ${item.caption || ""}`).join("\n");
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

function parseCaptionLines(rawText) {
  if (!rawText || !rawText.trim()) {
    return [];
  }
  return rawText
    .split("\n")
    .map((line) => line.trim());
}

function mergeUploadedDrawings(drawingsText, uploadedFiles, captionText) {
  const baseDrawings = parseDrawings(drawingsText || "");
  if (!Array.isArray(uploadedFiles) || uploadedFiles.length === 0) {
    return baseDrawings;
  }

  const captions = parseCaptionLines(captionText || "");
  const uploadedDrawings = uploadedFiles.map((file, index) => {
    const fallbackCaption = file.originalname ? file.originalname.replace(/\.[^.]+$/, "") : `上传图 ${index + 1}`;
    return {
      url: `/uploads/${file.filename}`,
      caption: (captions[index] || "").trim() || fallbackCaption,
    };
  });

  return [...baseDrawings, ...uploadedDrawings];
}

function normalizePlaceFromBody(body) {
  return {
    id: (body.id || "").trim(),
    name: (body.name || "").trim(),
    lat: Number(body.lat),
    lng: Number(body.lng),
    period: (body.period || "").trim(),
    summary: (body.summary || "").trim(),
    content: (body.content || "").trim(),
    image: (body.image || "").trim(),
    videoUrl: (body.videoUrl || "").trim(),
    drawings: parseDrawings(body.drawingsText || ""),
    qaRules: parseQaRules(body.qaRulesText || ""),
  };
}

function validatePlace(place, isCreate) {
  if (isCreate && !place.id) {
    return "地点 ID 不能为空";
  }
  if (!place.name || !place.period || !place.summary || !place.content || !place.image) {
    return "请完整填写地点信息";
  }
  if (Number.isNaN(place.lat) || Number.isNaN(place.lng)) {
    return "经纬度必须是数字";
  }
  return null;
}

function buildLocalAssistantAnswer(place, question) {
  const normalized = (question || "").trim().toLowerCase();
  const drawingCount = Array.isArray(place.drawings) ? place.drawings.length : 0;
  const firstDrawingCaption = drawingCount > 0 ? (place.drawings[0].caption || "暂无说明") : null;

  if (!normalized) {
    return `这是“${place.name}”。它属于 ${place.period} 时期。你可以问我：历史背景、主要功能、手绘图看点。`;
  }

  if (normalized.includes("手绘") || normalized.includes("图") || normalized.includes("draw")) {
    if (drawingCount === 0) {
      return `${place.name} 当前还没有上传手绘图，你可以先查看主图和文字介绍。`;
    }
    return `${place.name} 目前有 ${drawingCount} 张手绘图。第一张说明是：${firstDrawingCaption}。你也可以继续问我“这处地点最重要的历史意义是什么”。`;
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

async function callCloudAssistant(place, question) {
  const aiConfig = getAiConfig();
  const apiKey = aiConfig.apiKey || process.env.AI_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const baseUrl = (aiConfig.baseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const apiUrl = (aiConfig.apiUrl || process.env.AI_API_URL || `${baseUrl}/chat/completions`).trim();
  const model = aiConfig.model || process.env.AI_MODEL || "gpt-4o-mini";

  const systemPrompt = "你是东北大学校史地图的讲解小助手。回答应简洁、准确、友好，优先基于给定地点资料，不编造不存在的史实。";
  const userPrompt = [
    `地点名称：${place.name}`,
    `历史时期：${place.period}`,
    `摘要：${place.summary}`,
    `详细介绍：${place.content}`,
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
      temperature: 0.4,
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

app.get("/login", (req, res) => {
  if (req.session.user) {
    return res.redirect("/");
  }
  return res.render("login", { error: null });
});

app.post("/login", async (req, res) => {
  const { studentId, password } = req.body;
  if (!studentId || !password) {
    return res.status(400).render("login", { error: "请输入学号和密码" });
  }

  const user = await verifyUser(studentId.trim(), password);
  if (!user) {
    return res.status(401).render("login", { error: "学号或密码错误" });
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

app.get("/", requireAuth, (req, res) => {
  const places = getPlaces();
  res.render("index", {
    user: req.session.user,
    places,
  });
});

app.get("/place/:id", requireAuth, (req, res) => {
  const place = getPlaceById(req.params.id);
  if (!place) {
    return res.status(404).render("not-found", { message: "未找到该地点" });
  }
  return res.render("place", { user: req.session.user, place });
});

app.post("/api/assistant", requireAuth, async (req, res) => {
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

  return res.json({
    answer: "今天晚上吃青椒肉丝盖饭!",
    source: "fallback-fixed",
    model: "fixed-fallback",
    fallbackReason: cloudAttempt.fallbackReason,
  });
});

app.get("/profile/password", requireAuth, (req, res) => {
  res.render("change-password", {
    user: req.session.user,
    error: null,
    success: null,
    autoRedirectToLogin: false,
  });
});

app.post("/profile/password", requireAuth, async (req, res) => {
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
  const apiKey = config.apiKey || process.env.AI_API_KEY || process.env.OPENAI_API_KEY || "";
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
      lat: "",
      lng: "",
      period: "",
      summary: "",
      content: "",
      image: "",
      videoUrl: "",
      drawingsText: "",
      drawingsCaptions: "",
      qaRulesText: "",
    },
    error: null,
  });
});

app.post("/admin/place/new", requireAuth, requireAdmin, upload.fields([
  { name: "imageFile", maxCount: 1 },
  { name: "drawingFiles", maxCount: 12 },
]), (req, res) => {
  const place = normalizePlaceFromBody(req.body);
  const imageFile = req.files?.imageFile?.[0];
  if (imageFile) {
    place.image = `/uploads/${imageFile.filename}`;
  }
  place.drawings = mergeUploadedDrawings(req.body.drawingsText, req.files?.drawingFiles, req.body.drawingsCaptions);
  if (req.fileValidationError) {
    return res.status(400).render("admin-place-form", {
      user: req.session.user,
      mode: "create",
      place: {
        ...place,
        drawingsText: req.body.drawingsText || "",
        drawingsCaptions: req.body.drawingsCaptions || "",
        qaRulesText: req.body.qaRulesText || "",
      },
      error: req.fileValidationError,
    });
  }
  if (!place.image) {
    return res.status(400).render("admin-place-form", {
      user: req.session.user,
      mode: "create",
      place: {
        ...place,
        drawingsText: req.body.drawingsText || "",
        drawingsCaptions: req.body.drawingsCaptions || "",
        qaRulesText: req.body.qaRulesText || "",
      },
      error: "请上传主图后再提交",
    });
  }
  const error = validatePlace(place, true);
  if (error) {
    return res.status(400).render("admin-place-form", {
      user: req.session.user,
      mode: "create",
      place: {
        ...place,
        drawingsText: req.body.drawingsText || "",
        drawingsCaptions: req.body.drawingsCaptions || "",
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
        drawingsCaptions: req.body.drawingsCaptions || "",
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
      drawingsText: drawingsToText(place.drawings),
      drawingsCaptions: "",
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
  payload.drawings = mergeUploadedDrawings(req.body.drawingsText, req.files?.drawingFiles, req.body.drawingsCaptions);
  if (!payload.drawings || payload.drawings.length === 0) {
    payload.drawings = existing.drawings || [];
  }
  if (req.fileValidationError) {
    return res.status(400).render("admin-place-form", {
      user: req.session.user,
      mode: "edit",
      place: {
        ...payload,
        drawingsText: req.body.drawingsText || "",
        drawingsCaptions: req.body.drawingsCaptions || "",
        qaRulesText: req.body.qaRulesText || "",
      },
      error: req.fileValidationError,
    });
  }
  const error = validatePlace(payload, false);
  if (error) {
    return res.status(400).render("admin-place-form", {
      user: req.session.user,
      mode: "edit",
      place: {
        ...payload,
        drawingsText: req.body.drawingsText || "",
        drawingsCaptions: req.body.drawingsCaptions || "",
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