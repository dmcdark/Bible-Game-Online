const PRESET_PLAYERS = [
  { name: "彼得 (Peter)", color: "#c92a2a" },
  { name: "保罗 (Paul)", color: "#2b8a3e" },
  { name: "约翰 (John)", color: "#1864ab" },
  { name: "摩西 (Moses)", color: "#e67700" },
  { name: "大卫 (David)", color: "#5f3dc4" },
  { name: "路得 (Ruth)", color: "#a61e4d" },
  { name: "以斯帖 (Esther)", color: "#d9480f" },
  { name: "约瑟 (Joseph)", color: "#495057" }
];

let boardConfig = null;
let questionsData = [];
let cardsData = [];

// 游戏模式：'solo' | 'local' | 'online'
let gameMode = "solo";
let players = [];
let activePlayerIndex = 0;
let currentRound = 1;
let isFirstPlayerFinished = false;
let isAnimating = false;
let isZoomedOut = false;

// 个人灵修模式计时器
let soloStartTime = 0;
let soloElapsedSec = 0;
let soloTimerInterval = null;

// 在线联机状态
let socket = null;
let onlineRoomCode = null;
let mySocketId = null;
let onlineTurnId = null;
let currentRollContext = null;
let turnActionLogs = [];

// Dynamic strings used inside HTML templates must never become markup.
function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function safeColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : "#495057";
}

function emitTurn(event, data = {}) {
  if (!socket?.connected || !onlineRoomCode || !onlineTurnId) return;
  socket.emit(event, { ...data, roomCode: onlineRoomCode, turnId: onlineTurnId });
}

// 1. 初始化加载
window.addEventListener("DOMContentLoaded", async () => {
  initSocketConnection();
  setupLobbyUI();
  bindEvents();
  initBoardPanAndZoom();

  try {
    const [bRes, qRes, cRes] = await Promise.all([
      fetch("board_config.json"),
      fetch("questions.json"),
      fetch("cards.json")
    ]);
    boardConfig = await bRes.json();
    questionsData = await qRes.json();
    cardsData = await cRes.json();
  } catch (err) {
    console.error("加载 JSON 失败:", err);
  }
});

// 获取当前客户端对应的联机玩家对象
function getMyPlayerObj() {
  return players.find(p => p.socketId === mySocketId);
}

// 判断当前客户端是否为本回合行动者
function isMyTurnToAct() {
  if (gameMode !== "online") return true;
  if (!onlineRoomCode) return false;
  const curP = players[activePlayerIndex];
  return curP && curP.socketId === mySocketId;
}

// 初始化 Socket.io
function initSocketConnection() {
  if (typeof io === "undefined") return;
  socket = io();

  socket.on("connect", () => {
    mySocketId = socket.id;
  });

  socket.on("roomError", (msg) => {
    const errEl = document.getElementById("online-error-msg");
    if (errEl) errEl.textContent = msg;
  });

  function handleEnterWaitingRoom(room) {
    onlineRoomCode = room.code;
    const errEl = document.getElementById("online-error-msg");
    if (errEl) errEl.textContent = "";
    document.getElementById("online-entry-box").style.display = "none";
    document.getElementById("online-waiting-room").style.display = "block";
    document.getElementById("display-room-code").textContent = room.code;

    const listEl = document.getElementById("waiting-players-list");
    listEl.innerHTML = "";
    room.players.forEach((p) => {
      const div = document.createElement("div");
      div.className = "leader-item";
      div.innerHTML = `
        <span><span class="roster-color-dot" style="background:${safeColor(p.color)}"></span><strong>${escapeHTML(p.name)}</strong> ${p.socketId === room.hostId ? "（房主）" : ""}</span>
        <span>${p.socketId === mySocketId ? "👉 你自己" : "已就绪"}</span>
      `;
      listEl.appendChild(div);
    });

    const isHost = room.hostId === mySocketId;
    document.getElementById("host-start-btn").style.display = isHost ? "inline-block" : "none";
    document.getElementById("guest-wait-tip").style.display = isHost ? "none" : "block";
  }

  socket.on("roomJoined", handleEnterWaitingRoom);
  socket.on("roomCreated", handleEnterWaitingRoom);
  socket.on("roomUpdated", handleEnterWaitingRoom);

  socket.on("onlineGameStarted", (room) => {
    gameMode = "online";
    onlineTurnId = room.turnId;
    players = room.players;
    activePlayerIndex = 0;
    currentRound = 1;
    document.getElementById("setup-modal").classList.remove("active");
    initBoard();
    updateUI();
    log(`【联机房间 ${room.code}】天路巡礼正式启程！共 ${players.length} 名同行者。`);
    setTimeout(() => focusOnTile(1, true), 150);
  });

  socket.on("executeRoll", (rollSeed) => {
    currentRollContext = rollSeed;
    const curP = players[activePlayerIndex];
    if (curP && curP.isFasting) {
      showFastingDialog(curP);
    } else {
      performRollAnimationAndMove(rollSeed.diceVal);
    }
  });

  // 【同频】接收场外队友点击选项的高亮提示 (+n)
  socket.on("updateOptionHints", (hintsMap) => {
    renderOptionHintsUI(hintsMap);
  });

  // 【同频】全员同步显示答题正误结果弹窗
  socket.on("showQuestionResult", ({ chosenIdx }) => {
    const curP = players[activePlayerIndex];
    if (curP) resolveQuestionAnswerLocally(curP, chosenIdx);
  });

  // 【同频】全员同步执行弹窗确认后的位移与同格团契检测
  socket.on("executeResolveStep", ({ stepType }) => {
    const curP = players[activePlayerIndex];
    if (curP) executeStepResolutionLocally(curP, stepType);
  });

  socket.on("syncNextTurn", ({ playersState, logsToAdd, firstFinished, turnId }) => {
    onlineTurnId = turnId;
    players = playersState;
    if (firstFinished && !isFirstPlayerFinished) {
      isFirstPlayerFinished = true;
    }
    logsToAdd.forEach(m => log(m));
    closeDialog();
    renderPieces();
    advanceTurnLocally();
  });

  socket.on("playerLeftNotice", (msg) => {
    log(`⚠️ ${msg}`);
  });

  socket.on("connect_error", () => {
    const errEl = document.getElementById("online-error-msg");
    if (errEl) errEl.textContent = "无法连接联机服务器，请稍后重试。";
  });

  let sessionEnded = false;
  function endOnlineSession(message) {
    if (sessionEnded) return;
    if (gameMode !== "online" && !onlineRoomCode) return;
    sessionEnded = true;
    onlineTurnId = null;
    onlineRoomCode = null;
    socket.disconnect();
    document.getElementById("roll-btn").disabled = true;
    showDialog("联机已结束", message, [{ label: "返回大厅", onClick: () => location.reload() }]);
  }
  socket.on("roomClosed", message => endOnlineSession(message));
  socket.on("disconnect", () => endOnlineSession("连接已断开，本局无法恢复，请返回大厅重新加入。"));
}

// 2. 开局大厅选项卡与设置
function setupLobbyUI() {
  document.querySelectorAll(".mode-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".mode-tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".mode-panel").forEach(p => p.classList.remove("active"));
      tab.classList.add("active");
      const mode = tab.dataset.mode;
      document.getElementById(`mode-panel-${mode}`)?.classList.add("active");
    });
  });

  const select = document.getElementById("player-count");
  const container = document.getElementById("player-names-container");
  if (!select || !container) return;

  function renderInputs(count) {
    container.innerHTML = "";
    for (let i = 0; i < count; i++) {
      const p = PRESET_PLAYERS[i];
      const div = document.createElement("div");
      div.className = "player-input-item";
      div.innerHTML = `
        <span class="roster-color-dot" style="background:${p.color}"></span>
        <input type="text" id="p-input-${i}" value="${p.name}">
      `;
      container.appendChild(div);
    }
  }
  select.addEventListener("change", (e) => renderInputs(parseInt(e.target.value)));
  renderInputs(2);
}

function bindEvents() {
  // A. 个人灵修模式
  document.getElementById("start-solo-btn")?.addEventListener("click", () => {
    gameMode = "solo";
    const name = document.getElementById("solo-player-name")?.value.trim() || PRESET_PLAYERS[0].name;
    players = [{
      id: 0,
      name,
      color: PRESET_PLAYERS[0].color,
      position: 1,
      faith: 50,
      isFasting: false,
      hasReachedGoal: false
    }];

    document.getElementById("setup-modal").classList.remove("active");
    startSoloTimer();
    initBoard();
    updateUI();
    log(`🧘 个人灵修启程！愿主引导 ${name} 的脚步，直奔新耶路撒冷。`);
    setTimeout(() => focusOnTile(1, true), 150);
  });

  // B. 本地同屏模式
  document.getElementById("start-local-btn")?.addEventListener("click", () => {
    gameMode = "local";
    const count = parseInt(document.getElementById("player-count").value);
    players = [];
    for (let i = 0; i < count; i++) {
      const name = document.getElementById(`p-input-${i}`)?.value.trim() || PRESET_PLAYERS[i].name;
      players.push({
        id: i,
        name,
        color: PRESET_PLAYERS[i].color,
        position: 1,
        faith: 50,
        isFasting: false,
        hasReachedGoal: false
      });
    }

    document.getElementById("setup-modal").classList.remove("active");
    initBoard();
    updateUI();
    log(`天路历程启程！共有 ${players.length} 名天路客出发。`);
    setTimeout(() => focusOnTile(1, true), 150);
  });

  // C. 在线联机按钮
  document.getElementById("create-room-btn")?.addEventListener("click", () => {
    const errEl = document.getElementById("online-error-msg");
    if (!socket || !socket.connected) {
      if (errEl) errEl.textContent = "未连接到联机服务器，请确保使用 node server.js 启动！";
      return;
    }
    if (errEl) errEl.textContent = "正在创建房间...";
    const playerName = document.getElementById("online-player-name")?.value.trim() || "彼得";
    socket.emit("createRoom", { playerName });
  });

  document.getElementById("join-room-btn")?.addEventListener("click", () => {
    const errEl = document.getElementById("online-error-msg");
    if (!socket || !socket.connected) {
      if (errEl) errEl.textContent = "未连接到联机服务器，请确保使用 node server.js 启动！";
      return;
    }
    const playerName = document.getElementById("online-player-name")?.value.trim() || "保罗";
    const roomCode = document.getElementById("room-code-input")?.value.trim() || "";
    if (roomCode.length !== 4) {
      if (errEl) errEl.textContent = "请输入 4 位数字房间号！";
      return;
    }
    socket.emit("joinRoom", { roomCode, playerName });
  });

  document.getElementById("host-start-btn")?.addEventListener("click", () => {
    if (socket && onlineRoomCode) {
      socket.emit("startOnlineGame", { roomCode: onlineRoomCode });
    }
  });

  document.getElementById("open-solo-rank-btn")?.addEventListener("click", () => showSoloLeaderboardModal(null));
  document.getElementById("ingame-rank-btn")?.addEventListener("click", () => showSoloLeaderboardModal(null));
  document.getElementById("close-rank-btn")?.addEventListener("click", () => {
    document.getElementById("leaderboard-modal").classList.remove("active");
  });

  document.getElementById("roll-btn")?.addEventListener("click", handleRollDice);
}

// 个人灵修计时器
function startSoloTimer() {
  const box = document.getElementById("solo-timer-box");
  const timerEl = document.getElementById("solo-timer");
  box.style.display = "block";
  soloStartTime = Date.now();
  soloTimerInterval = setInterval(() => {
    soloElapsedSec = Math.floor((Date.now() - soloStartTime) / 1000);
    timerEl.textContent = formatDuration(soloElapsedSec);
  }, 1000);
}

function stopSoloTimer() {
  if (soloTimerInterval) {
    clearInterval(soloTimerInterval);
    soloTimerInterval = null;
  }
  soloElapsedSec = Math.max(1, Math.floor((Date.now() - soloStartTime) / 1000));
}

function formatDuration(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  return `${m}:${s}`;
}

// 棋盘拖拽与鸟瞰缩放
function initBoardPanAndZoom() {
  const wrapper = document.getElementById("board-wrapper");
  const boardEl = document.getElementById("board");
  const zoomBtn = document.getElementById("toggle-zoom-btn");

  if (zoomBtn && boardEl) {
    zoomBtn.addEventListener("click", () => {
      isZoomedOut = !isZoomedOut;
      boardEl.classList.toggle("zoom-out", isZoomedOut);
      zoomBtn.classList.toggle("active", isZoomedOut);
      zoomBtn.textContent = isZoomedOut ? "🔍 局部" : "🔍 鸟瞰";

      if (!isZoomedOut && players.length > 0) {
        setTimeout(() => focusOnTile(players[activePlayerIndex].position, true), 260);
      }
    });
  }

  if (!wrapper) return;
  let isDown = false;
  let startX = 0, startY = 0;
  let scrollLeft = 0, scrollTop = 0;

  wrapper.addEventListener("mousedown", (e) => {
    if (isZoomedOut) return;
    isDown = true;
    wrapper.classList.add("dragging");
    startX = e.pageX - wrapper.offsetLeft;
    startY = e.pageY - wrapper.offsetTop;
    scrollLeft = wrapper.scrollLeft;
    scrollTop = wrapper.scrollTop;
  });

  window.addEventListener("mouseup", () => {
    if (!isDown) return;
    isDown = false;
    wrapper.classList.remove("dragging");
  });

  wrapper.addEventListener("mousemove", (e) => {
    if (!isDown) return;
    e.preventDefault();
    const x = e.pageX - wrapper.offsetLeft;
    const y = e.pageY - wrapper.offsetTop;
    wrapper.scrollLeft = scrollLeft - (x - startX) * 1.2;
    wrapper.scrollTop = scrollTop - (y - startY) * 1.2;
  });
}

function focusOnTile(tileNum, withPulse = false) {
  const wrapper = document.getElementById("board-wrapper");
  const tileEl = document.getElementById(`tile-${tileNum}`);
  if (!wrapper || !tileEl) return;

  if (!isZoomedOut) {
    const targetLeft = tileEl.offsetLeft - (wrapper.clientWidth / 2) + (tileEl.clientWidth / 2);
    const targetTop = tileEl.offsetTop - (wrapper.clientHeight / 2) + (tileEl.clientHeight / 2);

    wrapper.scrollTo({
      left: Math.max(0, targetLeft),
      top: Math.max(0, targetTop),
      behavior: "smooth"
    });
  }

  if (withPulse) {
    document.querySelectorAll(".tile.focus-pulse").forEach(el => el.classList.remove("focus-pulse"));
    tileEl.classList.add("focus-pulse");
    setTimeout(() => tileEl.classList.remove("focus-pulse"), 1400);
  }
}

// 3. 构建 70 格棋盘
function initBoard() {
  const boardEl = document.getElementById("board");
  boardEl.innerHTML = "";

  const gridMapping = [];
  for (let row = 6; row >= 0; row--) {
    const isEvenFromBottom = (6 - row) % 2 === 0;
    const rowTiles = [];
    const startTile = (6 - row) * 10 + 1;
    for (let c = 0; c < 10; c++) rowTiles.push(startTile + c);
    if (!isEvenFromBottom) rowTiles.reverse();
    gridMapping.push(...rowTiles);
  }

  gridMapping.forEach((tileNum) => {
    const tileDiv = document.createElement("div");
    tileDiv.className = "tile";
    tileDiv.id = `tile-${tileNum}`;

    const floorIndex = Math.floor((tileNum - 1) / 10);
    const isGoingRight = floorIndex % 2 === 0;

    let pathDirSymbol = "";
    let pathClass = "";

    if (tileNum === 70) {
      pathDirSymbol = "★";
      pathClass = "tile-goal-mark";
    } else if (tileNum % 10 === 0) {
      pathDirSymbol = "↓";
      pathClass = "tile-turn";
    } else {
      pathDirSymbol = isGoingRight ? "→" : "←";
      pathClass = "tile-arrow";
    }

    let label = "";
    if (tileNum === 1) {
      tileDiv.classList.add("tile-start");
      label = "起点";
    } else if (tileNum === 70) {
      tileDiv.classList.add("tile-goal");
      label = "新耶路撒冷";
    } else if (boardConfig.ladders.some(l => l.from === tileNum)) {
      tileDiv.classList.add("tile-ladder");
      const lad = boardConfig.ladders.find(l => l.from === tileNum);
      label = `十字架 ➔ ${lad.to}`;
    } else if (boardConfig.snakes.some(s => s.from === tileNum)) {
      tileDiv.classList.add("tile-snake");
      const snk = boardConfig.snakes.find(s => s.from === tileNum);
      label = `蛇陷阱 ➔ ${snk.to}`;
    } else if (boardConfig.sabbathTiles.includes(tileNum)) {
      tileDiv.classList.add("tile-sabbath");
      label = "安息日";
    } else if (boardConfig.eventTiles.includes(tileNum)) {
      tileDiv.classList.add("tile-event");
      label = "卡牌格";
    } else {
      label = "答题格";
    }

    tileDiv.innerHTML = `
      <div class="tile-top-bar">
        <span class="tile-num">${tileNum}</span>
        <span class="path-guide ${pathClass}">${pathDirSymbol}</span>
      </div>
      <div class="tile-label">${label}</div>
      <div class="pieces-container" id="pieces-${tileNum}"></div>
    `;
    boardEl.appendChild(tileDiv);
  });

  renderPieces();
}

function renderPieces() {
  document.querySelectorAll(".pieces-container").forEach(c => c.innerHTML = "");
  players.forEach(p => {
    const container = document.getElementById(`pieces-${p.position}`);
    if (container) {
      const piece = document.createElement("div");
      piece.className = "player-piece";
      piece.id = `piece-player-${p.id}`;
      piece.style.backgroundColor = p.color;
      piece.title = `${p.name} (信心: ${p.faith})`;
      container.appendChild(piece);
    }
  });
}

// 5. 掷骰子触发
function handleRollDice() {
  if (isAnimating || !isMyTurnToAct()) return;
  const curP = players[activePlayerIndex];
  turnActionLogs = [];

  focusOnTile(curP.position);

  isAnimating = true;
  document.getElementById("roll-btn").disabled = true;

  if (gameMode === "online") {
    emitTurn("requestRoll");
  } else {
    const diceVal = Math.floor(Math.random() * 6) + 1;
    currentRollContext = {
      diceVal,
      qIdx: Math.floor(Math.random() * questionsData.length),
      cIdx: Math.floor(Math.random() * cardsData.length),
      isBlessing: Math.random() > 0.5
    };
    if (curP.isFasting) {
      showFastingDialog(curP);
    } else {
      performRollAnimationAndMove(diceVal);
    }
  }
}

// 全员同频展示禁食祷告弹窗
function showFastingDialog(curP) {
  const canClick = isMyTurnToAct();
  showDialog(
    "禁食祷告",
    `${curP.name} 正在禁食祷告中（本轮跳过投骰子）。\n灵里重得力量，信心值恢复至 10 点！`,
    [{
      label: canClick ? "阿们，平安领受" : `等待 ${curP.name} 确认...`,
      disabled: !canClick,
      onClick: () => {
        curP.faith = 10;
        curP.isFasting = false;
        turnActionLogs.push(`${curP.name} 完成禁食祷告，信心值恢复至 10 点。`);
        closeDialog();
        completeTurnAndSync();
      }
    }]
  );
}

function performRollAnimationAndMove(diceVal) {
  const curP = players[activePlayerIndex];
  isAnimating = true;
  document.getElementById("roll-btn").disabled = true;

  const diceEl = document.getElementById("dice");
  diceEl.className = "dice rolling";

  setTimeout(() => {
    if (gameMode === "online" && !onlineRoomCode) return;
    diceEl.className = `dice show-${diceVal}`;
    document.getElementById("roll-status").textContent = `${curP.name} 掷出了 ${diceVal} 点！`;
    log(`${curP.name} 投掷出 ${diceVal} 点。`);
    movePlayerStepByStep(curP, diceVal);
  }, 1200);
}

// 6. 逐格跳动
async function movePlayerStepByStep(player, steps) {
  for (let i = 0; i < steps; i++) {
    if (gameMode === "online" && !onlineRoomCode) return;
    if (player.position >= 70) break;
    player.position += 1;
    renderPieces();
    focusOnTile(player.position);

    const pieceEl = document.getElementById(`piece-player-${player.id}`);
    if (pieceEl) {
      pieceEl.classList.add("jumping");
      await new Promise(r => setTimeout(r, 260));
      pieceEl.classList.remove("jumping");
    }
    await new Promise(r => setTimeout(r, 60));
  }

  if (gameMode === "online" && !onlineRoomCode) return;
  if (player.position >= 70) {
    player.position = 70;
    player.hasReachedGoal = true;
    if (!isFirstPlayerFinished) {
      isFirstPlayerFinished = true;
      if (gameMode !== "solo") {
        log(`【宣告】${player.name} 率先抵达新耶路撒冷！本轮（第 ${currentRound} 轮）结束后将正式结算。`);
      }
    }
  }

  renderPieces();
  focusOnTile(player.position, true);
  updateUI();

  handleTileEvent(player);
}

// 触发步骤确认（联机模式下通知全员同频执行，单机下直接执行）
function triggerStepResolution(player, stepType) {
  if (gameMode === "online" && socket) {
    emitTurn("broadcastResolveStep", { stepType });
  } else {
    executeStepResolutionLocally(player, stepType);
  }
}

// 全员同步执行弹窗确认后的效果（飞升、滑落、卡牌、安息日、进入同格团契检测）
function executeStepResolutionLocally(player, stepType) {
  closeDialog();
  const pos = player.position;

  if (stepType === "ladder") {
    const ladder = boardConfig.ladders.find(l => l.from === pos);
    if (ladder) {
      player.position = ladder.to;
      if (isMyTurnToAct()) {
        turnActionLogs.push(`${player.name} 踏上十字架【${ladder.label}】，跃升至第 ${ladder.to} 格！`);
      }
      renderPieces();
      focusOnTile(player.position, true);
      updateUI();
    }
  } else if (stepType === "snake") {
    const snake = boardConfig.snakes.find(s => s.from === pos);
    if (snake) {
      player.position = snake.to;
      if (isMyTurnToAct()) {
        turnActionLogs.push(`${player.name} 误入陷阱【${snake.label}】，滑落至第 ${snake.to} 格。`);
      }
      renderPieces();
      focusOnTile(player.position, true);
      updateUI();
    }
  } else if (stepType === "card") {
    const card = cardsData[currentRollContext.cIdx % cardsData.length];
    player.faith += card.faithChange;
    applyStepOffset(player, card.stepChange);
    checkFaithStatus(player);
    if (isMyTurnToAct()) {
      turnActionLogs.push(`${player.name} 抽中卡牌【${card.title}】(信心 ${card.faithChange >= 0 ? "+" : ""}${card.faithChange})。`);
    }
    updateUI();
  }

  // 进入同格互动检测（所有玩家屏幕同步弹窗！）
  handleSameTileCheck(player, () => {
    if (isMyTurnToAct()) {
      completeTurnAndSync();
    }
  });
}

// 7. 落点事件分流（所有窗口都会弹出对应的事件窗口！）
function handleTileEvent(player) {
  const pos = player.position;
  const canClick = isMyTurnToAct();

  if (pos === 70) {
    handleSameTileCheck(player, () => {
      if (canClick) completeTurnAndSync();
    });
    return;
  }

  // A. 十字架飞升
  const ladder = boardConfig.ladders.find(l => l.from === pos);
  if (ladder) {
    showDialog("恩典阶梯", `${player.name} 踏上十字架恩典路径：【${ladder.label}】！\n飞升跃进至第 ${ladder.to} 格！`, [{
      label: canClick ? "领受恩典" : `等待 ${player.name} 确认...`,
      disabled: !canClick,
      onClick: () => triggerStepResolution(player, "ladder")
    }]);
    return;
  }

  // B. 蛇咬滑落
  const snake = boardConfig.snakes.find(s => s.from === pos);
  if (snake) {
    showDialog("旷野陷阱", `${player.name} 踩中蛇陷阱：【${snake.label}】！\n滑落倒退回第 ${snake.to} 格！`, [{
      label: canClick ? "警醒自省" : `等待 ${player.name} 确认...`,
      disabled: !canClick,
      onClick: () => triggerStepResolution(player, "snake")
    }]);
    return;
  }

  // C. 安息格
  if (boardConfig.sabbathTiles.includes(pos)) {
    showDialog("安息日避风港", `${player.name} 停留在安息圣洁之所，默想神的看顾。平安无事。`, [{
      label: canClick ? "领受安息" : `等待 ${player.name} 确认...`,
      disabled: !canClick,
      onClick: () => triggerStepResolution(player, "sabbath")
    }]);
    return;
  }

  // D. 卡牌格
  if (boardConfig.eventTiles.includes(pos)) {
    const card = cardsData[currentRollContext.cIdx % cardsData.length];
    const isGrace = card.type === "grace";
    showDialog(
      isGrace ? "恩典卡牌" : "试炼卡牌",
      `【${card.title}】(${player.name})\n${card.description}\n\n信心变动: ${card.faithChange >= 0 ? "+" : ""}${card.faithChange}，位移: ${card.stepChange}`,
      [{
        label: canClick ? "顺服" : `等待 ${player.name} 确认...`,
        disabled: !canClick,
        onClick: () => triggerStepResolution(player, "card")
      }]
    );
    return;
  }

  // E. 圣经问答格
  triggerScriptureQuestion(player);
}

// 8. 圣经问答弹窗（支持场外队友点击选项高亮提示 +n）
function triggerScriptureQuestion(player) {
  const q = questionsData[currentRollContext.qIdx % questionsData.length];
  const isTurnOwner = isMyTurnToAct();

  const content = document.createElement("div");
  content.innerHTML = `<p style="font-weight:bold;margin-bottom:12px;">${escapeHTML(q.question)}</p>`;

  const optContainer = document.createElement("div");
  optContainer.className = "options-list";

  q.options.forEach((optText, idx) => {
    const btn = document.createElement("button");
    btn.className = "option-btn";
    btn.id = `q-opt-btn-${idx}`;

    // 选项文本 + 右侧圆圈 +n 徽章
    btn.innerHTML = `
      <span class="option-text">${["A", "B", "C", "D"][idx]}. ${escapeHTML(optText)}</span>
      <span class="option-hint-badge" id="q-opt-badge-${idx}"></span>
    `;

    btn.onclick = () => {
      if (isTurnOwner) {
        // 当前回合玩家点击：正式提交答案（联机下通知全员同步弹出对错窗口）
        if (gameMode === "online" && socket) {
          emitTurn("broadcastQuestionResult", { chosenIdx: idx });
        } else {
          resolveQuestionAnswerLocally(player, idx);
        }
      } else if (gameMode === "online" && socket) {
        // 场外其他玩家点击：发送自己颜色的高亮提示 (+n)
        const me = getMyPlayerObj();
        if (me) {
          emitTurn("sendOptionHint", { optionIdx: idx });
        }
      }
    };
    optContainer.appendChild(btn);
  });

  content.appendChild(optContainer);

  const tip = document.createElement("p");
  tip.className = "subtitle";
  tip.style.marginTop = "6px";
  tip.textContent = isTurnOwner
    ? (gameMode === "online" ? "💡 提示：场外同伴可点击选项为你提供颜色高亮参考" : "请选择正确答案")
    : `💡 正在等待 ${player.name} 作答（你可以点击上方选项用你的颜色为TA提供提示！）`;
  content.appendChild(tip);

  const modal = document.getElementById("dialog-modal");
  document.getElementById("dialog-badge").textContent = "圣经问答";
  document.getElementById("dialog-title").textContent = `轮到 ${player.name} 作答`;
  document.getElementById("dialog-content").innerHTML = "";
  document.getElementById("dialog-content").appendChild(content);
  document.getElementById("dialog-actions").innerHTML = "";
  modal.classList.add("active");
}

// 渲染场外队友的选项高亮边框与圆圈 +n 徽章
function renderOptionHintsUI(hintsMap) {
  for (let i = 0; i < 4; i++) {
    const btn = document.getElementById(`q-opt-btn-${i}`);
    const badge = document.getElementById(`q-opt-badge-${i}`);
    if (!btn || !badge) continue;

    const list = (hintsMap && hintsMap[i]) ? hintsMap[i] : [];
    if (list.length > 0) {
      const firstColor = list[0].color; // 第一个点击该选项的玩家颜色
      const names = list.map(h => h.name).join("、");
      btn.style.borderColor = firstColor;
      btn.style.boxShadow = `0 0 0 2px ${firstColor}`;
      btn.title = `提示者：${names}`;

      badge.style.display = "inline-flex";
      badge.style.backgroundColor = firstColor;
      badge.textContent = `+${list.length}`;
    } else {
      btn.style.borderColor = "";
      btn.style.boxShadow = "";
      btn.title = "";
      badge.style.display = "none";
      badge.textContent = "";
    }
  }
}

// 全员同步展示答题结果弹窗（答对了 / 回答错误）
function resolveQuestionAnswerLocally(player, chosenIdx) {
  closeDialog();
  const q = questionsData[currentRollContext.qIdx % questionsData.length];
  const canClick = isMyTurnToAct();

  if (chosenIdx === q.answerIndex) {
    player.faith += 5;
    if (canClick) {
      turnActionLogs.push(`${player.name} 回答正确！(+5 信心) [${q.reference}]`);
    }
    updateUI();
    showDialog("答对了！", `${player.name} 回答正确！信心坚定，信心值 +5。\n经文出处: ${q.reference}`, [{
      label: canClick ? "继续前行" : `等待 ${player.name} 继续...`,
      disabled: !canClick,
      onClick: () => triggerStepResolution(player, "afterQuestion")
    }]);
  } else {
    player.faith -= 15;
    if (canClick) {
      turnActionLogs.push(`${player.name} 回答错误。(-15 信心，后退 1 格) [${q.reference}]`);
    }
    applyStepOffset(player, -1);
    checkFaithStatus(player);
    updateUI();
    showDialog("回答错误", `${player.name} 答错了！信心值 -15，后退 1 格。\n正确答案为：${q.options[q.answerIndex]}\n经文出处: ${q.reference}`, [{
      label: canClick ? "记在心上" : `等待 ${player.name} 继续...`,
      disabled: !canClick,
      onClick: () => triggerStepResolution(player, "afterQuestion")
    }]);
  }
}

// 9. 同格互动判定（全员屏幕同频显示！）
function handleSameTileCheck(player, callback) {
  const othersInTile = players.filter(p => p.id !== player.id && p.position === player.position && p.position < 70);
  const canClick = isMyTurnToAct();

  if (othersInTile.length > 0) {
    const otherNames = othersInTile.map(p => p.name).join("、");
    const isBlessing = currentRollContext ? currentRollContext.isBlessing : Math.random() > 0.5;

    if (isBlessing) {
      othersInTile.forEach(p => p.faith += 8);
      player.faith += 8;
      if (canClick) {
        turnActionLogs.push(`同格团契：${player.name} 与 ${otherNames} 彼此祝福，信心均 +8！`);
      }
      showDialog(
        "同路团契：彼此祝福",
        `${player.name} 在此与同行者（${otherNames}）相遇，同心合意！\n同格所有玩家信心值均 +8 点！`,
        [{
          label: canClick ? "感谢主" : `等待 ${player.name} 确认...`,
          disabled: !canClick,
          onClick: () => { closeDialog(); callback(); }
        }]
      );
    } else {
      othersInTile.forEach(p => {
        p.faith -= 10;
        applyStepOffset(p, -1);
        checkFaithStatus(p);
      });
      if (canClick) {
        turnActionLogs.push(`同路磨砺：${otherNames} 信心 -10 并后退 1 格。`);
      }
      showDialog(
        "同路磨砺：互相激励",
        `狭路相逢，步伐产生磨擦。\n除 ${player.name} 外，同格其他玩家（${otherNames}）信心值 -10 点并后退 1 格！`,
        [{
          label: canClick ? "引以为戒" : `等待 ${player.name} 确认...`,
          disabled: !canClick,
          onClick: () => { closeDialog(); callback(); }
        }]
      );
    }
    renderPieces();
    updateUI();
  } else {
    callback();
  }
}

function applyStepOffset(player, offset) {
  if (offset === 0) return;
  player.position += offset;
  if (player.position < 1) player.position = 1;
  if (player.position > 70) player.position = 70;
  renderPieces();
  focusOnTile(player.position, true);
}

function checkFaithStatus(player) {
  if (player.faith <= 0) {
    player.faith = 0;
    player.isFasting = true;
    if (isMyTurnToAct()) {
      turnActionLogs.push(`【提醒】${player.name} 信心耗尽，下一轮将进入「禁食祷告」！`);
    }
  }
}

// 10. 回合完成同步与切换
function completeTurnAndSync() {
  if (gameMode === "online" && socket) {
    emitTurn("finishTurnAction", { logsToAdd: turnActionLogs });
  } else {
    turnActionLogs.forEach(m => log(m));
    advanceTurnLocally();
  }
}

function advanceTurnLocally() {
  isAnimating = false;
  activePlayerIndex++;

  if (activePlayerIndex >= players.length) {
    activePlayerIndex = 0;

    if (isFirstPlayerFinished) {
      finishGameAndShowLeaderboard();
      return;
    }

    currentRound++;
    log(`--- 第 ${currentRound} 轮开始 ---`);
  }

  updateUI();

  if (players.length > 0) {
    focusOnTile(players[activePlayerIndex].position, true);
  }
}

// 11. 终局结算 & 个人灵修排行榜存取
async function finishGameAndShowLeaderboard() {
  document.getElementById("roll-btn").disabled = true;

  if (gameMode === "solo") {
    stopSoloTimer();
    const p = players[0];
    const record = {
      name: p.name,
      faith: p.faith,
      rounds: currentRound,
      durationSec: soloElapsedSec,
      date: new Date().toISOString().split("T")[0]
    };
    await saveSoloRecord(record);
    await showSoloLeaderboardModal(record);
    return;
  }

  const sorted = [...players].sort((a, b) => b.faith - a.faith);
  document.getElementById("leaderboard-title").textContent = "天路历程已至终点";
  document.getElementById("leaderboard-subtitle").textContent = "当轮天路客已全部行毕，最终信心排行榜：";
  document.getElementById("close-rank-btn").style.display = "none";

  const container = document.getElementById("leaderboard-list");
  container.innerHTML = "";

  sorted.forEach((p, rank) => {
    const item = document.createElement("div");
    item.className = "leader-item";
    item.innerHTML = `
      <span>第 ${rank + 1} 名：<strong style="color:${safeColor(p.color)}">${escapeHTML(p.name)}</strong> ${p.position >= 70 ? "（抵达成圣之城）" : `（驻足第${escapeHTML(p.position)}格）`}</span>
      <span>最终信心分：<strong>${escapeHTML(p.faith)}</strong> 点</span>
    `;
    container.appendChild(item);
  });

  document.getElementById("leaderboard-modal").classList.add("active");
}

async function saveSoloRecord(record) {
  const localList = JSON.parse(localStorage.getItem("pilgrim_solo_rank") || "[]");
  localList.push(record);
  localList.sort((a, b) => (b.faith - a.faith) || (a.rounds - b.rounds) || (a.durationSec - b.durationSec));
  localStorage.setItem("pilgrim_solo_rank", JSON.stringify(localList.slice(0, 20)));

  try {
    await fetch("/api/leaderboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record)
    });
  } catch (e) {}
}

async function showSoloLeaderboardModal(latestRecord = null) {
  let list = [];
  try {
    const res = await fetch("/api/leaderboard");
    if (res.ok) list = await res.json();
  } catch (e) {}

  if (!list || list.length === 0) {
    list = JSON.parse(localStorage.getItem("pilgrim_solo_rank") || "[]");
  }

  document.getElementById("leaderboard-title").textContent = "🏆 个人灵修荣耀榜";
  document.getElementById("leaderboard-subtitle").textContent = latestRecord
    ? `🎉 恭喜通关！本局成绩：信心 ${latestRecord.faith} 点 | ${latestRecord.rounds} 轮 | 用时 ${formatDuration(latestRecord.durationSec)}`
    : "按【最终信心值 ➔ 通关轮次 ➔ 通关用时】综合排名：";

  document.getElementById("close-rank-btn").style.display = latestRecord ? "none" : "inline-block";

  const container = document.getElementById("leaderboard-list");
  container.innerHTML = "";

  if (list.length === 0) {
    container.innerHTML = `<p class="subtitle" style="padding:16px;">暂无通关记录，快开启第一场个人灵修吧！</p>`;
  } else {
    list.forEach((r, idx) => {
      const item = document.createElement("div");
      item.className = "leader-item";
      const medal = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `第 ${idx + 1} 名`;
      item.innerHTML = `
        <span><strong>${medal} · ${escapeHTML(r.name)}</strong> <small style="color:#7a6351">(${escapeHTML(r.date || "今日")})</small></span>
        <span>信心: <strong>${escapeHTML(r.faith)}</strong> | <strong>${escapeHTML(r.rounds)}</strong> 轮 | ⏱️ ${escapeHTML(formatDuration(r.durationSec || 0))}</span>
      `;
      container.appendChild(item);
    });
  }

  document.getElementById("leaderboard-modal").classList.add("active");
}

// 通用 UI 更新
function updateUI() {
  document.getElementById("current-round").textContent = currentRound;
  if (players.length > 0) {
    const curP = players[activePlayerIndex];
    const nameEl = document.getElementById("active-player-name");
    nameEl.textContent = curP.name;
    nameEl.style.color = curP.color;

    const canRoll = !isAnimating && isMyTurnToAct();
    document.getElementById("roll-btn").disabled = !canRoll;
    if (gameMode === "online") {
      document.getElementById("roll-status").textContent = isMyTurnToAct()
        ? "轮到你了，请投掷骰子！"
        : `等待 ${curP.name} 投掷骰子...`;
    }
  }

  const roster = document.getElementById("player-roster");
  roster.innerHTML = "";
  players.forEach((p, idx) => {
    const card = document.createElement("div");
    card.className = `roster-card ${idx === activePlayerIndex ? "active-turn" : ""}`;
    card.title = "点击定位该玩家棋子位置";
    card.innerHTML = `
      <div>
        <span class="roster-color-dot" style="background:${safeColor(p.color)}"></span>
        <strong>${escapeHTML(p.name)}</strong>
      </div>
      <div>
        格: ${escapeHTML(p.position)}/70 | 信心: <strong>${escapeHTML(p.faith)}</strong>
        ${p.isFasting ? '<span class="status-fasting">[禁食中]</span>' : ""}
      </div>
    `;
    card.addEventListener("click", () => focusOnTile(p.position, true));
    roster.appendChild(card);
  });
}

function showDialog(title, text, actions = []) {
  const modal = document.getElementById("dialog-modal");
  document.getElementById("dialog-badge").textContent = "天路事件";
  document.getElementById("dialog-title").textContent = title;
  document.getElementById("dialog-content").innerText = text;

  const actionsContainer = document.getElementById("dialog-actions");
  actionsContainer.innerHTML = "";
  actions.forEach(act => {
    const btn = document.createElement("button");
    btn.className = "btn-primary";
    btn.textContent = act.label;
    btn.disabled = !!act.disabled;
    btn.onclick = act.onClick;
    actionsContainer.appendChild(btn);
  });

  modal.classList.add("active");
}

function closeDialog() {
  document.getElementById("dialog-modal").classList.remove("active");
}

function log(msg) {
  const logsEl = document.getElementById("game-logs");
  const p = document.createElement("div");
  p.textContent = `• ${msg}`;
  logsEl.appendChild(p);
  logsEl.scrollTop = logsEl.scrollHeight;
}
