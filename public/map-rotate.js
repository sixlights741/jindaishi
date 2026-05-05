/**
 * 地图旋转 —— 纯前端切图，毫秒级响应
 * 每次点击在 4 张预生成图片间轮换，并自动重算标记点坐标
 */
(function () {
  const map = document.getElementById("map");
  if (!map) return;

  // 4 张预旋转图片
  const SRCS = [
    "/images/map_pic.jpg",       // 0°
    "/images/map_pic_90.jpg",    // 90°
    "/images/map_pic_180.jpg",   // 180°
    "/images/map_pic_270.jpg",   // 270°
  ];

  // 0°/180° 图片尺寸 2988x4096，90°/270° 图片尺寸 4096x2988
  const W0 = 2988, H0 = 4096;
  const W90 = 4096, H90 = 2988;

  // ---------- 注入圆形旋转按钮 ----------
  const btn = document.createElement("button");
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';
  btn.id = "mapRotateBtn";
  btn.title = "旋转地图（每次 90°）";
  const mapImgWrap = map.querySelector(".map-img-wrap");
  if (!mapImgWrap) return;
  // 挂到 body 上，用 fixed 定位避开所有 overflow:hidden 和层叠遮挡
  document.body.appendChild(btn);

  // 同步按钮位置到地图右上角
  function syncBtnPosition() {
    var rect = mapImgWrap.getBoundingClientRect();
    btn.style.top  = (rect.top + 10) + "px";
    btn.style.left = (rect.right - 54) + "px"; // 44px宽 + 10px间距
  }
  syncBtnPosition();
  window.addEventListener("resize", syncBtnPosition);
  window.addEventListener("scroll", syncBtnPosition, { passive: true });

  // ---------- 图像元素 ----------
  const img = map.querySelector(".map-base-img");
  if (!img) return;

  // 图片切换后（不同旋转图可能改变地图区域高度），重新同步按钮位置
  img.addEventListener("load", syncBtnPosition);

  // ---------- 标记点操作 ----------
  const markersEl = document.getElementById("mapMarkers");
  let rotIdx = 0;

  // 把原始坐标 (px, py) 映射到旋转后图片上的百分比位置
  function mapCoords(px, py, idx) {
    if (idx === 0) return { left: (px / W0 * 100).toFixed(2), top: (py / H0 * 100).toFixed(2) };
    if (idx === 1) return { left: ((W90 - py) / W90 * 100).toFixed(2), top: (px / H90 * 100).toFixed(2) };
    if (idx === 2) return { left: ((W0 - px) / W0 * 100).toFixed(2), top: ((H0 - py) / H0 * 100).toFixed(2) };
    return           { left: (py / W90 * 100).toFixed(2), top: ((H90 - px) / H90 * 100).toFixed(2) };
  }

  function repositionMarkers() {
    const markers = markersEl ? markersEl.querySelectorAll(".map-marker") : [];
    markers.forEach(function (m) {
      const px = parseInt(m.dataset.px, 10);
      const py = parseInt(m.dataset.py, 10);
      if (isNaN(px) || isNaN(py)) return;
      const pos = mapCoords(px, py, rotIdx);
      m.style.left = pos.left + "%";
      m.style.top = pos.top + "%";
    });
  }

  // ---------- 点击旋转 ----------
  btn.addEventListener("click", function () {
    rotIdx = (rotIdx + 1) % 4;
    img.src = SRCS[rotIdx];
    repositionMarkers();

    // 按钮图标旋转动画
    btn.classList.add("spinning");
    setTimeout(function () { btn.classList.remove("spinning"); }, 350);
  });
})();
