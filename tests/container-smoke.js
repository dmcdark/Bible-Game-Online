// Run against the disposable CI container. No additional dependencies needed.
const assert = require("node:assert/strict");
const rules = require("../online-rules");
const questions = require("../pilgrim-progress/questions.json");
const base = "http://127.0.0.1:3000";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

class Client {
  constructor() {
    this.events = [];
    this.waiters = [];
    this.socket = new WebSocket("ws://127.0.0.1:3000/socket.io/?EIO=4&transport=websocket");
    this.ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Socket.IO connection timed out")), 5000);
      this.socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("WebSocket connection failed")); });
      this.socket.addEventListener("message", ({ data }) => {
        const packet = String(data);
        // Engine.IO v4 open/ping and Socket.IO default-namespace connect/event.
        if (packet.startsWith("0")) this.socket.send("40");
        else if (packet === "2") this.socket.send("3");
        else if (packet.startsWith("40")) {
          this.id = JSON.parse(packet.slice(2)).sid;
          clearTimeout(timeout);
          resolve();
        } else if (packet.startsWith("42")) {
          const [name, payload] = JSON.parse(packet.slice(2));
          this.events.push({ name, payload });
          this.flush();
        } else if (packet.startsWith("44")) {
          clearTimeout(timeout);
          reject(new Error(`Socket.IO rejected connection: ${packet.slice(2)}`));
        }
      });
    });
  }
  flush() {
    for (const waiter of [...this.waiters]) {
      const index = this.events.findIndex(event => event.name === waiter.name);
      if (index === -1) continue;
      clearTimeout(waiter.timer);
      this.waiters.splice(this.waiters.indexOf(waiter), 1);
      waiter.resolve(this.events.splice(index, 1)[0].payload);
    }
  }
  wait(name) {
    return new Promise((resolve, reject) => {
      const waiter = { name, resolve, timer: setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(new Error(`Timed out waiting for ${name}`));
      }, 5000) };
      this.waiters.push(waiter);
      this.flush();
    });
  }
  send(name, payload) { this.socket.send(`42${JSON.stringify([name, payload])}`); }
  close() { this.socket.close(); }
}

async function main() {
  for (let attempt = 0; ; attempt++) {
    try { assert.equal((await fetch(`${base}/healthz`)).status, 200); break; }
    catch (error) { if (attempt >= 49) throw error; await pause(100); }
  }
  for (const route of ["/", "/pilgrim-progress/", "/seventy-disciples/", "/ui-actions.js", "/socket.io/socket.io.js"]) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get("content-security-policy"), /script-src 'self'/);
  }
  for (const route of ["/server.js", "/package.json", "/online-rules.js", "/.env", "/.data/leaderboard.json", "/leaderboard.json"]) {
    assert.equal((await fetch(base + route)).status, 404, route);
  }
  const post = (body, origin = "http://localhost:3000") => fetch(`${base}/api/leaderboard`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body)
  });
  const entry = { name: "<b>text only</b>", faith: 55, rounds: 3, durationSec: 60 };
  assert.equal((await post(null)).status, 400);
  assert.equal((await post({ ...entry, rounds: "3" })).status, 400);
  assert.equal((await post(entry, "https://untrusted.invalid")).status, 403);
  assert.equal((await post({ ...entry, name: "x".repeat(3000) })).status, 413);
  assert.equal((await post(entry)).status, 200);
  const scores = await (await fetch(`${base}/api/leaderboard`)).json();
  assert.equal(scores[0].name, entry.name);
  console.log("PASS: HTTP routes, CSP, private files, score validation and writing");

  const clients = [new Client(), new Client(), new Client()];
  try {
    await Promise.all(clients.map(client => client.ready));
    const [host, guest, outsider] = clients;
    host.send("createRoom", { playerName: "甲" });
    const created = await host.wait("roomJoined");
    guest.send("joinRoom", { roomCode: created.code, playerName: "乙" });
    const joined = await host.wait("roomJoined");
    await guest.wait("roomJoined");
    assert.equal(joined.players.length, 2);
    outsider.send("createRoom", null);
    await outsider.wait("roomError");
    assert.equal((await fetch(`${base}/healthz`)).status, 200);

    host.send("startOnlineGame", { roomCode: joined.code });
    const started = await host.wait("onlineGameStarted");
    await guest.wait("onlineGameStarted");
    const action = { roomCode: started.code, turnId: started.turnId };
    guest.send("requestRoll", action);
    outsider.send("requestRoll", action);
    await pause(100);
    assert.equal(host.events.some(event => event.name === "executeRoll"), false);
    host.send("requestRoll", action);
    const roll = await host.wait("executeRoll");
    await guest.wait("executeRoll");
    const randomValues = [roll.diceVal, roll.qIdx, roll.cIdx, Number(roll.isBlessing)];
    const expected = rules.beginTurn({ players: started.players, activeIndex: 0 }, () => randomValues.shift());

    if (expected.phase === "question") {
      const chosenIdx = questions[roll.qIdx].answerIndex;
      guest.send("broadcastQuestionResult", { ...action, chosenIdx });
      await pause(100);
      assert.equal(host.events.some(event => event.name === "showQuestionResult"), false);
      host.send("broadcastQuestionResult", { ...action, chosenIdx });
      await host.wait("showQuestionResult");
      await guest.wait("showQuestionResult");
      rules.answerQuestion(expected, chosenIdx);
      host.send("broadcastQuestionResult", { ...action, chosenIdx });
      await pause(100);
      assert.equal(host.events.some(event => event.name === "showQuestionResult"), false);
    }
    if (expected.phase === "resolve") {
      host.send("broadcastResolveStep", { ...action, stepType: "invalid" });
      await pause(100);
      assert.equal(host.events.some(event => event.name === "executeResolveStep"), false);
      host.send("broadcastResolveStep", { ...action, stepType: expected.stepType });
      await host.wait("executeResolveStep");
      await guest.wait("executeResolveStep");
      rules.resolveStep(expected);
    }
    host.send("finishTurnAction", { ...action,
      playersState: [{ position: 70, faith: 999999, name: "forged" }], firstFinished: true });
    const next = await host.wait("syncNextTurn");
    await guest.wait("syncNextTurn");
    assert.deepEqual(next.playersState, expected.players);
    assert.equal(next.firstFinished, false);
    assert.notEqual(next.turnId, action.turnId);
    guest.send("requestRoll", { roomCode: action.roomCode, turnId: action.turnId });
    await pause(100);
    assert.equal(host.events.some(event => event.name === "executeRoll"), false);
    guest.send("requestRoll", { roomCode: action.roomCode, turnId: next.turnId });
    await host.wait("executeRoll");
    const closed = host.wait("roomClosed");
    guest.close();
    assert.equal(typeof await closed, "string");
    console.log("PASS: multiplayer, malformed input, permissions, replay rejection and authoritative state");
  } finally {
    clients.forEach(client => client.close());
  }
}

const watchdog = setTimeout(() => { console.error("Smoke checks exceeded 30 seconds"); process.exit(1); }, 30000);
main().then(() => { clearTimeout(watchdog); console.log("All container smoke checks passed"); })
  .catch(error => { console.error(error); process.exitCode = 1; clearTimeout(watchdog); });
