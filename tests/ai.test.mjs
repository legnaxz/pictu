import assert from "node:assert/strict";
import test from "node:test";
import { createGame } from "../rules.js";
import { AI_PROFILES, chooseCpuAction, chooseEvolutionAction, chooseReturnAction, getLegalTokenChoices } from "../ai.js";

test("getLegalTokenChoices returns valid 3-color and 2-color selections", () => {
  const bank = { red: 4, blue: 4, yellow: 2, green: 0, black: 0, wild: 5 };
  const choices = getLegalTokenChoices(bank);
  assert.ok(choices.some((c) => c.length === 2 && c[0] === "red" && c[1] === "red"));
  assert.ok(choices.some((c) => c.length === 2 && c[0] === "blue" && c[1] === "blue"));
  assert.ok(choices.some((c) => c.length === 3 && c.includes("red") && c.includes("blue") && c.includes("yellow")));
});

test("chooseCpuAction produces legal actions across all difficulty profiles", () => {
  for (const profileId of Object.keys(AI_PROFILES)) {
    const game = createGame(2, () => 0.5);
    const action = chooseCpuAction(game, 1, profileId);
    assert.ok(action, "Action must exist for profile " + profileId);
    assert.ok(["buy", "reserve", "take", "pass"].includes(action.action));

    if (action.action === "take") {
      assert.ok(Array.isArray(action.colors) && action.colors.length >= 1 && action.colors.length <= 3);
    }
  }
});

test("CPU correctly chooses evolution when available", () => {
  const game = createGame(2, () => 0.5);
  const pichu = { id: "1-1", name: "피츄", tier: 1, stage: 1, line: "피츄/피카츄/라이츄", bonus: "yellow", bonusCount: 1, points: 0, cost: {}, kind: "normal" };
  const pikachu = { id: "2-1", name: "피카츄", tier: 2, stage: 2, line: "피츄/피카츄/라이츄", bonus: "yellow", bonusCount: 1, points: 2, cost: { yellow: 2 }, kind: "normal" };
  game.players[1].cards.push(pichu);
  game.market[2][0] = pikachu;
  game.pending = { type: "evolution", player: 1, choices: [pikachu.id] };

  const evoAction = chooseEvolutionAction(game, 1, AI_PROFILES.brock);
  assert.equal(evoAction.action, "evolve");
  assert.equal(evoAction.cardId, pikachu.id);
});

test("CPU correctly chooses excess tokens to return down to 10", () => {
  const game = createGame(2, () => 0.5);
  game.players[1].tokens = { red: 4, blue: 4, yellow: 4, green: 0, black: 0, wild: 0 };
  game.pending = { type: "return", player: 1, count: 2 };

  const retAction = chooseReturnAction(game, 1, AI_PROFILES.cynthia);
  assert.equal(retAction.action, "return");
  const totalReturned = Object.values(retAction.tokens).reduce((s, v) => s + v, 0);
  assert.equal(totalReturned, 2);
});
