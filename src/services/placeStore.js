const fs = require("fs");
const path = require("path");
const { repairMojibakeText } = require("./uploadedFileName");

const placesPath = path.join(__dirname, "../../data/places.json");

// 视频链接已从单条 videoUrl 升级为 videoUrls 数组，读取时统一成数组，写回时不再保留旧字段
function normalizeVideoUrls(place) {
  const list = Array.isArray(place?.videoUrls)
    ? place.videoUrls.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (list.length > 0) {
    return list;
  }
  const legacy = String(place?.videoUrl || "").trim();
  return legacy ? [legacy] : [];
}

function toStoredPlace(place) {
  const { videoUrl, ...rest } = place || {};
  return { ...rest, videoUrls: normalizeVideoUrls(place) };
}

function writePlaces(places) {
  fs.writeFileSync(placesPath, JSON.stringify(places.map(toStoredPlace), null, 2), "utf-8");
}

// 读取时统一结构：补齐 videoUrls；
// 早期版本把中文文件名按 latin1 存成了乱码说明，这里一并还原，页面不再显示乱码。
// （还原结果会在管理员下次保存该地点时写回文件。）
function toViewPlace(place) {
  if (!place || typeof place !== "object") {
    return place;
  }
  const drawings = Array.isArray(place.drawings)
    ? place.drawings.map((item) =>
        item && typeof item === "object" ? { ...item, caption: repairMojibakeText(item.caption) } : item
      )
    : place.drawings;
  return { ...place, drawings, videoUrls: normalizeVideoUrls(place) };
}

function getPlaces() {
  try {
    const raw = fs.readFileSync(placesPath, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data.map(toViewPlace) : [];
  } catch (error) {
    return [];
  }
}

function getPlaceById(id) {
  return getPlaces().find((item) => item.id === id) || null;
}

function addPlace(place) {
  const places = getPlaces();
  places.push(place);
  writePlaces(places);
}

function updatePlace(id, payload) {
  const places = getPlaces();
  const index = places.findIndex((item) => item.id === id);
  if (index === -1) {
    return false;
  }
  places[index] = {
    ...places[index],
    ...payload,
  };
  writePlaces(places);
  return true;
}

function deletePlace(id) {
  const places = getPlaces();
  const next = places.filter((item) => item.id !== id);
  if (next.length === places.length) {
    return false;
  }
  writePlaces(next);
  return true;
}

module.exports = {
  getPlaces,
  getPlaceById,
  addPlace,
  updatePlace,
  deletePlace,
};