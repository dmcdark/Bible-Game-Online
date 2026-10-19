const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs/promises");
const path = require("path");
const { randomInt, randomUUID } = require("crypto");
const { isIP } = require("net");
const rules = require("./online-rules");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const MAX_ROOMS = 100;
const MAX_CONNECTIONS = 200;
const ROOM_IDLE_MS = 30 * 60 * 1000;
const ROOM_LIFETIME_MS = 6 * 60 * 60 * 1000;
const origins = new Set();
if (process.env.PUBLIC_ORIGIN) {
  const url = new URL(process.env.PUBLIC_ORIGIN);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("PUBLIC_ORIGIN must be an http(s) origin without a path or credentials");
  }
  origins.add(url.origin);
} else if (process.env.NODE_ENV === "production") {
  throw new Error("Set PUBLIC_ORIGIN before exposing the production service");
} else {
  origins.add(`http://localhost:${PORT}`);
  origins.add(`http://127.0.0.1:${PORT}`);
  if (process.env.CODESPACE_NAME && process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN) {
    origins.add(`https://${process.env.CODESPACE_NAME}-${PORT}.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`);
  }
}

const app = express();
app.disable("x-powered-by");
const server = http.createServer(app);
server.requestTimeout = 15000;
server.headersTimeout = 10000;
const allowedOrigin = origin => origin === undefined || origins.has(origin);
const io = new Server(server, {
  maxHttpBufferSize: 16 * 1024,
  connectTimeout: 10000,
  perMessageDeflate: false,
  cors: { origin: [...origins], methods: ["GET", "POST"] },
  allowRequest: (req, done) => done(null, allowedOrigin(req.headers.origin) && io.engine.clientsCount < MAX_CONNECTIONS)
});

const wsOrigins = [...origins].map(origin => origin.replace(/^http/, "ws"));
const securityHeaders = {
  "Content-Security-Policy": `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ${wsOrigins.join(" ")}; img-src 'self' data:; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
};
// Cover Express and the Socket.IO client bundle, which bypasses Express.
server.prependListener("request", (req, res) => {
  for (const [name, value] of Object.entries(securityHeaders)) res.setHeader(name, value);
});
// WebSocket upgrade handshakes do not emit the HTTP request event.
io.engine.on("headers", headers => { Object.assign(headers, securityHeaders); });

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function playerName(value, fallback) {
  if (value === undefined || value === "") return fallback;
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (!name) return fallback;
  return name.length <= 32 && !/[\u0000-\u001f\u007f-\u009f]/u.test(name) ? name : null;
}

// X-Forwarded-For is ignored by default. Enable only behind a trusted local
// Nginx proxy, which must overwrite this header with $remote_addr.
function clientIP(req) {
  const peer = req.socket.remoteAddress || "unknown";
  if (process.env.TRUST_LOCAL_PROXY === "1" && ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer)) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && isIP(forwarded)) return forwarded;
  }
  return peer;
}

const buckets = new Map();
function consume(key, max, windowMs) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now >= bucket.until) {
    if (!bucket && buckets.size >= 5000) return false;
    bucket = { count: 0, until: now + windowMs };
    buckets.set(key, bucket);
  }
  return ++bucket.count <= max;
}
function httpLimit(req, res, next) {
  const ip = clientIP(req);
  if (!consume(`api:${ip}`, 120, 60000) ||
      (req.method === "POST" && (!consume(`score:${ip}`, 10, 60000) || !consume("score:global", 60, 60000)))) {
    res.set("Retry-After", "60");
    return res.status(429).json({ error: "请求太频繁，请稍后再试" });
  }
  next();
}
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!allowedOrigin(req.headers.origin)) return res.status(403).json({ error: "不允许的来源" });
  next();
}, httpLimit, express.json({ limit: "2kb", strict: true }));

// Only frontend directories and these exact root assets are public.
app.get(["/", "/index.html"], (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/style.css", (req, res) => res.sendFile(path.join(__dirname, "style.css")));
app.get("/ui-actions.js", (req, res) => res.sendFile(path.join(__dirname, "ui-actions.js")));
for (const game of ["pilgrim-progress", "seventy-disciples"]) {
  app.use(`/${game}`, express.static(path.join(__dirname, game), { dotfiles: "deny" }));
}
app.get("/healthz", (req, res) => res.json({ status: "ok" }));

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, ".data"));
const leaderboardFile = path.join(dataDir, "leaderboard.json");
let leaderboard = [];
let writeQueue = Promise.resolve();
function record(value) {
  if (!object(value)) return null;
  const name = playerName(value.name, null);
  const validInt = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
  if (!name || !validInt(value.faith, 0, 100000) || !validInt(value.rounds, 1, 100000) || !validInt(value.durationSec, 1, 604800)) return null;
  return { name, faith: value.faith, rounds: value.rounds, durationSec: value.durationSec };
}
app.get("/api/leaderboard", (req, res) => res.json(leaderboard));
app.post("/api/leaderboard", (req, res, next) => {
  const entry = record(req.body);
  if (!entry) return res.status(400).json({ error: "成绩字段格式或范围不正确" });
  entry.date = new Date().toISOString().split("T")[0];
  // Serialise updates and atomically replace the file. A failed write must not
  // publish an in-memory score or permanently poison the queue.
  const operation = writeQueue.then(async () => {
    const top20 = [...leaderboard, entry].sort((a, b) =>
      (b.faith - a.faith) || (a.rounds - b.rounds) || (a.durationSec - b.durationSec)).slice(0, 20);
    const temporary = `${leaderboardFile}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(top20, null, 2), { mode: 0o600 });
    await fs.rename(temporary, leaderboardFile);
    leaderboard = top20;
    res.json({ success: true, leaderboard: top20 });
  });
  writeQueue = operation.catch(next);
});

const colors = ["#c92a2a", "#2b8a3e", "#1864ab", "#e67700", "#5f3dc4", "#a61e4d", "#d9480f", "#495057"];
const rooms = new Map();
const emptyHints = () => ({ 0: [], 1: [], 2: [], 3: [] });
function publicRoom(room) {
  return { code: room.code, hostId: room.hostId, status: room.status, players: room.players,
    hints: room.hints, turnId: room.turnId };
}
function closeRoom(room, message) {
  // Mark memberships stale before emitting, so queued actions cannot revive it.
  rooms.delete(room.code);
  for (const player of room.players) {
    const member = io.sockets.sockets.get(player.socketId);
    if (member) { member.data.roomCode = null; member.leave(room.code); }
  }
  room.players.forEach(p => io.to(p.socketId).emit("roomClosed", message));
}
function memberRoom(socket, data, acting = false) {
  if (typeof data.roomCode !== "string" || !/^\d{4}$/.test(data.roomCode) || data.roomCode !== socket.data.roomCode) return null;
  const room = rooms.get(data.roomCode);
  if (!room || !room.players.some(p => p.socketId === socket.id)) return null;
  if (acting && (room.status !== "playing" || data.turnId !== room.turnId ||
    room.players[room.activeIndex].socketId !== socket.id)) return null;
  return room;
}
function newPlayer(socket, name, index) {
  return { socketId: socket.id, id: index, name, color: colors[index], position: 1,
    faith: 50, isFasting: false, hasReachedGoal: false };
}
io.use((socket, next) => {
  const ip = clientIP(socket.request);
  const sameIP = [...io.sockets.sockets.values()].filter(s => s.data.clientIP === ip).length;
  if (io.engine.clientsCount > MAX_CONNECTIONS || sameIP >= 40 || !consume(`connect:${ip}`, 60, 60000)) {
    return next(new Error("连接太频繁或服务器繁忙，请稍后再试"));
  }
  socket.data.clientIP = ip;
  next();
});

io.on("connection", socket => {
  const supportedEvents = new Set(["createRoom", "joinRoom", "startOnlineGame", "requestRoll",
    "sendOptionHint", "broadcastQuestionResult", "broadcastResolveStep", "finishTurnAction"]);
  socket.onAny(event => { if (!supportedEvents.has(event)) socket.disconnect(true); });
  function on(event, handler) {
    socket.on(event, data => {
      const ip = socket.data.clientIP;
      if (!consume(`event:${socket.id}`, 60, 10000) || !consume(`events:${ip}`, 1200, 10000)) {
        socket.disconnect(true);
        return;
      }
      if (!object(data)) return socket.emit("roomError", "消息格式不正确");
      try { handler(data); }
      catch (error) {
        console.error(`Socket event failed: ${event}`, error);
        socket.emit("roomError", "无法处理该操作，请重新进入房间");
      }
    });
  }

  on("createRoom", data => {
    const name = playerName(data.playerName, "彼得 (Peter)");
    if (!name) return socket.emit("roomError", "昵称须为 1–32 个字符，且不能含控制字符");
    if (socket.data.roomCode) return socket.emit("roomError", "你已经在一个房间中");
    if (!consume(`create:${socket.data.clientIP}`, 10, 60000) || rooms.size >= MAX_ROOMS) {
      return socket.emit("roomError", "创建太频繁或房间已满，请稍后再试");
    }
    // Bounded search: room-number exhaustion can never trap the event loop.
    const start = randomInt(9000);
    let code;
    for (let i = 0; i < 9000; i++) {
      const candidate = String(1000 + (start + i) % 9000);
      if (!rooms.has(candidate)) { code = candidate; break; }
    }
    if (!code) return socket.emit("roomError", "房间已满");
    const now = Date.now();
    const room = { code, hostId: socket.id, status: "waiting", hints: emptyHints(),
      players: [newPlayer(socket, name, 0)], createdAt: now, lastActivity: now,
      activeIndex: 0, firstFinished: false, turnId: null, turn: null };
    rooms.set(code, room);
    socket.data.roomCode = code;
    socket.join(code);
    socket.emit("roomJoined", publicRoom(room));
  });

  on("joinRoom", data => {
    if (socket.data.roomCode) return socket.emit("roomError", "你已经在一个房间中");
    const name = playerName(data.playerName, "天路客");
    if (!name || typeof data.roomCode !== "string" || !/^\d{4}$/.test(data.roomCode)) {
      return socket.emit("roomError", "昵称或房间号格式不正确");
    }
    if (!consume(`join:${socket.data.clientIP}`, 20, 60000)) return socket.emit("roomError", "加入太频繁，请稍后再试");
    const room = rooms.get(data.roomCode);
    if (!room) return socket.emit("roomError", "找不到该房间，请确认 4 位房间号是否正确！");
    if (room.status !== "waiting") return socket.emit("roomError", "游戏已经开始，无法中途加入！");
    if (room.players.length >= 8) return socket.emit("roomError", "房间人数已满（最多 8 人）！");
    room.players.push(newPlayer(socket, name, room.players.length));
    room.lastActivity = Date.now();
    socket.data.roomCode = room.code;
    socket.join(room.code);
    io.to(room.code).emit("roomJoined", publicRoom(room));
  });

  on("startOnlineGame", data => {
    const room = memberRoom(socket, data);
    if (!room || room.hostId !== socket.id || room.status !== "waiting") return;
    room.status = "playing";
    room.turnId = randomUUID();
    room.lastActivity = Date.now();
    io.to(room.code).emit("onlineGameStarted", publicRoom(room));
  });

  on("requestRoll", data => {
    const room = memberRoom(socket, data, true);
    if (!room || room.turn) return;
    room.turn = rules.beginTurn(room);
    room.hints = emptyHints();
    room.lastActivity = Date.now();
    io.to(room.code).emit("executeRoll", room.turn.roll);
  });

  on("sendOptionHint", data => {
    const room = memberRoom(socket, data);
    if (!room || room.status !== "playing" || data.turnId !== room.turnId ||
      room.turn?.phase !== "question" || room.players[room.activeIndex].socketId === socket.id ||
      !Number.isInteger(data.optionIdx) || data.optionIdx < 0 || data.optionIdx > 3) return;
    const player = room.players.find(p => p.socketId === socket.id);
    const selected = room.hints[data.optionIdx].some(h => h.socketId === socket.id);
    for (let i = 0; i < 4; i++) room.hints[i] = room.hints[i].filter(h => h.socketId !== socket.id);
    if (!selected) room.hints[data.optionIdx].push({ socketId: socket.id, color: player.color, name: player.name });
    io.to(room.code).emit("updateOptionHints", room.hints);
  });

  on("broadcastQuestionResult", data => {
    const room = memberRoom(socket, data, true);
    if (!room || room.turn?.phase !== "question") return;
    if (!rules.answerQuestion(room.turn, data.chosenIdx)) return;
    room.lastActivity = Date.now();
    io.to(room.code).emit("showQuestionResult", { chosenIdx: data.chosenIdx });
  });

  on("broadcastResolveStep", data => {
    const room = memberRoom(socket, data, true);
    if (!room || room.turn?.phase !== "resolve" || data.stepType !== room.turn.stepType) return;
    rules.resolveStep(room.turn);
    room.lastActivity = Date.now();
    io.to(room.code).emit("executeResolveStep", { stepType: data.stepType });
  });

  on("finishTurnAction", data => {
    const room = memberRoom(socket, data, true);
    if (!room || room.turn?.phase !== "finish") return;
    // Browser-supplied playersState/firstFinished are deliberately ignored.
    room.players = room.turn.players;
    room.firstFinished ||= room.players.some(p => p.hasReachedGoal);
    room.activeIndex = (room.activeIndex + 1) % room.players.length;
    const finished = room.activeIndex === 0 && room.firstFinished;
    if (finished) room.status = "finished";
    room.turn = null;
    room.turnId = randomUUID();
    room.lastActivity = Date.now();
    const logs = Array.isArray(data.logsToAdd) ? data.logsToAdd.filter(m => typeof m === "string" && m.length <= 300).slice(0, 12) : [];
    io.to(room.code).emit("syncNextTurn", { playersState: room.players, logsToAdd: logs,
      firstFinished: room.firstFinished, turnId: room.turnId });
  });

  socket.on("disconnect", () => {
    const room = rooms.get(socket.data.roomCode);
    buckets.delete(`event:${socket.id}`);
    if (!room) return;
    if (room.status !== "waiting") {
      closeRoom(room, "有玩家断开连接，本局已结束，请重新创建房间。");
      return;
    }
    room.players = room.players.filter(p => p.socketId !== socket.id);
    if (!room.players.length) { rooms.delete(room.code); return; }
    room.players.forEach((p, i) => { p.id = i; p.color = colors[i]; });
    if (room.hostId === socket.id) room.hostId = room.players[0].socketId;
    io.to(room.code).emit("roomJoined", publicRoom(room));
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) if (now >= bucket.until) buckets.delete(key);
  for (const room of rooms.values()) {
    if (now - room.lastActivity > ROOM_IDLE_MS || now - room.createdAt > ROOM_LIFETIME_MS) {
      closeRoom(room, "房间已超时关闭，请重新创建房间。");
    }
  }
}, 60000).unref();

app.use((req, res) => res.status(404).send("Not found"));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.type === "entity.too.large" ? 413 : error.type === "entity.parse.failed" ? 400 : 500;
  if (status === 500) console.error("Request failed", error);
  res.status(status).json({ error: status === 500 ? "服务器暂时无法处理请求" : "请求数据格式不正确或过大" });
});

async function start() {
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
  let raw;
  try { raw = await fs.readFile(leaderboardFile, "utf8"); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    // Import the original scores once, without exposing or modifying the source.
    try { raw = await fs.readFile(path.join(__dirname, "leaderboard.json"), "utf8"); }
    catch (legacyError) { if (legacyError.code !== "ENOENT") throw legacyError; }
  }
  if (raw) {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) throw new Error("Invalid leaderboard file");
    leaderboard = list.flatMap(item => {
      const entry = record(item);
      return entry ? [{ ...entry, date: typeof item.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date) ? item.date : "" }] : [];
    }).sort((a, b) => (b.faith - a.faith) || (a.rounds - b.rounds) || (a.durationSec - b.durationSec)).slice(0, 20);
  }
  server.listen(PORT, HOST, () => console.log(`游戏服务器已启动：http://${HOST}:${PORT}`));
}
start().catch(error => { console.error("启动失败", error); process.exitCode = 1; });
