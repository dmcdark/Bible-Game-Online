const { test } = require("node:test");
const assert = require("node:assert/strict");
const rules = require("../online-rules");
const questions = require("../pilgrim-progress/questions.json");
const cards = require("../pilgrim-progress/cards.json");

function room(position = 1) {
  return { activeIndex: 0, players: [{ id: 0, socketId: "first", name: "甲", color: "#c92a2a",
    position, faith: 50, isFasting: false, hasReachedGoal: false }] };
}
function roll(dice = 1, card = 0, blessing = 1) {
  const values = [dice, 0, card, blessing];
  return () => values.shift();
}

test("rolling leaves committed room state untouched until turn completion", () => {
  const source = room();
  const before = JSON.stringify(source);
  const turn = rules.beginTurn(source, roll());
  assert.equal(turn.players[0].position, 2);
  assert.equal(turn.phase, "question");
  assert.equal(JSON.stringify(source), before);
});

test("an invalid answer cannot advance a turn or modify faith", () => {
  const turn = rules.beginTurn(room(), roll());
  for (const answer of [-1, 99, "0", null, {}, 0.5]) {
    const before = JSON.stringify(turn);
    assert.equal(rules.answerQuestion(turn, answer), false);
    assert.equal(JSON.stringify(turn), before);
  }
});

test("correct and wrong answers follow existing faith and movement rules", () => {
  const correct = questions[0].answerIndex;
  const turn = rules.beginTurn(room(), roll());
  assert.equal(rules.answerQuestion(turn, correct), true);
  assert.equal(turn.players[0].faith, 55);
  assert.equal(turn.phase, "resolve");
  assert.equal(rules.answerQuestion(turn, correct), false);
  rules.resolveStep(turn);
  assert.equal(turn.phase, "finish");
  const committed = JSON.stringify(turn);
  assert.equal(rules.resolveStep(turn), false);
  assert.equal(JSON.stringify(turn), committed);
  const wrong = rules.beginTurn(room(), roll());
  rules.answerQuestion(wrong, (correct + 1) % questions[0].options.length);
  assert.equal(wrong.players[0].faith, 35);
  assert.equal(wrong.players[0].position, 1);
});

test("ladders, snakes and sabbath select only their expected resolution", () => {
  for (const [start, kind, end] of [[5, "ladder", 18], [23, "snake", 11], [9, "sabbath", 10]]) {
    const turn = rules.beginTurn(room(start), roll());
    assert.equal(turn.stepType, kind);
    assert.equal(turn.phase, "resolve");
    rules.resolveStep(turn);
    assert.equal(turn.players[0].position, end);
    assert.equal(turn.phase, "finish");
  }
});

test("cards use the server-selected card and clamp movement", () => {
  cards.forEach((card, index) => {
    const turn = rules.beginTurn(room(3), roll(1, index));
    assert.equal(turn.stepType, "card");
    rules.resolveStep(turn);
    assert.equal(turn.players[0].position, Math.max(1, Math.min(70, 4 + card.stepChange)));
    assert.equal(turn.players[0].faith, Math.max(0, 50 + card.faithChange));
  });
});

test("fasting restores faith and skips movement and same-tile effects", () => {
  const source = room();
  source.players[0].faith = 0;
  source.players[0].isFasting = true;
  const turn = rules.beginTurn(source, roll(6));
  assert.equal(turn.players[0].position, 1);
  assert.equal(turn.players[0].faith, 10);
  assert.equal(turn.players[0].isFasting, false);
  assert.equal(turn.phase, "finish");
});

test("same-tile blessing and trials affect the correct players once", () => {
  for (const blessing of [0, 1]) {
    const source = room(9);
    source.players.push({ ...source.players[0], id: 1, socketId: "second", position: 10, faith: 5 });
    const turn = rules.beginTurn(source, roll(1, 0, blessing));
    rules.resolveStep(turn);
    assert.equal(turn.players[0].faith, blessing ? 58 : 50);
    assert.equal(turn.players[1].faith, blessing ? 13 : 0);
    assert.equal(turn.players[1].position, blessing ? 10 : 9);
    assert.equal(turn.players[1].isFasting, !blessing);
  }
});

test("the goal clamps to 70 and records round-end victory", () => {
  const turn = rules.beginTurn(room(69), roll(6));
  assert.equal(turn.players[0].position, 70);
  assert.equal(turn.players[0].hasReachedGoal, true);
  assert.equal(turn.phase, "finish");
});
