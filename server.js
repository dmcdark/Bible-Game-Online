const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 托管整个 Game 根目录
app.use(express.static(__dirname));
app.use(express.json());

// ==================== 1. 个人灵修模式：全服排行榜接口 ====================
const LEADERBOARD_FILE = path.join(__dirname, "leaderboard.json");

function getLeaderboard() {
  if (!fs.existsSync(LEADERBOARD_FILE)) {
    fs.writeFileSync(LEADERBOARD_FILE, "[]", "utf-8");
    return [];
  }
  try {
    const content = fs.readFileSync(LEADERBOARD_FILE, "utf-8").trim();
    return content ? JSON.parse(content) : [];
  } catch (e) {
    return [];
  }
}

app.get("/api/leaderboard", (req, res) => {
  res.json(getLeaderboard());
});

app.post("/api/leaderboard", (req, res) => {
  const { name, faith, rounds, durationSec } = req.body;
  if (!name || typeof faith !== "number") {
    return res.status(400).json({ error: "成绩数据不完整" });
  }

  const list = getLeaderboard();
  list.push({
    name: String(name).slice(0, 18),
    faith: Number(faith),
    rounds: Number(rounds),
    durationSec: Number(durationSec),
    date: new Date().toISOString().split("T")[0]
  });

  list.sort((a, b) => {
    if (b.faith !== a.faith) return b.faith - a.faith;
    if (a.rounds !== b.rounds) return a.rounds - b.rounds;
    return a.durationSec - b.durationSec;
  });

  const top20 = list.slice(0, 20);
  fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(top20, null, 2), "utf-8");
  res.json({ success: true, leaderboard: top20 });
});

// ==================== 2. 在线联机模式：Socket.io 房间与实时同频 ====================
const PRESET_COLORS = [
  "#c92a2a", "#2b8a3e", "#1864ab", "#e67700",
  "#5f3dc4", "#a61e4d", "#d9480f", "#495057"
];

const rooms = {};

io.on("connection", (socket) => {
  // 创建房间
  socket.on("createRoom", ({ playerName }) => {
    let roomCode;
    do {
      roomCode = Math.floor(1000 + Math.random() * 9000).toString();
    } while (rooms[roomCode]);

    rooms[roomCode] = {
      code: roomCode,
      hostId: socket.id,
      status: "waiting",
      hints: { 0: [], 1: [], 2: [], 3: [] }, // 记录每个选项被哪些场外玩家高亮
      players: [{
        socketId: socket.id,
        id: 0,
        name: playerName || "彼得 (Peter)",
        color: PRESET_COLORS[0],
        position: 1,
        faith: 50,
        isFasting: false,
        hasReachedGoal: false
      }]
    };
    socket.join(roomCode);
    socket.emit("roomJoined", rooms[roomCode]);
  });

  // 加入房间
  socket.on("joinRoom", ({ roomCode, playerName }) => {
    const code = String(roomCode).trim();
    const room = rooms[code];
    if (!room) return socket.emit("roomError", "找不到该房间，请确认 4 位房间号是否正确！");
    if (room.status !== "waiting") return socket.emit("roomError", "该房间的天路巡礼已经启程，无法中途加入！");
    if (room.players.length >= 8) return socket.emit("roomError", "房间人数已满（最多 8 人）！");

    const idx = room.players.length;
    room.players.push({
      socketId: socket.id,
      id: idx,
      name: playerName || `天路客 ${idx + 1}`,
      color: PRESET_COLORS[idx % PRESET_COLORS.length],
      position: 1,
      faith: 50,
      isFasting: false,
      hasReachedGoal: false
    });

    socket.join(code);
    io.to(code).emit("roomJoined", room);
  });

  // 房主开始游戏
  socket.on("startOnlineGame", ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room || room.hostId !== socket.id) return;
    room.status = "playing";
    io.to(roomCode).emit("onlineGameStarted", room);
  });

  // 请求掷骰子
  socket.on("requestRoll", ({ roomCode, qLen, cLen }) => {
    const room = rooms[roomCode];
    if (!room) return;
    // 清空上一题的场外提示记录
    room.hints = { 0: [], 1: [], 2: [], 3: [] };

    const diceVal = Math.floor(Math.random() * 6) + 1;
    const qIdx = Math.floor(Math.random() * (qLen || 999));
    const cIdx = Math.floor(Math.random() * (cLen || 36));
    const isBlessing = Math.random() > 0.5;

    io.to(roomCode).emit("executeRoll", {
      diceVal,
      qIdx,
      cIdx,
      isBlessing
    });
  });

  // 【新增】场外玩家点击选项给出高亮提示 (+n)
  socket.on("sendOptionHint", ({ roomCode, optionIdx, playerColor, playerName }) => {
    const room = rooms[roomCode];
    if (!room || !room.hints) return;

    // 先将该玩家之前在其他选项上的提示移除（每人每题同时只高亮一个选项，再点同一选项可取消）
    let alreadySelectedThis = false;
    for (let i = 0; i < 4; i++) {
      const idx = room.hints[i].findIndex(h => h.socketId === socket.id);
      if (idx !== -1) {
        if (i === optionIdx) alreadySelectedThis = true;
        room.hints[i].splice(idx, 1);
      }
    }

    // 如果不是取消选择，则按先后顺序推入该选项队列（第一个人的颜色将成为边框色！）
    if (!alreadySelectedThis && room.hints[optionIdx]) {
      room.hints[optionIdx].push({
        socketId: socket.id,
        color: playerColor,
        name: playerName
      });
    }

    io.to(roomCode).emit("updateOptionHints", room.hints);
  });

  // 【新增】当前行动玩家回答问题后，向全员同步展示“答对了/回答错误”弹窗
  socket.on("broadcastQuestionResult", ({ roomCode, chosenIdx }) => {
    const room = rooms[roomCode];
    if (!room) return;
    io.to(roomCode).emit("showQuestionResult", { chosenIdx });
  });

  // 【新增】当当前玩家在事件弹窗点击确认、触发后续位移动作或同格团契时，全员同步画面
  socket.on("broadcastResolveStep", ({ roomCode, stepType }) => {
    const room = rooms[roomCode];
    if (!room) return;
    io.to(roomCode).emit("executeResolveStep", { stepType });
  });

  // 推进下一回合
  socket.on("finishTurnAction", ({ roomCode, playersState, logsToAdd, firstFinished }) => {
    const room = rooms[roomCode];
    if (!room) return;
    room.players = playersState;
    io.to(roomCode).emit("syncNextTurn", {
      playersState,
      logsToAdd: logsToAdd || [],
      firstFinished
    });
  });

  // 断开连接清理
  socket.on("disconnect", () => {
    for (const code in rooms) {
      const room = rooms[code];
      const idx = room.players.findIndex(p => p.socketId === socket.id);
      if (idx !== -1) {
        const leftPlayer = room.players[idx];
        if (room.status === "waiting") {
          room.players.splice(idx, 1);
          room.players.forEach((p, i) => {
            p.id = i;
            p.color = PRESET_COLORS[i % PRESET_COLORS.length];
          });
          if (room.players.length === 0) {
            delete rooms[code];
          } else {
            if (room.hostId === socket.id) room.hostId = room.players[0].socketId;
            io.to(code).emit("roomJoined", room);
          }
        } else {
          io.to(code).emit("playerLeftNotice", `${leftPlayer.name} 掉线离开了房间。`);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("==========================================");
  console.log(`🎉 圣经桌游服务器已启动！`);
  console.log(`👉 游戏总大厅: http://localhost:${PORT}`);
  console.log(`👉 天路历程直达: http://localhost:${PORT}/pilgrim-progress/`);
  console.log("==========================================");
});