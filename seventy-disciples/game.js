// seventy-disciples/game.js

// 运行时状态
let gameState = {
  phase: 1, // 1: 主复活前七十人差派; 2: 圣灵降临后使徒宣教
  turn: 1,
  resources: {
    converts: 0,
    faith: 100,
    truth: 20,
    goods: 50
  },
  playerPos: "capernaum",
  ap: 3,
  maxAp: 3,
  player: null,
  companion: null,
  hiredCoworkers: [], // 已招募同工列表
  stationedCoworkers: {}, // 各城驻守同工 { "ephesus": coworkerObj }
  completedChallenges: [], // 已攻克城邦议题
  churches: {}, // 已建立教会
  researchedTechs: []
};

let mapTransform = {
  scale: 1,
  panX: -350,
  panY: -200,
  isDragging: false,
  startX: 0,
  startY: 0
};

let selectedTemplateId = null;

// 判断主角或搭档是否拥有某模板
function hasPerkRole(templateId) {
  return (gameState.player && gameState.player.id === templateId) || 
         (gameState.companion && gameState.companion.id === templateId);
}

// 初始化入口
window.addEventListener("DOMContentLoaded", () => {
  renderTemplateSelection();
  bindUIEvents();
  initMapPanAndZoom();
});

// 集中式事件绑定总线
function bindUIEvents() {
  const bind = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.onclick = fn;
  };

  bind("btn-confirm-start", startGame);
  bind("next-turn-btn", handleNextTurn);

  // 顶部面板
  bind("open-tech-btn", openTechModal);
  bind("open-coworkers-btn", openCoworkersModal);
  bind("open-victory-btn", openVictoryModal);

  // 行动按钮
  bind("act-preach", actionPreach);
  bind("act-heal", actionHeal);
  bind("act-fasting", actionFasting);
  bind("act-tentmaking", actionTentmaking);
  bind("act-build-church", actionBuildChurch);
  bind("act-send-letter", actionSendLetter);
  bind("act-solve-challenge", actionSolveCityChallenge);

  // 视口缩放
  bind("btn-zoom-in", () => zoomMap(0.15));
  bind("btn-zoom-out", () => zoomMap(-0.15));
  bind("btn-zoom-reset", resetMapTransform);

  // 全局遮罩点击与 ESC 兜底支持
  document.addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-backdrop") && e.target.id !== "modal-intro") {
      e.target.classList.remove("active");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal-backdrop").forEach(m => {
        if (m.id !== "modal-intro") m.classList.remove("active");
      });
    }
  });
}

// 渲染开局模板
function renderTemplateSelection() {
  const container = document.getElementById("template-select-grid");
  if (!container) return;
  container.innerHTML = "";

  CHARACTER_TEMPLATES.forEach(t => {
    const card = document.createElement("div");
    card.className = "template-card";
    card.id = `tpl-${t.id}`;
    card.innerHTML = `
      <h4>${t.name}</h4>
      <p style="font-size:0.75rem;color:#665241;margin:2px 0 4px;">${t.desc}</p>
      <div style="font-size:0.7rem;color:#801d1d;font-weight:bold;">${t.perk}</div>
    `;
    card.onclick = () => {
      document.querySelectorAll(".template-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      selectedTemplateId = t.id;
      const startBtn = document.getElementById("btn-confirm-start");
      if (startBtn) startBtn.disabled = false;
    };
    container.appendChild(card);
  });
}

// 顶部三大面板打开
function openTechModal() {
  renderTechTree();
  document.getElementById("modal-tech")?.classList.add("active");
}

function openCoworkersModal() {
  if (gameState.phase < 2) {
    showChronicleModal({
      badge: "阶段锁定",
      title: "主尚未受难复活 · 同工尚未集结",
      content: "【阶段一 · 七十人两两游历时期】\n此时主耶稣尚未受难复活，五旬节圣灵尚未降临！\n巴拿巴、提摩太、吕底亚等使徒行传著名同工，需待第 8 回合基督复活升天、开启使徒大宣教（阶段二）后方可开启招募与委派驻守！\n当前阶段请专心在加利利与犹太各城宣告天国临近、寻访平安之子。",
      changes: []
    });
    return;
  }
  renderCoworkerMarket();
  document.getElementById("modal-coworkers")?.classList.add("active");
}

function openVictoryModal() {
  if (gameState.phase < 2) {
    showChronicleModal({
      badge: "异象封存",
      title: "普世大使命尚未颁布",
      content: "【阶段一 · 七十人两两游历时期】\n“直到地极作我的见证”的普世异象，需待主复活升天颁布大使命后启幕！\n当前阶段首要使命是：在加利利与犹太地寻访平安之子、操练信心与顺服。\n第 8 回合历史转折后，将全面展开三大使徒异象胜利路线！",
      changes: []
    });
    return;
  }
  renderVictoryProgress();
  document.getElementById("modal-victory")?.classList.add("active");
}

// 地图视口控制
function initMapPanAndZoom() {
  const viewport = document.getElementById("map-viewport");
  if (!viewport) return;

  viewport.addEventListener("mousedown", (e) => {
    if (e.target.closest(".map-node") || e.target.closest(".map-ctrl-btn")) return;
    mapTransform.isDragging = true;
    mapTransform.startX = e.clientX - mapTransform.panX;
    mapTransform.startY = e.clientY - mapTransform.panY;
  });

  window.addEventListener("mousemove", (e) => {
    if (!mapTransform.isDragging) return;
    mapTransform.panX = e.clientX - mapTransform.startX;
    mapTransform.panY = e.clientY - mapTransform.startY;
    applyMapTransform();
  });

  window.addEventListener("mouseup", () => {
    mapTransform.isDragging = false;
  });

  viewport.addEventListener("wheel", (e) => {
    // 阻止缩放污染弹窗
    if (document.querySelector(".modal-backdrop.active")) return;
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const zoomStep = e.deltaY < 0 ? 0.12 : -0.12;
    zoomMapAt(zoomStep, mouseX, mouseY);
  }, { passive: false });

  applyMapTransform();
}

function zoomMapAt(delta, mouseX, mouseY) {
  const oldScale = mapTransform.scale;
  const newScale = Math.max(0.65, oldScale + delta);
  if (newScale === oldScale) return;

  mapTransform.panX = mouseX - (mouseX - mapTransform.panX) * (newScale / oldScale);
  mapTransform.panY = mouseY - (mouseY - mapTransform.panY) * (newScale / oldScale);
  mapTransform.scale = newScale;

  applyMapTransform();
}

function zoomMap(delta) {
  const viewport = document.getElementById("map-viewport");
  if (!viewport) return;
  const rect = viewport.getBoundingClientRect();
  zoomMapAt(delta, rect.width / 2, rect.height / 2);
}

function resetMapTransform() {
  mapTransform.scale = 1;
  mapTransform.panX = gameState.phase === 1 ? -420 : -250;
  mapTransform.panY = gameState.phase === 1 ? -220 : -100;
  applyMapTransform();
}

function applyMapTransform() {
  const container = document.getElementById("map-container");
  if (!container) return;
  container.style.transform = `translate(${mapTransform.panX}px, ${mapTransform.panY}px) scale(${mapTransform.scale})`;
  container.style.setProperty("--map-scale", mapTransform.scale);

  if (mapTransform.scale < 1.15) {
    container.classList.add("lod-far");
    container.classList.remove("lod-near");
  } else {
    container.classList.remove("lod-far");
    container.classList.add("lod-near");
  }
}

function drawRealisticAncientMap() {
  const canvas = document.getElementById("map-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  ctx.fillStyle = "#ecdcb6";
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "#a8c0cf";
  ctx.strokeStyle = "#859ea8";
  ctx.lineWidth = 3;

  ctx.beginPath();
  ctx.moveTo(150, 900);
  ctx.bezierCurveTo(350, 850, 750, 880, 990, 820);
  ctx.lineTo(980, 680);
  ctx.bezierCurveTo(995, 600, 1010, 520, 1020, 460);
  ctx.bezierCurveTo(1030, 410, 1010, 390, 970, 390);
  ctx.bezierCurveTo(890, 370, 840, 400, 770, 390);
  ctx.bezierCurveTo(740, 350, 720, 310, 750, 240);
  ctx.lineTo(680, 220);
  ctx.bezierCurveTo(620, 250, 600, 280, 630, 340);
  ctx.bezierCurveTo(610, 390, 560, 450, 580, 470);
  ctx.bezierCurveTo(530, 440, 480, 370, 450, 310);
  ctx.bezierCurveTo(380, 240, 300, 220, 260, 290);
  ctx.bezierCurveTo(320, 360, 380, 420, 370, 460);
  ctx.bezierCurveTo(310, 420, 260, 340, 220, 290);
  ctx.bezierCurveTo(150, 320, 100, 450, 150, 900);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(945, 455, 38, 16, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(680, 510, 60, 12, 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(320, 460, 35, 22, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#8aa8b8";
  ctx.beginPath();
  ctx.ellipse(1055, 550, 14, 20, 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.strokeStyle = "#8aa8b8";
  ctx.lineWidth = 2.5;
  ctx.moveTo(1055, 570);
  ctx.bezierCurveTo(1052, 600, 1048, 630, 1050, 660);
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(1050, 700, 11, 38, 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.font = "italic bold 17px Georgia, serif";
  ctx.fillStyle = "rgba(74, 98, 114, 0.65)";
  ctx.fillText("MARE NOSTRUM (地中海)", 530, 620);
  ctx.fillText("AEGAEUM (爱琴海)", 670, 360);
  ctx.fillText("PONTUS EUXINUS (黑海)", 840, 180);

  ctx.font = "bold 15px 'Songti SC', 'SimSun', serif";
  ctx.fillStyle = "rgba(109, 76, 50, 0.55)";
  ctx.fillText("【加利利】", 1000, 530);
  ctx.fillText("【犹太行省】", 965, 720);
  ctx.fillText("【小亚细亚】", 830, 290);
  ctx.fillText("【马其顿与希腊】", 520, 250);
  ctx.fillText("【义大利】", 250, 240);

  const grad = ctx.createRadialGradient(w/2, h/2, 400, w/2, h/2, 750);
  grad.addColorStop(0, "rgba(236, 220, 182, 0)");
  grad.addColorStop(1, "rgba(78, 52, 28, 0.35)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

function startGame() {
  gameState.player = CHARACTER_TEMPLATES.find(t => t.id === selectedTemplateId);
  const others = CHARACTER_TEMPLATES.filter(t => t.id !== selectedTemplateId);
  gameState.companion = others[Math.floor(Math.random() * others.length)];

  gameState.maxAp = gameState.player.stats.ap || 3;
  if (gameState.companion && gameState.companion.id === "tentmaker") {
    gameState.maxAp = Math.max(gameState.maxAp, 4);
  }
  gameState.ap = gameState.maxAp;
  gameState.resources.faith = gameState.player.stats.faith;
  gameState.resources.truth = gameState.player.stats.truth;

  document.getElementById("modal-intro")?.classList.remove("active");

  drawRealisticAncientMap();
  renderCompanions();
  renderMap();
  updateUI();
  resetMapTransform();

  const startMsg = `奉差启程！你（${gameState.player.name}）与搭档（${gameState.companion.name}）两两出发，前往各城宣告天国临近。`;
  addLog(startMsg);

  showChronicleModal({
    badge: "使徒启程",
    title: "奉主圣名 · 两两出征",
    content: `你与搭档领受差遣，不带钱囊、口袋和鞋，第一站踏入加利利海畔的迦百农。去医治城里的病人，对他们说：‘神的国临近你们了！’`,
    changes: [
      { text: `初始行动力: ${gameState.ap}`, type: "positive" },
      { text: `初始信心: ${gameState.resources.faith}`, type: "neutral" }
    ]
  });
}

function renderMap() {
  const layer = document.getElementById("nodes-layer");
  if (!layer) return;
  layer.innerHTML = "";
  const tooltip = document.getElementById("node-tooltip");

  let svg = document.getElementById("routes-svg");
  if (!svg) {
    svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.id = "routes-svg";
    svg.setAttribute("class", "route-svg");
    layer.appendChild(svg);
  }
  svg.innerHTML = "";

  const renderedLines = new Set();

  Object.values(MAP_NODES).forEach(node => {
    if (gameState.phase < node.phase) return;

    node.connections.forEach(targetId => {
      const target = MAP_NODES[targetId];
      if (!target || gameState.phase < target.phase) return;

      const lineKey = [node.id, target.id].sort().join("-");
      if (!renderedLines.has(lineKey)) {
        renderedLines.add(lineKey);
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", node.x);
        line.setAttribute("y1", node.y);
        line.setAttribute("x2", target.x);
        line.setAttribute("y2", target.y);
        line.setAttribute("class", node.isSea || target.isSea ? "route-line sea" : "route-line");
        svg.appendChild(line);
      }
    });

    const el = document.createElement("div");
    const isStationed = !!gameState.stationedCoworkers[node.id];
    el.className = `map-node type-${node.type} ${node.id === gameState.playerPos ? 'active-player-pos' : ''} ${gameState.churches[node.id] ? 'has-church' : ''}`;
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;

    el.innerHTML = `
      <div class="node-pin">${gameState.churches[node.id] ? '✝' : (isStationed ? '🛡️' : (node.type === 'hub' ? '★' : '•'))}</div>
      <div class="node-label">${node.name}${isStationed ? ' (驻)' : ''}</div>
    `;

    el.addEventListener("mouseenter", () => {
      if (!tooltip) return;
      const hasChurch = !!gameState.churches[node.id];
      const isCur = node.id === gameState.playerPos;
      const stationedName = gameState.stationedCoworkers[node.id]?.name || "无";
      tooltip.innerHTML = `
        <h4>${node.name} <span class="tooltip-tag">${node.type === 'hub' ? '战略大都' : (node.type === 'port' ? '通商海港' : '城镇村庄')}</span></h4>
        <div class="tooltip-desc">${node.desc}</div>
        <div class="tooltip-meta">
          <div>• 民情刚硬度: <strong>${node.hardiness}%</strong></div>
          <div>• 教会状态: <strong>${hasChurch ? '<span style="color:#2b8a3e">已建立家庭教会</span>' : '暂无教会'}</strong></div>
          <div>• 驻守同工: <strong>${stationedName}</strong></div>
          ${node.challenge && !gameState.completedChallenges.includes(node.id) ? '<div style="color:#801d1d">• 有待攻克议题！</div>' : ''}
          ${isCur ? '<div><strong style="color:#c92a2a">当前驻足地点</strong></div>' : ''}
        </div>
      `;
      tooltip.style.display = "block";
    });

    el.addEventListener("mousemove", (e) => {
      if (!tooltip) return;
      const x = Math.min(window.innerWidth - 260, e.clientX + 14);
      const y = Math.min(window.innerHeight - 160, e.clientY + 14);
      tooltip.style.left = `${x}px`;
      tooltip.style.top = `${y}px`;
    });

    el.addEventListener("mouseleave", () => {
      if (tooltip) tooltip.style.display = "none";
    });

    el.onclick = () => {
      if (tooltip) tooltip.style.display = "none";
      handleNodeClick(node.id);
    };

    layer.appendChild(el);
  });
}

function handleNodeClick(targetId) {
  if (targetId === gameState.playerPos) return;

  const curNode = MAP_NODES[gameState.playerPos];
  if (!curNode.connections.includes(targetId)) {
    showChronicleModal({
      badge: "道路阻隔",
      title: "无法直接通达",
      content: `【${MAP_NODES[targetId].name}】与当前所在城市没有直达的陆上驿道或海运航线。请沿航线逐站前行。`,
      changes: []
    });
    return;
  }

  if (gameState.ap <= 0) {
    showChronicleModal({
      badge: "步履疲乏",
      title: "行动力已尽",
      content: `本回合行动力已用尽，请停步歇宿，点击右上角【下一回合】重新得力后再行出发。`,
      changes: []
    });
    return;
  }

  gameState.ap -= 1;
  gameState.playerPos = targetId;
  const targetNode = MAP_NODES[targetId];

  renderMap();
  updateUI();

  addLog(`队伍行军抵达：${targetNode.name}（消耗 1 行动力）。`);

  showChronicleModal({
    badge: "行军抵达",
    title: `踏足 ${targetNode.name}`,
    content: `你的队伍抵达了【${targetNode.name}】。\n${targetNode.desc}\n此地民情刚硬度约为 ${targetNode.hardiness}%。城中百姓渴慕真光。`,
    changes: [
      { text: `消耗行动力 -1`, type: "negative" },
      { text: `驻足于: ${targetNode.name}`, type: "neutral" }
    ]
  });
}

// 统一平滑胜率模型计算函数 (0硬度=100%, >=50硬度=33.3%, 信心加成=Faith/600)
function calculateSmoothSuccessRate(hardiness, faith) {
  let baseP = 0;
  if (hardiness >= 50) {
    baseP = 1.0 / 3.0;
  } else if (hardiness <= 0) {
    baseP = 1.0;
  } else {
    const progressToZero = (50.0 - hardiness) / 50.0;
    baseP = (1.0 / 3.0) + (2.0 / 3.0) * Math.pow(progressToZero, 1.8);
  }

  const faithBonus = Math.max(0, faith) / 600.0;
  return Math.min(1.0, Math.max(0.05, baseP + faithBonus));
}

// 传道宣讲
function actionPreach() {
  if (gameState.ap <= 0) {
    return showChronicleModal({ badge: "疲乏", title: "无法行动", content: "行动力已耗尽，请进入下一回合。", changes: [] });
  }
  gameState.ap -= 1;

  const node = MAP_NODES[gameState.playerPos];
  const totalTruth = gameState.player.stats.truth + (gameState.companion ? gameState.companion.stats.truth : 0);

  let successChance = calculateSmoothSuccessRate(node.hardiness, gameState.resources.faith);

  // 1. 文士门徒天赋：辩道胜率 +25%
  if (hasPerkRole("scribe_apprentice")) {
    successChance = Math.min(1.0, successChance + 0.25);
  }
  // 2. 巴拿巴同工随队加成：胜率 +10%
  const isBarnabasStationed = Object.values(gameState.stationedCoworkers).some(c => c.id === "barnabas");
  if (gameState.hiredCoworkers.some(c => c.id === "barnabas") && !isBarnabasStationed) {
    successChance = Math.min(1.0, successChance + 0.10);
  }

  const roll = Math.random();

  if (roll < successChance) {
    const isCritical = Math.random() < 0.08;
    const baseDrop = 1 + (totalTruth * 0.04) + (gameState.resources.faith * 0.01) + (node.hardiness * 0.03);
    let hardinessDrop = Math.max(1, Math.floor(baseDrop + (Math.random() * 2 - 1)));

    // 织帐棚工匠特质：削减刚硬度额外加成
    if (hasPerkRole("tentmaker")) {
      hardinessDrop = Math.floor(hardinessDrop * 1.25) + 1;
    }

    let convertsGain = 0;
    const curC = gameState.resources.converts;
    const curF = gameState.resources.faith;

    if (curC < 15) {
      convertsGain = Math.floor(Math.random() * 3) + 2;
    } else if (curC < 45) {
      convertsGain = Math.floor(Math.random() * 4) + 4 + Math.floor(0.02 * curF);
    } else {
      convertsGain = Math.floor(Math.random() * 4) + 7 + Math.floor((0.08 * curC) + (0.05 * curF));
    }

    // 蒙恩被医治者特质：吸引平民信徒速度 +30%
    if (hasPerkRole("healed_one")) {
      convertsGain = Math.floor(convertsGain * 1.3);
    }

    // 百基拉与亚居拉随队加成：真理产出 +50%
    const isPAStationed = Object.values(gameState.stationedCoworkers).some(c => c.id === "priscilla_aquila");
    const paMultiplier = (gameState.hiredCoworkers.some(c => c.id === "priscilla_aquila") && !isPAStationed) ? 1.5 : 1.0;

    if (isCritical) {
      hardinessDrop = Math.min(20, Math.floor(hardinessDrop * 2.0) + Math.floor(Math.random() * 3));
      convertsGain = Math.floor(convertsGain * 1.5) + 3;

      const truthGain = Math.round(4 * paMultiplier);
      gameState.resources.truth += truthGain;
      node.hardiness = Math.max(0, node.hardiness - hardinessDrop);
      gameState.resources.converts += convertsGain;

      showChronicleModal({
        badge: "放胆宣道",
        title: `在 ${node.name} 见证大受感动！`,
        content: `你引经据典，放胆讲论。圣灵大施感化，坚石防线发生重大塌陷！`,
        changes: [
          { text: `🔥 刚硬度重创 -${hardinessDrop}% (现为 ${node.hardiness}%)`, type: "positive" },
          { text: `门徒 +${convertsGain}`, type: "positive" },
          { text: `真理 +${truthGain}`, type: "positive" },
          { text: `行动力 -1`, type: "negative" }
        ]
      });
      addLog(`在 ${node.name} 宣讲真道，全城震动，刚硬度 -${hardinessDrop}%，新增 ${convertsGain} 门徒。`);
    } else {
      hardinessDrop = Math.min(20, hardinessDrop);
      const truthGain = Math.round(2 * paMultiplier);
      gameState.resources.truth += truthGain;
      node.hardiness = Math.max(0, node.hardiness - hardinessDrop);
      gameState.resources.converts += convertsGain;

      showChronicleModal({
        badge: "传道证道",
        title: `在 ${node.name} 会堂与市集证道`,
        content: `你循循善诱，向众人剖析真道，城中多人欣然悔改。`,
        changes: [
          { text: `刚硬度 -${hardinessDrop}% (现为 ${node.hardiness}%)`, type: "positive" },
          { text: `门徒 +${convertsGain}`, type: "positive" },
          { text: `真理 +${truthGain}`, type: "positive" },
          { text: `行动力 -1`, type: "negative" }
        ]
      });
      addLog(`在 ${node.name} 证道，刚硬度 -${hardinessDrop}%，门徒 +${convertsGain}。`);
    }
  } else {
    const faithLost = Math.max(5, Math.floor(gameState.resources.faith * 0.10));
    gameState.resources.faith = Math.max(0, gameState.resources.faith - faithLost);

    showChronicleModal({
      badge: "遭遇抗拒",
      title: `在 ${node.name} 讲道受阻`,
      content: `此处民情顽梗，市集众人冷眼以对。队伍信心受到磨砺。`,
      changes: [
        { text: `信心受损 -10% (-${faithLost})`, type: "negative" },
        { text: `行动力 -1`, type: "negative" }
      ]
    });
    addLog(`在 ${node.name} 讲道遇冷，信心 -${faithLost}。`);
    checkEndGameConditions();
  }

  updateUI();
  renderMap();
}

// 按手祷告
function actionHeal() {
  if (gameState.ap <= 0) {
    return showChronicleModal({ badge: "疲乏", title: "无法行动", content: "行动力不足，请进入下一回合。", changes: [] });
  }
  if (gameState.resources.faith < 15) {
    return showChronicleModal({ badge: "灵里枯竭", title: "信心微小", content: "按手祷告需要至少 15 点圣灵信心。", changes: [] });
  }

  gameState.ap -= 1;
  gameState.resources.faith -= 15;

  const node = MAP_NODES[gameState.playerPos];
  const healChance = calculateSmoothSuccessRate(node.hardiness, gameState.resources.faith);

  const roll = Math.random();

  if (roll < healChance) {
    const isMiracleGreat = Math.random() < 0.10;
    const totalGrit = gameState.player.stats.grit + (gameState.companion ? gameState.companion.stats.grit : 0);
    const baseDrop = 1 + (gameState.resources.faith * 0.035) + (totalGrit * 0.02);
    let hardinessDrop = Math.max(1, Math.floor(baseDrop + (Math.random() * 2 - 1)));

    let convertsGain = 0;
    const curC = gameState.resources.converts;
    const curF = gameState.resources.faith;

    if (curC < 15) {
      convertsGain = Math.floor(Math.random() * 3) + 2;
    } else if (curC < 45) {
      convertsGain = Math.floor(Math.random() * 4) + 4 + Math.floor(0.02 * curF);
    } else {
      convertsGain = Math.floor(Math.random() * 4) + 7 + Math.floor((0.08 * curC) + (0.05 * curF));
    }

    if (hasPerkRole("healed_one")) {
      convertsGain = Math.floor(convertsGain * 1.3);
    }

    const extraFaith = Math.max(2, Math.floor((gameState.resources.faith + 15) * 0.10));
    gameState.resources.faith += 15 + extraFaith;

    if (isMiracleGreat) {
      hardinessDrop = Math.min(20, Math.floor(hardinessDrop * 2.2) + Math.floor(Math.random() * 3));
      convertsGain = Math.floor(convertsGain * 1.5) + 4;

      node.hardiness = Math.max(0, node.hardiness - hardinessDrop);
      gameState.resources.converts += convertsGain;

      showChronicleModal({
        badge: "罕见奇迹",
        title: `在 ${node.name} 显明惊人神迹！`,
        content: `瘫子立时行走跳跃赞美神！预扣信心如数返还并大大得胜，全城轰动！`,
        changes: [
          { text: `✨ 15信心全返 + 额外+${extraFaith} (10%)`, type: "positive" },
          { text: `🔥 刚硬度重创 -${hardinessDrop}% (现为 ${node.hardiness}%)`, type: "positive" },
          { text: `门徒 +${convertsGain}`, type: "positive" },
          { text: `行动力 -1`, type: "negative" }
        ]
      });
      addLog(`在 ${node.name} 见证罕见神迹！刚硬度 -${hardinessDrop}%，门徒 +${convertsGain}，信心增 +${extraFaith}。`);
    } else {
      hardinessDrop = Math.min(20, hardinessDrop);
      node.hardiness = Math.max(0, node.hardiness - hardinessDrop);
      gameState.resources.converts += convertsGain;

      showChronicleModal({
        badge: "按手医治",
        title: `在 ${node.name} 见证神迹医治`,
        content: `你奉主的名按手在病患身上，热病退去、恶疾痊愈。民风随之软化。`,
        changes: [
          { text: `✨ 15信心全返 + 额外+${extraFaith} (10%)`, type: "positive" },
          { text: `刚硬度 -${hardinessDrop}% (现为 ${node.hardiness}%)`, type: "positive" },
          { text: `门徒 +${convertsGain}`, type: "positive" },
          { text: `行动力 -1`, type: "negative" }
        ]
      });
      addLog(`在 ${node.name} 医治病人，刚硬度 -${hardinessDrop}%，门徒 +${convertsGain}，信心增 +${extraFaith}。`);
    }
  } else {
    const extraLoss = Math.max(6, Math.floor(gameState.resources.faith * 0.12));
    gameState.resources.faith = Math.max(0, gameState.resources.faith - extraLoss);

    showChronicleModal({
      badge: "灵里争战",
      title: `在 ${node.name} 经历信心的磨难`,
      content: `虽按手代求但未见果效，旁观者低语讥诮。预扣信心耗尽，灵里更受挫折冲击。`,
      changes: [
        { text: `损失预扣 15 信心`, type: "negative" },
        { text: `额外受挫 -12% (-${extraLoss})`, type: "negative" },
        { text: `行动力 -1`, type: "negative" }
      ]
    });
    addLog(`在 ${node.name} 祷告争战未果，损失 15 信心并追加 -${extraLoss}。`);
    checkEndGameConditions();
  }

  updateUI();
  renderMap();
}

// 禁食默想祈祷
function actionFasting() {
  if (gameState.ap <= 0) {
    return showChronicleModal({
      badge: "步履疲乏",
      title: "行动力不足",
      content: "本回合行动力已用尽，请停步歇宿，点击右上角【下一回合】重新得力后再行出发。",
      changes: []
    });
  }
  gameState.ap -= 1;
  gameState.resources.faith += 15;

  showChronicleModal({
    badge: "内室祈祷",
    title: "禁食默想 · 重新得力",
    content: "你退到旷野与内室恒切祷告，放下身体的挂虑，单单仰望十字架上的大牧者。圣灵的大能如甘霖充满你的心灵，信心大得坚固！",
    changes: [
      { text: `✨ 信心充盈 +15 (现为 ${gameState.resources.faith})`, type: "positive" },
      { text: `消耗行动力 -1 (剩余 ${gameState.ap}/${gameState.maxAp})`, type: "negative" }
    ]
  });
  addLog(`在 ${MAP_NODES[gameState.playerPos].name} 禁食祈祷，重新得力，信心 +15。`);
  updateUI();
}

// 织帐棚作工自足
function actionTentmaking() {
  if (gameState.phase < 2) {
    return showChronicleModal({
      badge: "阶段锁定",
      title: "不可备钱囊口袋",
      content: "【阶段一 · 七十人两两出行】\n主亲自吩咐：‘不要带钱囊，不要带口袋，不要带鞋……工人得工价是应当的。’\n在阶段一，门徒当全心宣告天国临近，靠主恩典与百姓接待度日。\n待主受难复活升天、五旬节圣灵沛降（第 8 回合进入阶段二使徒行传）后，方可自食其力织帐棚作工筹集爱心物资！",
      changes: []
    });
  }

  if (gameState.ap <= 0) {
    return showChronicleModal({
      badge: "步履疲乏",
      title: "行动力不足",
      content: "本回合行动力已用尽，请停步歇宿，点击右上角【下一回合】重新得力后再行出发。",
      changes: []
    });
  }
  gameState.ap -= 1;
  gameState.resources.goods += 8;

  showChronicleModal({
    badge: "亲手作工",
    title: "织帐棚作工 · 自食其力",
    content: "“我们未尝白吃人的饭，倒是辛苦劳碌，昼夜作工，免得叫你们一人受累。” 你在市集编织帐棚、缝制皮革，为宣教筹措爱心物资！",
    changes: [
      { text: `🍞 爱心物资 +8 (现为 ${gameState.resources.goods})`, type: "positive" },
      { text: `消耗行动力 -1 (剩余 ${gameState.ap}/${gameState.maxAp})`, type: "negative" }
    ]
  });
  addLog(`在 ${MAP_NODES[gameState.playerPos].name} 织帐棚作工，筹得 +8 物资。`);
  updateUI();
}

// 建立教会
function actionBuildChurch() {
  if (gameState.phase < 2) {
    return showChronicleModal({
      badge: "时机未至",
      title: "教会根基尚未设立",
      content: "【阶段一 · 七十人两两游历时期】\n主尚未在十字架上舍命，尚未第三天死里复活，五旬节教会时代尚未开始！\n阶段一的核心使命是两两宣讲天国临近、寻访平安之子。\n待第 8 回合基督复活升天、圣灵降临开启阶段二后，方可正式设立家庭教会聚会据点！",
      changes: []
    });
  }
  if (gameState.churches[gameState.playerPos]) {
    return showChronicleModal({
      badge: "已建堂",
      title: "据点已存在",
      content: `【${MAP_NODES[gameState.playerPos].name}】已经建立了家庭教会，已有信徒聚会与守圣餐，无需重复设立。`,
      changes: []
    });
  }

  let cost = 40;
  // 吕底亚随队天赋（未驻守时减少15物资）
  const isLydiaStationed = Object.values(gameState.stationedCoworkers).some(c => c.id === "lydia");
  if (gameState.hiredCoworkers.some(c => c.id === "lydia") && !isLydiaStationed) {
    cost -= 15;
  }

  if (gameState.resources.goods < cost) {
    return showChronicleModal({
      badge: "物资短缺",
      title: "难以供给周济爱筵",
      content: `建立家庭教会需要筹备至少 ${cost} 点爱心物资（当前物资: ${gameState.resources.goods}）。请通过织帐棚或信徒捐项积累后再建。`,
      changes: []
    });
  }

  const node = MAP_NODES[gameState.playerPos];
  gameState.resources.goods -= cost;
  gameState.churches[gameState.playerPos] = { level: 1, letterBuffRemaining: 0 };

  const rebound = Math.floor(Math.random() * 7) + 12;
  node.hardiness = Math.min(100, node.hardiness + rebound);

  renderMap();
  updateUI();

  showChronicleModal({
    badge: "建立教会",
    title: `在 ${node.name} 设立家庭教会`,
    content: `奉父、子、圣灵的名为门徒施洗，设立聚会据点！旧有势力大起警觉，刚硬度反弹上升。每座教会每回合需要 5 点物资维系周济。`,
    changes: [
      { text: `物资储备 -${cost}`, type: "negative" },
      { text: `确立据点: ✝`, type: "positive" },
      { text: `⚠️ 旧势力反弹：刚硬度 +${rebound}% (现为 ${node.hardiness}%)`, type: "negative" }
    ]
  });
  addLog(`在 ${node.name} 设立家庭教会据点！刚硬度 +${rebound}%。`);
}

// 攻克城邦专属议题挑战
function actionSolveCityChallenge() {
  const node = MAP_NODES[gameState.playerPos];
  if (!node.challenge || gameState.completedChallenges.includes(node.id)) return;

  if (gameState.resources.truth < node.challenge.reqTruth) {
    return showChronicleModal({
      badge: "真理未达",
      title: "辩道储备不足",
      content: `攻克【${node.challenge.title}】需要深厚的圣经与神学积累（需达到 ${node.challenge.reqTruth} 点真理经卷储备）。请通过证道或研发科技后再来决胜！`,
      changes: []
    });
  }

  if (gameState.ap <= 0) {
    return showChronicleModal({ badge: "疲乏", title: "无法行动", content: "行动力不足！", changes: [] });
  }

  gameState.ap -= 1;
  gameState.completedChallenges.push(node.id);
  node.hardiness = Math.max(0, node.hardiness - 25);

  const changes = [{ text: `🔥 城邦坚垒瓦解：刚硬度 -25%`, type: "positive" }];
  if (node.challenge.rewardConverts) {
    gameState.resources.converts += node.challenge.rewardConverts;
    changes.push({ text: `门徒归信 +${node.challenge.rewardConverts}`, type: "positive" });
  }
  if (node.challenge.rewardTruth) {
    gameState.resources.truth += node.challenge.rewardTruth;
    changes.push({ text: `真理经卷 +${node.challenge.rewardTruth}`, type: "positive" });
  }
  if (node.challenge.rewardGoods) {
    gameState.resources.goods += node.challenge.rewardGoods;
    changes.push({ text: `物资收获 +${node.challenge.rewardGoods}`, type: "positive" });
  }
  if (node.challenge.rewardFaith) {
    gameState.resources.faith += node.challenge.rewardFaith;
    changes.push({ text: `信心坚定 +${node.challenge.rewardFaith}`, type: "positive" });
  }

  showChronicleModal({
    badge: "得胜凯歌",
    title: `攻克城邦议题：【${node.challenge.title}】！`,
    content: `你在城中面对各方辩士与异教权势放胆陈明真道！对方辩驳哑口无言，全城百姓大得释放，主的名被大大高举！`,
    changes: changes
  });
  addLog(`成功攻克 ${node.name} 专属议题【${node.challenge.title}】！`);

  updateUI();
  renderMap();
}

// 发送书信
function actionSendLetter() {
  if (!gameState.researchedTechs.includes("m_epistles")) {
    return showChronicleModal({
      badge: "缺乏体制",
      title: "尚未研发书信体制",
      content: "尚未在教会事工树中研发【羊皮卷信差体制】。唯有训练出忠心信差，方能跨城递送信件。",
      changes: []
    });
  }
  if (gameState.resources.truth < 15) {
    return showChronicleModal({ badge: "真理不足", title: "无法成书", content: "撰写一份有真理分量与圣灵默示的劝勉书信，需要消耗 15 点真理经卷储备。", changes: [] });
  }

  gameState.resources.truth -= 15;
  const turns = gameState.researchedTechs.includes("t_gospel_canon") ? 6 : 3;
  Object.keys(gameState.churches).forEach(k => {
    gameState.churches[k].letterBuffRemaining = turns;
  });

  updateUI();

  showChronicleModal({
    badge: "使徒书信",
    title: "向各城教会寄发羊皮卷督责书信",
    content: `你磨墨展卷，针对纷争、世俗化与异端写下恳切书信，派遣信差送往各城！各地教会被信中的真理深深震动，重新合一！`,
    changes: [
      { text: `消耗真理 -15`, type: "negative" },
      { text: `所有教会获得 ${turns} 回合【异端与纷争免疫护盾】`, type: "positive" }
    ]
  });
  addLog(`寄发使徒督责书信，所有教会获得 ${turns} 回合稳固护盾。`);
}

// 回合结算
function handleNextTurn() {
  gameState.turn += 1;
  gameState.ap = gameState.maxAp;

  const churchCount = Object.keys(gameState.churches).length;

  let convertsGrowth = churchCount * 2;
  let faithGrowth = 4 + (churchCount * 2);
  let truthGrowth = 3 + churchCount;

  let bonusGoods = 0;
  let bonusTruth = 0;
  Object.entries(gameState.stationedCoworkers).forEach(([cityId, cw]) => {
    if (cw.id === "barnabas") bonusGoods += 4;
    if (cw.id === "lydia") bonusGoods += 6;
    if (cw.id === "priscilla_aquila") bonusTruth += 3;
    if (cw.id === "timothy") {
      MAP_NODES[cityId].hardiness = Math.max(0, MAP_NODES[cityId].hardiness - 1);
    }
  });

  truthGrowth += bonusTruth;

  let convertsContribution = Math.floor(gameState.resources.converts / 10);
  // 税吏特质：爱心物资产出 +20%
  if (hasPerkRole("tax_collector")) {
    convertsContribution = Math.floor(convertsContribution * 1.2);
  }

  const goodsCost = churchCount * 5;
  const netGoodsGrowth = convertsContribution + bonusGoods - goodsCost;

  gameState.resources.goods += netGoodsGrowth;
  if (gameState.resources.goods < 0) {
    gameState.resources.goods = 0;
    gameState.resources.faith = Math.max(0, gameState.resources.faith - 8);
    gameState.resources.converts = Math.max(0, gameState.resources.converts - 6);
    addLog(`【物资匮乏警告】教会周济断绝，信心与门徒流失！`);
  }

  gameState.resources.converts += convertsGrowth;
  gameState.resources.faith += faithGrowth;
  gameState.resources.truth += truthGrowth;

  Object.values(MAP_NODES).forEach(node => {
    if (gameState.phase < node.phase) return;
    if (node.id === gameState.playerPos) return;
    if (gameState.stationedCoworkers[node.id]) return;

    const church = gameState.churches[node.id];
    if (church && church.letterBuffRemaining > 0) {
      church.letterBuffRemaining -= 1;
      return;
    }

    if (church) {
      node.hardiness = Math.min(85, node.hardiness + 1);
    } else {
      node.hardiness = Math.min(100, node.hardiness + 2);
    }
  });

  updateUI();
  renderMap();

  addLog(`--- 第 ${gameState.turn} 回合：日光升起，主恩长存 ---`);

  if (checkEndGameConditions()) return;

  // 阶段转换判定（第 8 回合）
  if (gameState.phase === 1 && gameState.turn >= 8) {
    triggerHistoricalTurningPoint();
    return;
  }

  // 危机事件
  if (gameState.phase === 2 && Math.random() < 0.45) {
    triggerRandomCrisis();
    return;
  }

  showChronicleModal({
    badge: `回合交替`,
    title: `第 ${gameState.turn} 回合启幕`,
    content: `新一周日光升起，信徒恒切擘饼祈祷。\n信徒奉献与同工筹措得物资 +${convertsContribution + bonusGoods}，维持教会爱筵消耗 -${goodsCost} 点物资。`,
    changes: [
      { text: `行动力充盈: ${gameState.maxAp}`, type: "positive" },
      { text: `净物资变动: ${netGoodsGrowth >= 0 ? '+' : ''}${netGoodsGrowth}`, type: netGoodsGrowth >= 0 ? "positive" : "negative" }
    ]
  });
}

function triggerHistoricalTurningPoint() {
  gameState.phase = 2;
  gameState.playerPos = "jerusalem";

  const badgeEl = document.getElementById("phase-badge");
  if (badgeEl) badgeEl.textContent = "阶段二：使徒行传大宣教";
  renderMap();
  updateUI();
  resetMapTransform();

  addLog(`【重大见证】亲历主耶稣复活与五旬节圣灵沛降！全地中海宣教版图开启。`);

  showChronicleModal({
    badge: "历史转折点",
    title: "受难、复活与五旬节圣灵大降临",
    content: `七十人宣教行期已毕，你们奉召回到耶路撒冷。\n在此，你们亲身目睹了主为罪人被钉十字架，并在三日后破开坟墓战胜死亡荣耀复活！升天之时，主亲自颁布至高使命：\n“但圣灵降临在你们身上，你们就必得着能力；并要在耶路撒冷、犹太全地和撒玛利亚，直到地极，作我的见证！”\n五旬节如大风与舌头般烈火的圣灵沛然浇灌！海路与罗马帝国全境版图已为你全面展开！现在，放胆传讲复活的基督！`,
    changes: [
      { text: `开放罗马帝国大航路版图`, type: "positive" },
      { text: `正式解锁【招募同工】与【使徒异象】大战略`, type: "positive" },
      { text: `正式解锁【建立教会】与【织帐棚作工】`, type: "positive" },
      { text: `队伍回到圣城耶路撒冷`, type: "neutral" }
    ]
  });
}

function triggerRandomCrisis() {
  const crisis = CRISIS_EVENTS[Math.floor(Math.random() * CRISIS_EVENTS.length)];
  const isProtected = gameState.researchedTechs.includes(crisis.requiredTech);

  // 狂热党角色特质：面对公会审讯免疫信心惩罚
  const isZealotProtected = crisis.id === "c_sanhedrin" && hasPerkRole("zealot");

  if (isProtected || isZealotProtected) {
    showChronicleModal({
      badge: "危机化解",
      title: crisis.title,
      content: `${crisis.desc}\n\n【圣灵引导下的智慧】：由于你的教会早已研发确立了对应的真理与治理体制（或队中拥有刚毅无畏的忠勇门徒），各地领袖站立得稳，${crisis.successMsg}`,
      changes: [
        { text: `✓ 成功免疫危机惩罚`, type: "positive" },
        { text: `教会威望更加坚固`, type: "positive" }
      ]
    });
    addLog(`成功化解危机：【${crisis.title}】。`);
  } else {
    const changesList = [];

    if (crisis.onFailure.faithLossPct) {
      const pct = Math.round(crisis.onFailure.faithLossPct * 100);
      const actualLoss = Math.max(5, Math.floor(gameState.resources.faith * crisis.onFailure.faithLossPct));
      gameState.resources.faith = Math.max(0, gameState.resources.faith - actualLoss);
      changesList.push({ text: `信心 -${pct}% (-${actualLoss})`, type: "negative" });
    }

    if (crisis.onFailure.convertsLossPct) {
      const pct = Math.round(crisis.onFailure.convertsLossPct * 100);
      const actualLoss = Math.max(2, Math.floor(gameState.resources.converts * crisis.onFailure.convertsLossPct));
      gameState.resources.converts = Math.max(0, gameState.resources.converts - actualLoss);
      changesList.push({ text: `信徒流失 -${pct}% (-${actualLoss})`, type: "negative" });
    }

    if (crisis.onFailure.goodsLossPct) {
      const pct = Math.round(crisis.onFailure.goodsLossPct * 100);
      const actualLoss = Math.max(5, Math.floor(gameState.resources.goods * crisis.onFailure.goodsLossPct));
      gameState.resources.goods = Math.max(0, gameState.resources.goods - actualLoss);
      changesList.push({ text: `物资损失 -${pct}% (-${actualLoss})`, type: "negative" });
    }

    if (crisis.onFailure.truthLossPct) {
      const pct = Math.round(crisis.onFailure.truthLossPct * 100);
      const actualLoss = Math.max(3, Math.floor(gameState.resources.truth * crisis.onFailure.truthLossPct));
      gameState.resources.truth = Math.max(0, gameState.resources.truth - actualLoss);
      changesList.push({ text: `真理受惑 -${pct}% (-${actualLoss})`, type: "negative" });
    }

    showChronicleModal({
      badge: "历经磨难",
      title: crisis.title,
      content: `${crisis.desc}\n\n【防线失守】：由于教会体制或神学根基尚未研发完备，这场巨浪给初生的门徒群体带来了沉重的打击与震荡！`,
      changes: changesList
    });
    addLog(`遭遇磨难：【${crisis.title}】，教会受损。`);
    checkEndGameConditions();
  }

  updateUI();
}

function addLog(summaryText) {
  const stream = document.getElementById("log-stream");
  if (!stream) return;

  const item = document.createElement("div");
  item.className = "log-item";
  item.innerHTML = `<span class="log-turn">T${gameState.turn}</span>${summaryText}`;

  stream.appendChild(item);
  stream.scrollTop = stream.scrollHeight;
}

function showChronicleModal({ badge, title, content, changes }) {
  const modal = document.getElementById("modal-chronicle");
  if (!modal) return;
  document.getElementById("chronicle-badge").textContent = badge;
  document.getElementById("chronicle-title").textContent = title;
  document.getElementById("chronicle-content").innerHTML = content.replace(/\n/g, "<br>");

  const changeBox = document.getElementById("chronicle-changes");
  changeBox.innerHTML = "";
  if (changes && changes.length > 0) {
    changes.forEach(ch => {
      const span = document.createElement("span");
      span.className = `change-pill ${ch.type}`;
      span.textContent = ch.text;
      changeBox.appendChild(span);
    });
  }

  modal.classList.add("active");
}

function checkEndGameConditions() {
  if (gameState.resources.faith <= 0) {
    showChronicleModal({
      badge: "败局终章",
      title: "信心熄灭",
      content: "在漫长严酷的逼迫与试炼中，队伍的信心与热忱彻底耗尽，宣教的火种陷入了沉寂...",
      changes: [{ text: "点击确定重新启程", type: "negative" }]
    });
    document.getElementById("chronicle-confirm-btn").onclick = () => location.reload();
    return true;
  }

  const churchCount = Object.keys(gameState.churches).length;

  // 胜利 1：地极开拓胜利
  if (gameState.churches["rome"] && churchCount >= 5 && gameState.resources.converts >= 200) {
    showChronicleModal({
      badge: "荣耀凯歌 · 地极胜利",
      title: "地极见证 · 罗马大捷",
      content: "“放胆传讲神国的道，将主耶稣基督的事教导人，并没有人禁止！”\n\n你不仅将福音的大旗插在帝国的心脏罗马，更在地中海各沿岸建立了坚不可摧的五大枢纽教会网络！地极见证大使命圆满达成！阿们！",
      changes: [{ text: "👑 达成【使徒国度 · 罗马凯歌】大胜利！", type: "positive" }]
    });
    document.getElementById("chronicle-confirm-btn").onclick = () => location.reload();
    return true;
  }

  // 胜利 2：神学圣徒胜利
  const hasAllTech = gameState.researchedTechs.length >= 8;
  const citiesMelted = MAP_NODES["ephesus"] && MAP_NODES["athens"] && MAP_NODES["antioch"] &&
    MAP_NODES["ephesus"].hardiness <= 15 && MAP_NODES["athens"].hardiness <= 15 && MAP_NODES["antioch"].hardiness <= 15;
  if (hasAllTech && citiesMelted) {
    showChronicleModal({
      badge: "荣耀凯歌 · 真理圣徒",
      title: "真理柱石 · 信仰守望",
      content: "“按正意分解真理的道，打过了那美好的仗！”\n\n你确立了完备的使徒教义体系与治理体制，不仅写下流传万代的正典教导，更彻底熔化了以弗所、雅典哲士与安提阿等异教顽梗中心的坚垒！天国的智慧战胜了世上的虚妄！",
      changes: [{ text: "📜 达成【真理柱石 · 信仰守望】大胜利！", type: "positive" }]
    });
    document.getElementById("chronicle-confirm-btn").onclick = () => location.reload();
    return true;
  }

  // 胜利 3：大爱周济胜利
  if (gameState.resources.converts >= 300 && gameState.resources.goods >= 150) {
    showChronicleModal({
      badge: "荣耀凯歌 · 圣爱胜利",
      title: "圣徒相通 · 普世合一",
      content: "“信的人都在一处，凡物公用，存着欢喜诚实的心用饭，赞美神，得众民的喜爱！”\n\n遍及帝国的庞大门徒群体在大爱中紧密相连，积蓄的丰盛捐项战胜了全地饥荒与贫苦，向罗马全境显明了超越帝国的基督圣爱！",
      changes: [{ text: "🍞 达成【圣徒相通 · 普世合一】大胜利！", type: "positive" }]
    });
    document.getElementById("chronicle-confirm-btn").onclick = () => location.reload();
    return true;
  }

  return false;
}

// 同工招募面板
function renderCoworkerMarket() {
  const container = document.getElementById("coworker-market-grid");
  if (!container) return;
  container.innerHTML = "";

  RECRUITABLE_COWORKERS.forEach(cw => {
    const isHired = gameState.hiredCoworkers.some(c => c.id === cw.id);
    const isStationed = Object.values(gameState.stationedCoworkers).some(c => c.id === cw.id);
    const canHire = gameState.resources.converts >= cw.reqConverts && gameState.resources.goods >= cw.costGoods;

    const card = document.createElement("div");
    card.className = "coworker-card";
    card.innerHTML = `
      <div>
        <h4>${cw.name}</h4>
        <div class="coworker-desc">${cw.desc}</div>
        <div class="coworker-perk-text">${cw.perkDesc}</div>
      </div>
      <div>
        <p style="font-size:0.7rem;color:#776655;margin-bottom:6px;">门槛：${cw.reqConverts}信徒，${cw.costGoods}物资</p>
        ${!isHired ? 
          `<button type="button" ${canHire ? '' : 'disabled'}>召募同工</button>` :
          (isStationed ? 
            `<button type="button">召回随队</button>` :
            `<button type="button">驻守当前城邑</button>`
          )
        }
      </div>
    `;
    card.querySelector("button").addEventListener("click", () => {
      if (!isHired) window.hireCoworker(cw.id);
      else if (isStationed) window.recallCoworker(cw.id);
      else window.stationCoworker(cw.id);
    });
    container.appendChild(card);
  });
}

window.hireCoworker = function(id) {
  const cw = RECRUITABLE_COWORKERS.find(c => c.id === id);
  if (!cw || gameState.resources.goods < cw.costGoods) return;

  gameState.resources.goods -= cw.costGoods;
  gameState.hiredCoworkers.push(cw);

  if (cw.id === "timothy") {
    gameState.maxAp += 1;
    gameState.ap += 1;
  }

  showChronicleModal({
    badge: "同工加盟",
    title: `欢迎同行伙伴：【${cw.name}】！`,
    content: `${cw.desc}\n感谢主的预备，宣教队伍大得坚固与安慰！`,
    changes: [{ text: `消耗物资 -${cw.costGoods}`, type: "negative" }]
  });
  addLog(`成功招募同工：${cw.name}。`);

  renderCoworkerMarket();
  renderCompanions();
  updateUI();
};

window.stationCoworker = function(id) {
  const cw = gameState.hiredCoworkers.find(c => c.id === id);
  const city = MAP_NODES[gameState.playerPos];

  if (gameState.stationedCoworkers[city.id]) {
    alert(`${city.name} 已有同工在此驻守！`);
    return;
  }

  gameState.stationedCoworkers[city.id] = cw;
  // 提摩太驻守后，随队行动力上限加成卸载
  if (cw.id === "timothy") {
    gameState.maxAp = Math.max(3, gameState.maxAp - 1);
    gameState.ap = Math.min(gameState.ap, gameState.maxAp);
  }

  showChronicleModal({
    badge: "按立监督",
    title: `委派 ${cw.name} 驻守 ${city.name}`,
    content: `${cw.name} 顺服托付，在此城按立门徒扎根牧养！该城将获得其专属驻守庇护，且刚硬度彻底停止回升！`,
    changes: [{ text: `驻守于: ${city.name}`, type: "positive" }]
  });
  addLog(`委派 ${cw.name} 驻守 ${city.name}。`);

  renderCoworkerMarket();
  renderCompanions();
  renderMap();
  updateUI();
};

window.recallCoworker = function(id) {
  const cityId = Object.keys(gameState.stationedCoworkers).find(k => gameState.stationedCoworkers[k].id === id);
  if (cityId) {
    const cw = gameState.stationedCoworkers[cityId];
    delete gameState.stationedCoworkers[cityId];
    if (cw.id === "timothy") {
      gameState.maxAp += 1;
    }
    addLog(`将 ${cw.name} 召回宣教随行队伍。`);
  }
  renderCoworkerMarket();
  renderCompanions();
  renderMap();
  updateUI();
};

// 使徒异象胜利进度
function renderVictoryProgress() {
  const churchCount = Object.keys(gameState.churches).length;
  const hasRome = !!gameState.churches["rome"];
  const progRomeEl = document.getElementById("prog-rome");
  if (progRomeEl) {
    progRomeEl.textContent = `进度：${hasRome ? '✓ 罗马已建堂' : '✕ 罗马未建堂'} | 教会 ${churchCount}/5 | 信徒 ${gameState.resources.converts}/200`;
  }

  const techCount = gameState.researchedTechs.length;
  const eH = MAP_NODES["ephesus"] ? MAP_NODES["ephesus"].hardiness : 65;
  const aH = MAP_NODES["athens"] ? MAP_NODES["athens"].hardiness : 70;
  const antH = MAP_NODES["antioch"] ? MAP_NODES["antioch"].hardiness : 35;
  const progTheoEl = document.getElementById("prog-theology");
  if (progTheoEl) {
    progTheoEl.textContent = `进度：科技 ${techCount}/8 | 以弗所 ${eH}% | 雅典 ${aH}% | 安提阿 ${antH}% (目标<=15%)`;
  }

  const progCharEl = document.getElementById("prog-charity");
  if (progCharEl) {
    progCharEl.textContent = `进度：信徒 ${gameState.resources.converts}/300 | 爱心物资 ${gameState.resources.goods}/150`;
  }
}

// 双轨科技树渲染
function renderTechTree() {
  const truthList = document.getElementById("truth-tree-list");
  const ministryList = document.getElementById("ministry-tree-list");
  if (!truthList || !ministryList) return;
  truthList.innerHTML = "";
  ministryList.innerHTML = "";

  TRUTH_TECH_TREE.forEach(t => truthList.appendChild(createTechCard(t)));
  MINISTRY_TECH_TREE.forEach(t => ministryList.appendChild(createTechCard(t)));
}

function createTechCard(t) {
  const isResearched = gameState.researchedTechs.includes(t.id);
  const prereqMet = !t.prereq || gameState.researchedTechs.includes(t.prereq);
  const card = document.createElement("div");
  card.className = `tech-card ${isResearched ? 'researched' : ''}`;
  card.innerHTML = `
    <strong>${t.name}</strong> (需 ${t.cost} 真理)
    <p style="font-size:0.75rem;color:#554433;margin:2px 0;">${t.desc}</p>
    ${t.prereq && !prereqMet ? `<div style="font-size:0.7rem;color:#a00;margin-bottom:4px;">需前置: ${getTechName(t.prereq)}</div>` : ''}
    ${isResearched ? '<span style="color:#2b8a3e;font-weight:bold;">✓ 已领悟</span>' : 
      `<button type="button" ${prereqMet && gameState.resources.truth >= t.cost ? '' : 'disabled'}>默想研发</button>`
    }
  `;
  card.querySelector("button")?.addEventListener("click", () => window.researchTech(t.id, t.cost));
  return card;
}

function getTechName(id) {
  const t = [...TRUTH_TECH_TREE, ...MINISTRY_TECH_TREE].find(item => item.id === id);
  return t ? t.name : id;
}

window.researchTech = function(id, cost) {
  const tech = [...TRUTH_TECH_TREE, ...MINISTRY_TECH_TREE].find(item => item.id === id);
  if (!tech) return;

  // 修复：前置校验
  if (tech.prereq && !gameState.researchedTechs.includes(tech.prereq)) {
    alert(`领悟此项真理之前，必须先扎根领悟【${getTechName(tech.prereq)}】！`);
    return;
  }

  if (gameState.resources.truth < cost) {
    alert("真理经卷储备不足！");
    return;
  }
  gameState.resources.truth -= cost;
  gameState.researchedTechs.push(id);
  renderTechTree();
  updateUI();

  showChronicleModal({
    badge: "真理突破",
    title: `领悟体制/神学：【${tech.name}】`,
    content: `在内室祈祷与圣经研读中豁然开朗，确立了这项属灵根基！对教会的巩固带来深远保护。`,
    changes: [{ text: `消耗真理: -${cost}`, type: "negative" }]
  });
  addLog(`研发成功：领悟【${tech.name}】。`);
  checkEndGameConditions();
};

function updateUI() {
  const setTxt = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setTxt("turn-num", gameState.turn);
  setTxt("res-converts", gameState.resources.converts);
  setTxt("res-faith", gameState.resources.faith);
  setTxt("res-truth", gameState.resources.truth);
  setTxt("res-mercy-goods", gameState.resources.goods);
  setTxt("cur-ap", `${gameState.ap}/${gameState.maxAp}`);

  const curNode = MAP_NODES[gameState.playerPos];
  setTxt("cur-loc-name", curNode.name);
  setTxt("cur-loc-desc", curNode.desc);
  setTxt("cur-hardiness", `${curNode.hardiness}%`);
  setTxt("cur-church-status", gameState.churches[curNode.id] ? "已建立家庭教会" : "未建立");

  // 根据当前阶段动态更新按钮前缀锁
  const btnCoworkers = document.getElementById("open-coworkers-btn");
  const btnVictory = document.getElementById("open-victory-btn");
  const btnTent = document.getElementById("act-tentmaking");
  const btnChurch = document.getElementById("act-build-church");

  if (gameState.phase === 1) {
    if (btnCoworkers) btnCoworkers.textContent = "🔒 招募同工";
    if (btnVictory) btnVictory.textContent = "🔒 使徒异象";
    if (btnTent) btnTent.textContent = "🔒 织帐棚 (阶段二解锁)";
    if (btnChurch) btnChurch.textContent = "🔒 建立教会 (阶段二解锁)";
  } else {
    if (btnCoworkers) btnCoworkers.textContent = "招募同工";
    if (btnVictory) btnVictory.textContent = "使徒异象";
    if (btnTent) btnTent.textContent = "织帐棚作工 (1 AP, +8物资)";
    if (btnChurch) btnChurch.textContent = "建立家庭教会 (40 物资)";
  }

  // 城邦专属议题挑战栏目控制
  const chalBox = document.getElementById("city-challenge-box");
  if (chalBox) {
    if (curNode.challenge && !gameState.completedChallenges.includes(curNode.id)) {
      chalBox.style.display = "block";
      setTxt("chal-title", `🏛️ ${curNode.challenge.title} (需 ${curNode.challenge.reqTruth} 真理)`);
      setTxt("chal-desc", curNode.challenge.desc);
    } else {
      chalBox.style.display = "none";
    }
  }
}

function renderCompanions() {
  const container = document.getElementById("companion-list");
  if (!container) return;
  container.innerHTML = "";

  [gameState.player, gameState.companion].forEach((p, idx) => {
    if (!p) return;
    const div = document.createElement("div");
    div.className = "companion-card";
    div.innerHTML = `
      <div class="companion-header">
        <span>${idx === 0 ? '👑 [主角]' : '🤝 [搭档]'} ${p.name}</span>
      </div>
      <div class="companion-perk">${p.perk}</div>
    `;
    container.appendChild(div);
  });

  gameState.hiredCoworkers.forEach(cw => {
    const isStationed = Object.values(gameState.stationedCoworkers).some(c => c.id === cw.id);
    const div = document.createElement("div");
    div.className = "companion-card";
    div.innerHTML = `
      <div class="companion-header">
        <span>📜 [同工] ${cw.name}</span>
        <span style="font-size:0.7rem;color:${isStationed ? '#2b8a3e' : '#801d1d'};">${isStationed ? '驻守中' : '随队'}</span>
      </div>
      <div class="companion-perk">${cw.perkDesc}</div>
    `;
    container.appendChild(div);
  });
}
