const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const dataDir = path.join(__dirname, "../../data");
const usersPath = path.join(dataDir, "users.json");
const studentIdsPath = path.join(dataDir, "student_ids.json");
const adminIdsPath = path.join(dataDir, "admin_ids.json");

function readJson(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, content) {
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2), "utf-8");
}

function ensureUserFile() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(usersPath)) {
    const seededUsers = seedFromStudentIds();
    writeJson(usersPath, seededUsers);
    return;
  }

  const users = readJson(usersPath, []);
  if (!Array.isArray(users) || users.length === 0) {
    const seededUsers = seedFromStudentIds();
    writeJson(usersPath, seededUsers);
  }
}

function seedFromStudentIds() {
  const ids = readJson(studentIdsPath, ["20230001", "20230002", "20230003"]);
  const adminIds = readJson(adminIdsPath, ["20230001"]).map((item) => String(item).trim());
  return ids.map((studentId) => {
    const sid = String(studentId).trim();
    return {
      studentId: sid,
      passwordHash: bcrypt.hashSync(sid, 10),
      mustChangePassword: true,
      isAdmin: adminIds.includes(sid),
    };
  });
}

function getUsers() {
  return readJson(usersPath, []);
}

function getAdminIds() {
  return readJson(adminIdsPath, ["20230001"]).map((item) => String(item).trim());
}

function getUserByStudentId(studentId) {
  const users = getUsers();
  const user = users.find((item) => item.studentId === studentId) || null;
  if (!user) {
    return null;
  }
  const adminIds = getAdminIds();
  return {
    ...user,
    isAdmin: adminIds.includes(user.studentId),
  };
}

async function verifyUser(studentId, password) {
  const user = getUserByStudentId(studentId);
  if (!user) {
    return null;
  }

  const pass = await bcrypt.compare(password, user.passwordHash);
  if (!pass) {
    return null;
  }
  return user;
}

async function updatePassword(studentId, newPassword) {
  const users = getUsers();
  const index = users.findIndex((item) => item.studentId === studentId);
  if (index === -1) {
    throw new Error("用户不存在");
  }

  users[index].passwordHash = await bcrypt.hash(newPassword, 10);
  users[index].mustChangePassword = false;
  writeJson(usersPath, users);
}

module.exports = {
  ensureUserFile,
  verifyUser,
  updatePassword,
  getUserByStudentId,
};