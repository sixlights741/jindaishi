const path = require("path");
const { repairMojibakeText } = require("./uploadedFileName");
const { readJsonFile, writeJsonFile } = require("./jsonFile");

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
  writeJsonFile(placesPath, places.map(toStoredPlace));
}

// 每张图只有一个自由文字字段 note（想写什么写什么，不要求格式）。
// 历史数据里是 caption（说明）与 credit（署名）两个字段，这里合并成一条 note；
// 管理员下次保存该地点时按新格式写回，旧字段自然消失。
function combineDrawingNote(item) {
  const caption = repairMojibakeText(item.caption || "").trim();
  const credit = String(item.credit || "").trim();
  if (caption && credit && caption !== credit) {
    return `${caption}（${credit}）`;
  }
  return caption || credit;
}

// 读取时统一结构：
//   补齐 videoUrls；
//   手绘图把 caption/credit 合并成 note（并修掉早期版本误存的中文乱码说明）；
//   丢弃旧的 caption / credit，避免两套字段并存时再次被覆盖。
function toViewPlace(place) {
  if (!place || typeof place !== "object") {
    return place;
  }
  const drawings = Array.isArray(place.drawings)
    ? place.drawings.map((item) => {
        if (!item || typeof item !== "object") {
          return item;
        }
        const { caption, credit, ...rest } = item;
        // 已经是新格式（有 note）就直接用，否则由旧字段合并
        const note = typeof item.note === "string" && item.note ? item.note : combineDrawingNote(item);
        return { ...rest, note };
      })
    : place.drawings;
  return { ...place, drawings, videoUrls: normalizeVideoUrls(place) };
}

function getPlaces() {
  const data = readJsonFile(placesPath, []);
  return Array.isArray(data) ? data.map(toViewPlace) : [];
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