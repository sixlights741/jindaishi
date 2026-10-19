/*
 * 桌宠问答：把「点击宠物 → 提问」接到站点自己的 /api/assistant。
 * 面板只保留输入框 + 对话记录，不再展示任何预设问题。
 * 首次进入的引导气泡显示 9 秒；点过宠物（打开过面板）后写 localStorage，之后不再出现。
 *
 * 页面只需要提供：
 *   <section id="neu-pet" data-place-id="..." data-place-name="..." data-user-id="..."></section>
 */
(function () {
  "use strict";

  var root = document.getElementById("neu-pet");
  if (!root || !window.NeuPet) {
    return;
  }

  var placeId = root.dataset.placeId || "";
  var placeName = root.dataset.placeName || "这处地点";
  var userId = root.dataset.userId || "unknown";
  var storageKey = "neu-pet-chat-" + userId + "-" + placeId;

  var isNarrow = window.innerWidth < 640;
  // 首次进页面的引导气泡：说明这只桌宠是讲解小助手，不是装饰
  var HINT = isNarrow
    ? "点我问问这里的历史～"
    : "我是讲解小助手，点我问问这里的历史～";
  var HINT_SHOWN_MS = 9000;
  var HINT_KEY = "neu-pet-hint-seen-v1";
  var hintSeen = false;
  try {
    hintSeen = localStorage.getItem(HINT_KEY) === "1";
  } catch (error) {
    hintSeen = false; // 隐私模式下每次都提示
  }
  var pet = window.NeuPet.createPet({
    animBase: "/pet/anim/",
    size: isNarrow ? 220 : 320,
    margin: 16,
    // 右下角有「累计访问」角标（bottom:24 / 页面滚到底还会抬高），底边多留一截，
    // 让桌宠站在角标上方而不是踩在它上面。
    insets: { top: 16, right: 16, left: 16, bottom: isNarrow ? 58 : 72 },
  });

  /* ---------------- 面板 DOM ---------------- */
  var panel = document.createElement("section");
  panel.className = "neu-pet-chat";
  panel.setAttribute("hidden", "");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "校史讲解小助手");
  panel.innerHTML =
    '<header class="neu-pet-chat__header">' +
    '<span class="neu-pet-chat__title">讲解小助手</span>' +
    '<button type="button" class="neu-pet-chat__clear">清空</button>' +
    '<button type="button" class="neu-pet-chat__close" aria-label="关闭对话">×</button>' +
    "</header>" +
    '<div class="neu-pet-chat__log" role="log" aria-live="polite"></div>' +
    '<form class="neu-pet-chat__form">' +
    '<input type="text" maxlength="300" placeholder="例如：这里最重要的历史意义是什么？" aria-label="你的问题" />' +
    '<button type="submit">提问</button>' +
    "</form>";

  var logEl = panel.querySelector(".neu-pet-chat__log");
  var formEl = panel.querySelector(".neu-pet-chat__form");
  var inputEl = panel.querySelector("input");
  var submitEl = panel.querySelector("button[type='submit']");

  var isOpen = false;
  var isAsking = false;

  /* ---------------- 头顶气泡 ---------------- */
  // 进页面提示 9 秒后自动收起；点过宠物（打开过面板）之后不再出现
  function markHintSeen() {
    hintSeen = true;
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch (error) {
      /* 隐私模式忽略 */
    }
  }

  function showHint() {
    if (isOpen || hintSeen) {
      return;
    }
    pet.say(HINT, HINT_SHOWN_MS);
  }

  function hideHint() {
    pet.say("");
  }

  /* ---------------- 历史记录 ---------------- */
  function loadHistory() {
    try {
      var saved = JSON.parse(sessionStorage.getItem(storageKey) || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch (error) {
      return [];
    }
  }

  function saveHistory(messages) {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(messages));
    } catch (error) {
      /* 隐私模式忽略 */
    }
  }

  var messages = loadHistory();

  function renderMessages() {
    logEl.innerHTML = "";
    messages.forEach(function (message) {
      appendBubble(message.text, message.role, false);
    });
    if (!messages.length) {
      appendBubble(
        "你好，我是" + placeName + "的讲解小助手，直接输入问题就可以。",
        "bot",
        false
      );
    }
    logEl.scrollTop = logEl.scrollHeight;
  }

  function appendBubble(text, role, persist) {
    var node = document.createElement("div");
    node.className = "neu-pet-msg " + (role === "user" ? "neu-pet-msg--user" : "neu-pet-msg--bot");
    node.textContent = text;
    logEl.appendChild(node);
    logEl.scrollTop = logEl.scrollHeight;
    if (persist !== false) {
      messages.push({ role: role, text: text });
      saveHistory(messages);
    }
  }

  function appendMeta(text) {
    var node = document.createElement("div");
    node.className = "neu-pet-msg neu-pet-msg--meta";
    node.textContent = text;
    logEl.appendChild(node);
    logEl.scrollTop = logEl.scrollHeight;
  }

  /* ---------------- 提问 ---------------- */
  var SOURCE_LABEL = {
    cloud: "云端模型",
    preset: "预设问答",
    local: "本地规则",
    "fallback-fixed": "固定兜底",
  };

  async function ask(question) {
    var trimmed = (question || "").trim();
    if (!trimmed || isAsking) {
      return;
    }

    isAsking = true;
    appendBubble(trimmed, "user");
    inputEl.value = "";
    submitEl.disabled = true;
    submitEl.textContent = "思考中…";
    pet.setBusy("think");

    try {
      var response = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placeId: placeId, question: trimmed }),
      });

      var contentType = response.headers.get("content-type") || "";
      var payload = contentType.includes("application/json") ? await response.json() : null;

      if (response.status === 401) {
        appendBubble("登录已失效，请重新登录后再继续提问。", "bot");
        pet.setBusy("error");
        return;
      }
      if (response.status === 404) {
        appendBubble("讲解接口不存在（404），请重启服务后刷新页面再试。", "bot");
        pet.setBusy("error");
        return;
      }
      if (!response.ok) {
        appendBubble((payload && payload.error) || "请求失败（" + response.status + "）", "bot");
        pet.setBusy("error");
        return;
      }
      if (!payload || !payload.answer) {
        appendBubble("服务返回格式异常，请稍后重试。", "bot");
        pet.setBusy("error");
        return;
      }

      appendBubble(payload.answer, "bot");
      var label = SOURCE_LABEL[payload.source] || "本地规则";
      var note = "来源：" + label;
      if (payload.source !== "cloud" && payload.fallbackReason) {
        note += "（云端降级：" + payload.fallbackReason + "）";
      }
      appendMeta(note);
      pet.setBusy("ok");

      // 答案太长时把第一句顶到头顶气泡里，不打开面板也知道回了什么
      var firstLine = String(payload.answer).split("\n")[0];
      pet.say(firstLine.length > 40 ? firstLine.slice(0, 40) + "…" : firstLine, 5000);
    } catch (error) {
      appendBubble("网络请求失败，请稍后重试。", "bot");
      pet.setBusy("error");
    } finally {
      isAsking = false;
      submitEl.disabled = false;
      submitEl.textContent = "提问";
      inputEl.focus();
    }
  }

  /* ---------------- 面板开合 / 摆位 ---------------- */
  function placePanel() {
    if (window.innerWidth <= 640) {
      return; // 手机端由 CSS 贴底
    }
    panel.style.right = "auto";
    panel.style.bottom = "auto";

    var rect = pet.getRect();
    var panelW = panel.offsetWidth || 380;
    var panelH = panel.offsetHeight || 420;
    var gap = 12;
    var viewportW = window.innerWidth;
    var viewportH = window.innerHeight;

    var left;
    var top;

    if (rect.top - panelH - gap >= gap) {
      // 优先放在宠物头顶上方
      top = rect.top - panelH - gap;
      left = rect.left + rect.width - panelW;
    } else if (rect.left - panelW - gap >= gap) {
      // 上方放不下就放左侧，底边对齐宠物
      left = rect.left - panelW - gap;
      top = Math.min(rect.top, viewportH - panelH - gap);
    } else {
      // 再不行放右侧
      left = Math.min(rect.left + rect.width + gap, viewportW - panelW - gap);
      top = Math.min(rect.top, viewportH - panelH - gap);
    }

    panel.style.left = Math.max(gap, Math.min(left, viewportW - panelW - gap)) + "px";
    panel.style.top = Math.max(gap, Math.min(top, viewportH - panelH - gap)) + "px";
  }

  function openPanel() {
    if (isOpen) {
      inputEl.focus();
      return;
    }
    isOpen = true;
    panel.hidden = false;
    document.body.appendChild(panel);
    renderMessages();
    placePanel();
    pet.setRoaming(false);
    markHintSeen(); // 点开过面板 = 已经知道它是助手，以后不再弹引导
    hideHint();
    inputEl.focus();
  }

  function closePanel() {
    isOpen = false;
    panel.hidden = true;
    pet.setRoaming(true);
    if (!isAsking) {
      pet.setBusy("idle"); // 思考动画是循环的，关面板时要放它回去
    }
  }

  /* ---------------- 事件绑定 ---------------- */
  pet.onClick = function () {
    if (isOpen) {
      inputEl.focus();
    } else {
      openPanel();
    }
  };

  formEl.addEventListener("submit", function (event) {
    event.preventDefault();
    ask(inputEl.value);
  });

  panel.querySelector(".neu-pet-chat__close").addEventListener("click", closePanel);

  panel.querySelector(".neu-pet-chat__clear").addEventListener("click", function () {
    messages = [];
    saveHistory(messages);
    renderMessages();
    appendBubble("对话已清空，重新问一个吧～", "bot", false);
    inputEl.focus();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && isOpen) {
      closePanel();
    }
  });

  window.addEventListener("resize", function () {
    if (isOpen) {
      placePanel();
    }
  });

  pet.mount();
  showHint();
})();
