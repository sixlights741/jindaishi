/*
 * 桌宠引擎（无依赖 Vanilla JS）
 * ---------------------------------------------------------------
 * 素材来自 dsh-pet（MIT，https://github.com/PC2005-cloud/dsh-pet）的透明动画，
 * 这里只保留「宠物本体」：待机呼吸 / 转向 / 漫游 / 随机小动作 / 点击回应 /
 * 拖拽弹簧跟手 / 甩抛反弹 / 落地 Q 弹。
 * 余额、碎碎念、对话生成这些依赖 DSH 宿主的能力没有搬过来——本项目的问答走
 * 自己的 /api/assistant（见 assistant.js）。
 *
 * 用法：
 *   const pet = NeuPet.createPet({ animBase: "/pet/anim/", size: 320 });
 *   pet.mount();
 *   pet.onClick = () => { ... };   // 点击宠物（非拖拽）时触发
 *   pet.setBusy("think");          // 思考动画
 *   pet.setBusy("ok");             // 答完开心一下
 */
(function (global) {
  "use strict";

  /* ---------- 几何常量：与 640×360 的透明动画强耦合 ---------- */
  var CANVAS_W = 640;
  var CANVAS_H = 360;
  var FEET_Y = 330; // 画布上脚底所在高度，宠物永远站在这条线上
  var HIT_BOX = { x0: 200, y0: 50, x1: 440, y1: 335 }; // 可点击/可拖拽的身体范围
  var PET_REF_WIDTH = 462; // 移动距离的基准宽度（配置里的距离按这个宽度写）
  var DRAG_THRESHOLD = 5; // 超过这个位移才算拖拽，否则算点击

  /* ---------- 手感 ---------- */
  var SQ_DURATION = 320; // Q 弹时长
  var SQ_SQUASH = 0.55; // 压扁到原高度的 55%
  var PHYSICS = { gravity: 1400, restitution: 0.78, groundFriction: 2.5, throwPower: 1 };

  /* 默认动画池：与 scripts/import-pet-assets.js 的拷贝清单一一对应 */
  var DEFAULT_ANIM = {
    idle: ["待机呼吸休闲"],
    turn: ["东张西望"],
    drag: "被鼠标拖拽悬空反馈",
    clicks: [
      "点击回应-开心跃动",
      "点击回应-害羞惊讶",
      "点击回应-傲娇生气",
      "点击回应-挠痒咯咯笑",
      "点击回应-元气挥手",
    ],
    moves: [
      { name: "原地漂浮踏步", min: 40, max: 120 },
      { name: "螃蟹走路", min: 60, max: 200 },
      { name: "原地左转奔跑", min: 120, max: 280 },
    ],
    random: [
      "写代码",
      "原地专心玩魔方",
      "悠闲哼歌",
      "超大伸懒腰",
      "原地小憩沉眠",
      "哈欠连天",
      "蓝鲸现世",
      "吃白饭",
      "照镜子",
    ],
    thinking: "工作状态-思考冒泡",
    success: "工作状态-雀跃庆祝",
    error: "工作状态-垂头叹气冒汗",
  };

  function pick(list) {
    return list[(Math.random() * list.length) | 0];
  }
  function rand(min, max) {
    return min + Math.random() * (max - min);
  }
  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }
  function prefersReducedMotion() {
    return (
      typeof global.matchMedia === "function" &&
      global.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }
  /** 回弹缓动：压扁后冲过 1 再收回来，就是「Q 弹」 */
  function easeOutBack(t) {
    var c1 = 1.70158;
    var c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  /** 有些内置浏览器放不出「带透明通道的 webm」：
   *  - iOS / Safari 不认 webm alpha，会显示黑底方块；
   *  - 微信内置浏览器（Android X5 / iOS WKWebView）还会拦截自动播放、
   *    或把 <video> 抢去用原生播放器，结果就是「宠物完全不显示」。
   *  这些环境统一退成静态立绘（fallback.png），点击、拖拽、问答全部照常。 */
  function prefersStaticPet() {
    var ua = (global.navigator && global.navigator.userAgent) || "";
    var isWeChat = /MicroMessenger/i.test(ua);
    var isIos = /iPhone|iPad|iPod/.test(ua);
    var isSafari = /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR|CriOS|FxiOS/.test(ua);
    return isWeChat || isIos || isSafari;
  }

  function createPet(options) {
    var opts = options || {};
    var animBase = String(opts.animBase || "/pet/anim/").replace(/\/+$/, "") + "/";
    var anim = Object.assign({}, DEFAULT_ANIM, opts.animations || {});
    var size = Math.max(120, Number(opts.size) || 320);
    var stageH = Math.round((size * CANVAS_H) / CANVAS_W);
    var margin = Number.isFinite(opts.margin) ? opts.margin : 24;
    // 四边可分别留白：本站右下角有「累计访问」角标，桌宠默认站在角标上方，别压住它
    var insets = Object.assign(
      { top: margin, right: margin, bottom: margin, left: margin },
      opts.insets || {}
    );
    var storageKey = opts.storageKey || "neu-pet-position-v1";

    /* ---------- 状态 ---------- */
    var stage = null;
    var videos = [];
    var bubble = null;
    var curIndex = 0;
    var endedCallback = null;
    var currentName = "";
    var chainTimer = 0;
    var bubbleTimer = 0;
    var squashRaf = 0;
    var throwRaf = 0;
    var throwState = null;

    var x = 0;
    var y = 0;
    // 没被用户拖过 = 处于「贴边」状态：视口变化时重新贴回右下角，
    // 否则页面在窗口尺寸稳定前就先挂载，会停在半空中。
    var docked = true;
    var facing = -1; // 1 = 朝右，-1 = 朝左（默认住右下角，面朝画面里）
    var dragging = false;
    var flying = false;
    var busy = false;
    var roaming = true;
    var destroyed = false;
    var mounted = false;
    var fallbackWarned = false;
    var staticOnly = opts.staticOnly === true || prefersStaticPet();

    var api = {
      onClick: null,
      onDragStart: null,
    };

    /* ---------- DOM ---------- */
    function build() {
      stage = document.createElement("div");
      stage.className = "neu-pet";
      stage.style.width = size + "px";
      stage.style.height = stageH + "px";
      stage.innerHTML =
        '<div class="neu-pet__float">' +
        '<video class="neu-pet__video" muted playsinline webkit-playsinline x5-playsinline preload="none" disablepictureinpicture></video>' +
        '<video class="neu-pet__video" muted playsinline webkit-playsinline x5-playsinline preload="none" disablepictureinpicture></video>' +
        '<div class="neu-pet__fallback" aria-hidden="true"></div>' +
        "</div>" +
        '<div class="neu-pet__hit" role="button" tabindex="0" aria-label="讲解小助手，点击开始提问"></div>' +
        '<div class="neu-pet__bubble" role="status" aria-live="polite"></div>';

      videos = Array.prototype.slice.call(stage.querySelectorAll(".neu-pet__video"));
      bubble = stage.querySelector(".neu-pet__bubble");

      var hit = stage.querySelector(".neu-pet__hit");
      hit.style.left = (HIT_BOX.x0 / CANVAS_W) * 100 + "%";
      hit.style.width = ((HIT_BOX.x1 - HIT_BOX.x0) / CANVAS_W) * 100 + "%";
      hit.style.top = (HIT_BOX.y0 / CANVAS_H) * 100 + "%";
      hit.style.height = ((HIT_BOX.y1 - HIT_BOX.y0) / CANVAS_H) * 100 + "%";

      videos.forEach(function (video) {
        video.addEventListener("ended", handleEnded);
        video.addEventListener("error", handleVideoError);
        video.addEventListener("loadeddata", function () {
          stage.classList.remove("is-missing");
        });
      });

      hit.addEventListener("pointerdown", handlePointerDown);
      hit.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          poke();
        }
      });
      hit.addEventListener("contextmenu", function (event) {
        event.preventDefault();
        resetPosition();
      });

      return stage;
    }

    /* ---------- 播放 ---------- */
    function urlOf(name) {
      return animBase + encodeURIComponent(name) + ".webm";
    }

    function play(name, settings) {
      if (!name || destroyed || !videos.length || staticOnly) {
        return;
      }
      var config = settings || {};
      var incoming = videos[1 - curIndex];
      var outgoing = videos[curIndex];

      endedCallback = config.onEnded || null;
      incoming.loop = Boolean(config.loop);
      if (incoming.dataset.name !== name) {
        incoming.dataset.name = name;
        incoming.src = urlOf(name);
      }
      try {
        incoming.currentTime = 0;
      } catch (error) {
        /* 还没拿到元数据时忽略 */
      }

      incoming.classList.add("is-front");
      outgoing.classList.remove("is-front");
      curIndex = 1 - curIndex;
      currentName = name;
      stage.dataset.anim = name;

      var playPromise = incoming.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(function () {
          /* 浏览器可能拦截自动播放，静音视频一般不会 */
        });
      }
    }

    function handleEnded(event) {
      if (event.currentTarget !== videos[curIndex]) {
        return;
      }
      var callback = endedCallback;
      endedCallback = null;
      if (typeof callback === "function") {
        callback();
      }
    }

    function handleVideoError(event) {
      if (event.currentTarget !== videos[curIndex]) {
        return;
      }
      var failed = event.currentTarget.dataset.name || "";

      // 单个动作缺失不算致命：退回待机，别让整只宠物消失
      if (anim.idle.indexOf(failed) === -1) {
        playIdle(600);
        return;
      }

      // 待机都放不出来 = 素材没导入（或浏览器不支持 webm alpha），退回静态图
      stage.classList.add("is-missing");
      if (!fallbackWarned) {
        fallbackWarned = true;
        if (global.console && global.console.warn) {
          global.console.warn("[neu-pet] 动画素材缺失，先在项目根目录运行：npm run pet:assets");
        }
        say("素材还没导入，先运行 npm run pet:assets 吧", 8000);
      }
      if (typeof endedCallback === "function") {
        var callback = endedCallback;
        endedCallback = null;
        setTimeout(callback, 600);
      }
    }

    /* ---------- 动画链 ---------- */
    function schedule(delay) {
      clearTimeout(chainTimer);
      chainTimer = setTimeout(next, Math.max(0, delay || 0));
    }

    function next() {
      if (destroyed || busy || dragging || flying) {
        return;
      }
      var roll = Math.random() * 100;
      if (roll < 10) {
        return playIdle(300);
      }
      if (roll < 15) {
        return playTurn();
      }
      if (roll < 20) {
        return roaming ? playMove() : playRandom();
      }
      return playRandom();
    }

    function playIdle(delay) {
      play(pick(anim.idle), {
        onEnded: function () {
          schedule(delay);
        },
      });
    }

    function playTurn() {
      play(pick(anim.turn), {
        onEnded: function () {
          facing = -facing;
          applyTransform();
          schedule(200);
        },
      });
    }

    function playRandom() {
      play(pick(anim.random), {
        onEnded: function () {
          schedule(500);
        },
      });
    }

    function playMove() {
      var move = pick(anim.moves);
      var bounds = getBounds();
      var distance = clamp(rand(move.min, move.max) * (size / PET_REF_WIDTH), 30, bounds.maxX - bounds.minX);
      var direction = Math.random() < 0.5 ? -1 : 1;
      var targetX = x + distance * direction;

      if (targetX < bounds.minX || targetX > bounds.maxX) {
        direction = -direction;
        targetX = x + distance * direction;
      }
      if (targetX < bounds.minX || targetX > bounds.maxX) {
        return playIdle(400);
      }

      facing = direction;
      applyTransform();
      play(move.name, {
        onEnded: function () {
          schedule(200);
        },
      });

      var from = x;
      var startedAt = 0;
      var duration = 3200;
      function walk(now) {
        if (destroyed || dragging || !mounted) {
          return;
        }
        if (!startedAt) {
          startedAt = now;
        }
        var progress = clamp((now - startedAt) / duration, 0, 1);
        x = from + (targetX - from) * progress;
        applyPosition();
        if (progress < 1) {
          requestAnimationFrame(walk);
        }
      }
      requestAnimationFrame(walk);
    }

    /* ---------- 定位 / 变换 ---------- */
    function getBounds() {
      var viewportW = global.innerWidth || document.documentElement.clientWidth;
      var viewportH = global.innerHeight || document.documentElement.clientHeight;
      return {
        minX: insets.left,
        maxX: Math.max(insets.left, viewportW - size - insets.right),
        minY: insets.top,
        maxY: Math.max(insets.top, viewportH - stageH - insets.bottom),
      };
    }

    function applyPosition() {
      if (!stage) {
        return;
      }
      stage.style.transform = "translate3d(" + Math.round(x) + "px," + Math.round(y) + "px,0)";
    }

    function applyTransform() {
      if (!stage) {
        return;
      }
      stage.style.setProperty("--facing", String(facing));
    }

    function squash(from, to) {
      if (!stage || prefersReducedMotion()) {
        return;
      }
      var float = stage.querySelector(".neu-pet__float");
      if (!float) {
        return;
      }
      cancelAnimationFrame(squashRaf);
      var startedAt = performance.now();
      function step(now) {
        var t = clamp((now - startedAt) / SQ_DURATION, 0, 1);
        var value = from + (to - from) * easeOutBack(t);
        float.style.setProperty("--squash", String(value));
        if (t < 1) {
          squashRaf = requestAnimationFrame(step);
        } else {
          float.style.setProperty("--squash", "1");
        }
      }
      float.style.setProperty("--squash", String(from));
      squashRaf = requestAnimationFrame(step);
    }

    function bounceSquash(impact) {
      var squashTo = impact > 900 ? 0.25 : impact > 500 ? 0.15 : 0.08;
      squash(1 - squashTo, 1);
    }

    /* ---------- 拖拽 / 甩抛 ---------- */
    var pointer = null;

    function handlePointerDown(event) {
      if (event.button !== undefined && event.button !== 0) {
        return;
      }
      if (destroyed) {
        return;
      }
      if (flying) {
        stopThrow();
      }
      pointer = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        offsetX: event.clientX - x,
        offsetY: event.clientY - y,
        samples: [{ t: performance.now(), x: event.clientX, y: event.clientY }],
      };
      dragging = false;
      event.target.setPointerCapture && event.target.setPointerCapture(event.pointerId);
      document.addEventListener("pointermove", handlePointerMove);
      document.addEventListener("pointerup", handlePointerUp);
      document.addEventListener("pointercancel", handlePointerUp);
    }

    function handlePointerMove(event) {
      if (!pointer || event.pointerId !== pointer.id) {
        return;
      }
      var dx = event.clientX - pointer.startX;
      var dy = event.clientY - pointer.startY;

      if (!dragging && Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
        dragging = true;
        clearTimeout(chainTimer);
        play(anim.drag, { loop: true });
        if (typeof api.onDragStart === "function") {
          api.onDragStart();
        }
      }
      if (!dragging) {
        return;
      }

      var bounds = getBounds();
      x = clamp(event.clientX - pointer.offsetX, bounds.minX - 40, bounds.maxX + 40);
      y = clamp(event.clientY - pointer.offsetY, bounds.minY - 40, bounds.maxY + 40);
      applyPosition();

      pointer.samples.push({ t: performance.now(), x: event.clientX, y: event.clientY });
      if (pointer.samples.length > 8) {
        pointer.samples.shift();
      }
    }

    function handlePointerUp(event) {
      if (!pointer || (event.pointerId !== undefined && event.pointerId !== pointer.id)) {
        return;
      }
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerUp);

      var wasDragging = dragging;
      dragging = false;

      if (!wasDragging) {
        pointer = null;
        poke();
        return;
      }

      var first = pointer.samples[0];
      var last = pointer.samples[pointer.samples.length - 1];
      var elapsed = Math.max(16, last.t - first.t) / 1000;
      var vx = ((last.x - first.x) / elapsed) * PHYSICS.throwPower;
      var vy = ((last.y - first.y) / elapsed) * PHYSICS.throwPower;
      pointer = null;

      var speed = Math.sqrt(vx * vx + vy * vy);
      if (speed > 120) {
        startThrow(clamp(vx, -2600, 2600), clamp(vy, -2600, 2600));
      } else {
        // 慢慢放下：温和落地，不弹
        var bounds = getBounds();
        y = clamp(y, bounds.minY, bounds.maxY);
        x = clamp(x, bounds.minX, bounds.maxX);
        applyPosition();
        savePosition();
        schedule(450);
      }
    }

    function startThrow(vx, vy) {
      flying = true;
      throwState = {
        vx: vx,
        vy: vy,
        last: performance.now(),
        facing: vx > 40 ? 1 : vx < -40 ? -1 : facing,
      };
      facing = throwState.facing;
      applyTransform();
      play(anim.drag, { loop: true });
      cancelAnimationFrame(throwRaf);
      throwRaf = requestAnimationFrame(stepThrow);
    }

    function stepThrow(now) {
      var state = throwState;
      if (!state || destroyed) {
        return;
      }
      var dt = Math.min(0.033, (now - state.last) / 1000) || 0.016;
      state.last = now;
      state.vy += PHYSICS.gravity * dt;
      x += state.vx * dt;
      y += state.vy * dt;

      var bounds = getBounds();

      if (x < bounds.minX) {
        x = bounds.minX;
        state.vx = Math.abs(state.vx) * PHYSICS.restitution;
      } else if (x > bounds.maxX) {
        x = bounds.maxX;
        state.vx = -Math.abs(state.vx) * PHYSICS.restitution;
      }

      if (y < bounds.minY) {
        y = bounds.minY;
        state.vy = Math.abs(state.vy) * PHYSICS.restitution;
      }

      if (y >= bounds.maxY) {
        y = bounds.maxY;
        if (Math.abs(state.vy) > 120) {
          bounceSquash(Math.abs(state.vy));
          state.vy = -Math.abs(state.vy) * PHYSICS.restitution;
        } else {
          state.vy = 0;
          state.vx *= Math.max(0, 1 - PHYSICS.groundFriction * dt);
        }
      }

      applyPosition();

      var resting = y >= bounds.maxY - 0.5 && Math.abs(state.vx) < 18 && Math.abs(state.vy) < 30;
      if (resting) {
        state.vx = 0;
        flying = false;
        throwState = null;
        cancelAnimationFrame(throwRaf);
        savePosition();
        playIdle(400);
        return;
      }
      throwRaf = requestAnimationFrame(stepThrow);
    }

    function stopThrow() {
      flying = false;
      throwState = null;
      cancelAnimationFrame(throwRaf);
    }

    /* ---------- 对外动作 ---------- */
    function poke() {
      if (destroyed) {
        return;
      }
      squash(SQ_SQUASH, 1);
      play(pick(anim.clicks), {
        onEnded: function () {
          schedule(400);
        },
      });
      if (typeof api.onClick === "function") {
        api.onClick();
      }
    }

    function say(text, duration) {
      if (!bubble) {
        return;
      }
      clearTimeout(bubbleTimer);
      if (!text) {
        bubble.classList.remove("is-visible");
        return;
      }
      bubble.textContent = text;
      bubble.classList.add("is-visible");
      if (duration !== 0) {
        bubbleTimer = setTimeout(function () {
          bubble.classList.remove("is-visible");
        }, duration || 6000);
      }
    }

    function setBusy(mode) {
      if (destroyed) {
        return;
      }
      if (mode === "think") {
        busy = true;
        clearTimeout(chainTimer);
        play(anim.thinking, { loop: true });
        return;
      }
      busy = false;
      if (mode === "ok") {
        play(anim.success, {
          onEnded: function () {
            schedule(300);
          },
        });
        return;
      }
      if (mode === "error") {
        play(anim.error, {
          onEnded: function () {
            schedule(300);
          },
        });
        return;
      }
      schedule(0);
    }

    function setRoaming(enabled) {
      roaming = Boolean(enabled);
    }

    function resetPosition() {
      var bounds = getBounds();
      x = bounds.maxX;
      y = bounds.maxY;
      facing = -1;
      applyTransform();
      applyPosition();
      savePosition();
      docked = true; // 右键复位 = 重新贴回右下角
      stopThrow();
      playIdle(300);
    }

    function savePosition() {
      docked = false; // 用户自己摆过位置，之后 resize 只做边界钳制
      try {
        localStorage.setItem(storageKey, JSON.stringify({ x: Math.round(x), y: Math.round(y) }));
      } catch (error) {
        /* 隐私模式下忽略 */
      }
    }

    function restorePosition() {
      var bounds = getBounds();
      var saved = null;
      try {
        saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      } catch (error) {
        saved = null;
      }
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        x = clamp(saved.x, bounds.minX, bounds.maxX);
        y = clamp(saved.y, bounds.minY, bounds.maxY);
        docked = false;
      } else {
        x = bounds.maxX;
        y = bounds.maxY;
        docked = true;
      }
      applyPosition();
    }

    function handleResize() {
      if (!mounted) {
        return;
      }
      var bounds = getBounds();
      if (docked) {
        x = bounds.maxX;
        y = bounds.maxY;
      } else {
        x = clamp(x, bounds.minX, bounds.maxX);
        y = clamp(y, bounds.minY, bounds.maxY);
      }
      applyPosition();
    }

    function mount() {
      if (mounted || destroyed) {
        return;
      }
      build();
      document.body.appendChild(stage);
      mounted = true;
      restorePosition();
      applyTransform();
      if (staticOnly) {
        // Safari/iOS：不碰 video，直接静态立绘，免得出现黑底方块
        stage.classList.add("is-missing");
        stage.classList.add("is-static");
      } else {
        playIdle(600);
      }
      global.addEventListener("resize", handleResize);
      // 兜底：有些内置浏览器既不报错、也放不出画面（典型是微信/厂商 WebView）。
      // 挂载后 8 秒还没有任何一帧解码成功，就直接显示静态立绘，别让宠物凭空消失。
      setTimeout(function () {
        if (destroyed || staticOnly || !mounted) {
          return;
        }
        var hasFrame = false;
        for (var i = 0; i < videos.length; i += 1) {
          if (videos[i].readyState >= 2) {
            hasFrame = true;
            break;
          }
        }
        if (!hasFrame) {
          stage.classList.add("is-missing");
        }
      }, 8000);
      // 有些环境（移动端地址栏收起、无头浏览器注入窗口尺寸）会在挂载后才真正定下视口，
      // 贴边状态下再贴一次，避免宠物停在半空或被裁掉。
      setTimeout(function () {
        if (!mounted || !docked || destroyed) {
          return;
        }
        var bounds = getBounds();
        x = bounds.maxX;
        y = bounds.maxY;
        applyPosition();
      }, 150);
    }

    function destroy() {
      destroyed = true;
      clearTimeout(chainTimer);
      clearTimeout(bubbleTimer);
      cancelAnimationFrame(squashRaf);
      cancelAnimationFrame(throwRaf);
      global.removeEventListener("resize", handleResize);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerUp);
      if (stage && stage.parentNode) {
        stage.parentNode.removeChild(stage);
      }
      mounted = false;
    }

    return {
      mount: mount,
      destroy: destroy,
      poke: poke,
      say: say,
      setBusy: setBusy,
      setRoaming: setRoaming,
      play: play,
      resetPosition: resetPosition,
      getRect: function () {
        return { left: x, top: y, width: size, height: stageH };
      },
      get facing() {
        return facing;
      },
      set onClick(handler) {
        api.onClick = handler;
      },
      get onClick() {
        return api.onClick;
      },
      get currentAnimation() {
        return currentName;
      },
      get size() {
        return size;
      },
    };
  }

  global.NeuPet = { createPet: createPet };
})(window);
