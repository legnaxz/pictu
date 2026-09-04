import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import playwright from "/Users/legnaxz/.codex/skills/develop-web-game/node_modules/playwright/index.js";

test("solo CPU mode supports 2-4 players, difficulty switching, and auto turn execution", async () => {
  let serverProcess = null;
  try {
    await fetch("http://127.0.0.1:4174");
  } catch {
    serverProcess = spawn("node", ["local-server.mjs"], { stdio: "ignore" });
    for (let i = 0; i < 30; i++) {
      try {
        await fetch("http://127.0.0.1:4174");
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }

  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:4174", { waitUntil: "networkidle" });

    // 1. Check Solo config elements exist on home setup
    assert.equal(await page.isVisible("#solo"), true);
    assert.equal(await page.isVisible("[data-solo-count='3']"), true);
    assert.equal(await page.isVisible("[data-solo-diff='advanced']"), true);

    // 2. Select 3 players and Advanced difficulty
    await page.click("[data-solo-count='3']");
    await page.click("[data-solo-diff='advanced']");

    const soloBtnText = await page.textContent("#solo");
    assert.match(soloBtnText, /3인 대전/);
    assert.match(soloBtnText, /고급/);

    // 3. Start Solo Game
    await page.click("#solo");

    // Check header displays CPU battle info
    const badgeText = await page.textContent(".rule-badge");
    assert.match(badgeText, /CPU 대전/);
    assert.match(badgeText, /3인/);

    // Check player cards: 3 players rendered
    const playerCards = await page.$$(".trainer-card");
    assert.equal(playerCards.length, 3);

    // Player 1 should have (나)
    const p1Text = await playerCards[0].textContent();
    assert.match(p1Text, /나/);

    // Player 2 and 3 should have CPU difficulty tags
    const p2Text = await playerCards[1].textContent();
    assert.match(p2Text, /고급/);

    // 4. Human player takes tokens
    await page.click("[data-token='red']");
    await page.click("[data-token='blue']");
    await page.click("[data-token='yellow']");
    await page.click("#take-tokens");

    // 5. Wait for CPU 1 and CPU 2 turns to execute automatically
    // The active turn should transition through CPU players and return to Player 1 (Round 2)
    // Wait up to 5 seconds for turn transitions
    // 사람 플레이어는 선택한 트레이너(기본 지우)의 이름으로 표시된다
    await page.waitForFunction(() => {
      const el = document.querySelector(".status-badge");
      return el && el.textContent.includes("2R");
    }, { timeout: 6000 });

    const updatedTurnText = await page.textContent(".status-badge");
    // 내 차례는 이름 대신 "내 차례"로 분명히 표시한다
    assert.match(updatedTurnText, /내 차례/);
    const myCard = await page.textContent(".trainer-card");
    assert.match(myCard, /\(나\)/, "내 자리에는 (나) 표시가 붙는다");

    // Check game log mentions CPU action
    const logText = await page.textContent(".game-log-box");
    assert.match(logText, /🤖/);

  } finally {
    await browser.close();
    if (serverProcess) serverProcess.kill();
  }
});
