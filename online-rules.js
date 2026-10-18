// Mirror the existing client rules. Online outcomes are calculated here, never
// accepted from playersState supplied by a browser.
const board = require("./pilgrim-progress/board_config.json");
const questions = require("./pilgrim-progress/questions.json");
const cards = require("./pilgrim-progress/cards.json");
const { randomInt } = require("crypto");

function checkFaith(player) {
  if (player.faith <= 0) {
    player.faith = 0;
    player.isFasting = true;
  }
}

function offset(player, steps) {
  player.position = Math.max(1, Math.min(70, player.position + steps));
}

function sameTile(turn) {
  const player = turn.players[turn.activeIndex];
  const others = turn.players.filter(p => p.id !== player.id && p.position === player.position && p.position < 70);
  if (others.length && turn.roll.isBlessing) {
    player.faith += 8;
    others.forEach(p => { p.faith += 8; });
  } else {
    others.forEach(p => {
      p.faith -= 10;
      offset(p, -1);
      checkFaith(p);
    });
  }
  turn.phase = "finish";
}

function beginTurn(room, random = randomInt) {
  const turn = {
    activeIndex: room.activeIndex,
    players: room.players.map(p => ({ ...p })),
    roll: {
      diceVal: random(1, 7),
      qIdx: random(questions.length),
      cIdx: random(cards.length),
      isBlessing: random(2) === 1
    }
  };
  const player = turn.players[turn.activeIndex];
  if (player.isFasting) {
    player.faith = 10;
    player.isFasting = false;
    turn.phase = "finish";
    return turn;
  }
  offset(player, turn.roll.diceVal);
  if (player.position === 70) {
    player.hasReachedGoal = true;
    sameTile(turn);
    return turn;
  }
  const pos = player.position;
  if (board.ladders.some(l => l.from === pos)) turn.stepType = "ladder";
  else if (board.snakes.some(s => s.from === pos)) turn.stepType = "snake";
  else if (board.sabbathTiles.includes(pos)) turn.stepType = "sabbath";
  else if (board.eventTiles.includes(pos)) turn.stepType = "card";
  else {
    turn.phase = "question";
    return turn;
  }
  turn.phase = "resolve";
  return turn;
}

function answerQuestion(turn, chosenIdx) {
  if (turn.phase !== "question") return false;
  const question = questions[turn.roll.qIdx];
  if (!Number.isInteger(chosenIdx) || chosenIdx < 0 || chosenIdx >= question.options.length) return false;
  const player = turn.players[turn.activeIndex];
  if (chosenIdx === question.answerIndex) player.faith += 5;
  else {
    player.faith -= 15;
    offset(player, -1);
    checkFaith(player);
  }
  turn.stepType = "afterQuestion";
  turn.phase = "resolve";
  return true;
}

function resolveStep(turn) {
  if (turn.phase !== "resolve") return false;
  const player = turn.players[turn.activeIndex];
  if (turn.stepType === "ladder") player.position = board.ladders.find(l => l.from === player.position).to;
  else if (turn.stepType === "snake") player.position = board.snakes.find(s => s.from === player.position).to;
  else if (turn.stepType === "card") {
    const card = cards[turn.roll.cIdx];
    player.faith += card.faithChange;
    offset(player, card.stepChange);
    checkFaith(player);
  }
  sameTile(turn);
  return true;
}

module.exports = { beginTurn, answerQuestion, resolveStep };
