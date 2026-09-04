import assert from "node:assert/strict";
import test from "node:test";
import { COLORS, WIN_SCORE, buyCard, createGame, evolveCard, reserveCard, takeTokens } from "../rules.js";

test("sets up the five Pokémon card markets and player-count token supply", () => {
  for (const [players, supply] of [[2, 4], [3, 5], [4, 7]]) {
    const game = createGame(players, () => 0.5);
    assert.deepEqual(game.bank, { red: supply, blue: supply, yellow: supply, green: supply, black: supply, wild: 7 });
    assert.deepEqual(Object.fromEntries(Object.entries(game.market).map(([tier, cards]) => [tier, cards.length])), { 1: 4, 2: 4, 3: 4, rare: 2, legend: 2 });
    assert.deepEqual(Object.fromEntries(Object.entries(game.decks).map(([tier, cards]) => [tier, cards.length])), { 1: 31, 2: 26, 3: 11, rare: 3, legend: 3 });
  }
});

test("permits fewer than three different balls when supply is depleted", () => {
  const game = createGame(2, () => 0.5);
  game.bank.red = 1;
  game.bank.blue = 2;
  const action = takeTokens(game, 0, ["red", "blue"]);
  assert.equal(action.ok, true);
  assert.equal(game.players[0].tokens.red, 1);
  assert.equal(game.players[0].tokens.blue, 1);
  assert.equal(game.active, 1);
});

test("forbids reserving rare and legendary cards", () => {
  const game = createGame(2, () => 0.5);
  assert.equal(reserveCard(game, 0, "rare", game.market.rare[0].id).ok, false);
  assert.equal(reserveCard(game, 0, "legend", game.market.legend[0].id).ok, false);
});

test("evolution charges a discounted cost and awards points and bonuses", () => {
  const game = createGame(2, () => 0.5);
  const player = game.players[0];
  const card = game.market[2].find((c) => c.stage === 2);
  player.cards.push({ line: card.line, stage: 1, bonus: "red", points: 0 });
  COLORS.forEach((color) => {
    player.bonuses[color] = Math.max(0, card.cost[color] - 2);
    player.tokens[color] = card.cost[color] > player.bonuses[color] ? 1 : 0;
  });
  const spentBefore = COLORS.reduce((sum, c) => sum + player.tokens[c], 0);

  takeTokens(game, 0, ["red"]);
  assert.equal(game.pending?.type, "evolution");
  assert.ok(game.pending.choices.includes(card.id));

  const before = { score: player.score, bonus: player.bonuses[card.bonus] };
  assert.equal(evolveCard(game, 0, card.id).ok, true);

  assert.equal(player.score, before.score + card.points);
  assert.equal(player.bonuses[card.bonus], before.bonus + card.bonusCount);
  assert.equal(player.evolutions.length, 1);
  assert.ok(COLORS.reduce((sum, c) => sum + player.tokens[c], 0) < spentBefore + 1);
  assert.equal(game.active, 1);
});

test("gives every player a fresh evolution opportunity after one evolves", () => {
  const game = createGame(2, () => 0.5);
  game.evolvedThisTurn = true;
  takeTokens(game, 0, ["red", "blue", "green"]);
  assert.equal(game.evolvedThisTurn, false, "진화 플래그가 다음 플레이어로 새지 않아야 한다");
});

test("restricts master balls to rare and legendary captures", () => {
  const game = createGame(2, () => 0.5);
  const player = game.players[0];
  const normal = game.market[1][0];
  player.tokens.wild = 5;
  COLORS.forEach((color) => { player.tokens[color] = Math.max(0, normal.cost[color] - 1); });
  const blocked = buyCard(game, 0, normal.id);
  assert.equal(blocked.ok, false, "일반 카드는 마스터볼로 부족분을 메울 수 없다");

  const special = game.market.legend[0];
  COLORS.forEach((color) => { player.tokens[color] = special.cost[color]; });
  player.tokens.wild = 1;
  assert.equal(buyCard(game, 0, special.id).ok, true);
  assert.equal(player.tokens.wild, 0, "포획에 마스터볼 1개를 소모한다");
});

test("triggers the final round at the win score", () => {
  const game = createGame(2, () => 0.5);
  assert.ok(WIN_SCORE > 0);
  const player = game.players[0];
  const card = game.market[3].reduce((best, c) => (c.points > best.points ? c : best), game.market[3][0]);
  player.score = WIN_SCORE - card.points;
  COLORS.forEach((color) => { player.tokens[color] = card.cost[color]; });
  assert.equal(buyCard(game, 0, card.id).ok, true);
  assert.equal(game.players[0].score >= WIN_SCORE, true);
  assert.equal(game.finalRoundPlayer, 0);
});

test("assigns requested trainers, their starting bonus, and reveals playerCount+1 badges", () => {
  const game = createGame(3, () => 0.5, ["ash", "misty", "brock"]);
  assert.deepEqual(game.players.map((p) => p.trainerId), ["ash", "misty", "brock"]);
  assert.equal(game.players[0].bonuses.yellow, 1, "지우는 퀵볼 보너스로 시작한다");
  assert.equal(game.players[1].bonuses.blue, 1);
  assert.equal(game.players[2].bonuses.black, 1);
  assert.equal(game.badges.length, 4);
  assert.ok(game.badges.every((b) => b.owner === null));

  const auto = createGame(4, () => 0.5);
  assert.equal(new Set(auto.players.map((p) => p.trainerId)).size, 4, "트레이너는 중복 배정되지 않는다");
});

test("awards a gym badge automatically when its bonus requirement is met", () => {
  const game = createGame(2, () => 0.5, ["ash", "misty"]);
  const badge = game.badges[0];
  const player = game.players[0];
  COLORS.forEach((color) => { player.bonuses[color] = badge.need[color] || 0; });

  takeTokens(game, 0, ["red", "blue", "green"]);
  assert.equal(player.badges.length, 1, "차례 종료 시 배지를 자동 획득한다");
  assert.equal(player.badges[0].id, badge.id);
  assert.equal(player.score, badge.points);
  assert.equal(game.badges[0].owner, 0);

  // 이미 주인이 있는 배지는 다른 플레이어가 가져갈 수 없다
  const rival = game.players[1];
  COLORS.forEach((color) => { rival.bonuses[color] = badge.need[color] || 0; });
  takeTokens(game, 1, ["red", "blue", "black"]);
  assert.ok(!rival.badges.some((b) => b.id === badge.id), "선점된 배지는 다시 획득할 수 없다");
});

test("applies trainer perks: reserve limit, master ball grant, and token limit", () => {
  const sabrina = createGame(2, () => 0.5, ["sabrina", "ash"]);
  for (let i = 0; i < 4; i += 1) {
    const res = reserveCard(sabrina, 0, 1, sabrina.market[1][0].id);
    assert.equal(res.ok, true, `나츠메는 ${i + 1}장째도 보관할 수 있어야 한다`);
    sabrina.active = 0;
    sabrina.pending = null;
  }
  assert.equal(sabrina.players[0].reserved.length, 4);

  const ash = createGame(2, () => 0.5, ["ash", "misty"]);
  reserveCard(ash, 0, 1, ash.market[1][0].id);
  assert.equal(ash.players[0].tokens.wild, 2, "지우는 보관 시 마스터볼 2개를 받는다");

  const brock = createGame(2, () => 0.5, ["brock", "misty"]);
  COLORS.forEach((color) => { brock.players[0].tokens[color] = 2; });
  takeTokens(brock, 0, ["red", "blue"]);
  assert.equal(brock.pending, null, "웅이는 12개까지 보유해도 반납이 필요 없다");
});
