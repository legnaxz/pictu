import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import playwright from "/Users/legnaxz/.codex/skills/develop-web-game/node_modules/playwright/index.js";

import { TUTORIAL_STEPS } from "../tutorial.js";

test("tutorial modal opens from home screen, traverses every step, and launches game", async () => {
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
    const page = await browser.newPage();
    await page.goto("http://127.0.0.1:4174", { waitUntil: "networkidle" });

    // Verify tutorial button on home setup screen
    const tutorialBtn = await page.$("#start-tutorial");
    assert.ok(tutorialBtn, "Home screen should have #start-tutorial button");

    // Click to open tutorial
    await page.click("#start-tutorial");
    let modal = await page.$("#tut-overlay");
    assert.ok(modal, "Tutorial modal should be open");

    // Check step 1 title
    let title = await page.textContent("#tut-title");
    assert.match(title, /게임의 목표/);

    // 마지막 단계까지 이동
    for (let s = 1; s < TUTORIAL_STEPS.length; s++) {
      await page.click("#tut-next");
    }

    // 마지막 단계
    title = await page.textContent("#tut-title");
    assert.match(title, /게임 종료 및 최종 승자 판정/);

    // Click finish button to start solo game
    const finishBtn = await page.$("#tut-finish");
    assert.ok(finishBtn, "마지막 단계에는 #tut-finish 버튼이 있어야 한다");
    await page.click("#tut-finish");

    // Modal should close and board should render
    modal = await page.$("#tut-overlay");
    assert.equal(modal, null, "Modal should be closed");

    const boardGame = await page.$(".board-layout");
    assert.ok(boardGame, "Board game should be rendered after completing tutorial");

    // Open rulebook during game
    const rulebookBtn = await page.$("#open-rulebook");
    assert.ok(rulebookBtn, "Board should have #open-rulebook button");
    await page.click("#open-rulebook");

    modal = await page.$("#tut-overlay");
    assert.ok(modal, "Rulebook modal should open during game");

    // Close modal
    await page.click("#tut-close");
    modal = await page.$("#tut-overlay");
    assert.equal(modal, null, "Modal should close on #tut-close");
  } finally {
    await browser.close();
    if (serverProcess) serverProcess.kill();
  }
});
