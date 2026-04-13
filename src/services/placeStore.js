const fs = require("fs");
const path = require("path");

const placesPath = path.join(__dirname, "../../data/places.json");

function writePlaces(places) {
  fs.writeFileSync(placesPath, JSON.stringify(places, null, 2), "utf-8");
}

function getPlaces() {
  try {
    const raw = fs.readFileSync(placesPath, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
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