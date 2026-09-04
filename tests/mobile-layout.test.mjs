import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import playwright from "/Users/legnaxz/.codex/skills/develop-web-game/node_modules/playwright/index.js";

test("mobile responsive layout supports tabs and bottom floating action dock", async () => {
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
    // iPhone 13 viewport (390 x 844)
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true
    });
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:4174", { waitUntil: "networkidle" });

    // Click solo game
    await page.click("#solo");

    // Check that mobile nav tabs are visible
    const mobileNavVisible = await page.isVisible(".mobile-nav");
    assert.equal(mobileNavVisible, true, "Mobile nav tabs should be visible on mobile viewport");

    // Check bottom dock is visible
    const bottomDockVisible = await page.isVisible(".bottom-dock");
    assert.equal(bottomDockVisible, true, "Bottom action dock should be visible on mobile viewport");

    // Switch to Supply tab
    await page.click("[data-mtab='supply']");
    const isSupplyVisible = await page.isVisible(".supply-box");
    assert.equal(isSupplyVisible, true, "Supply box should be visible when supply tab is clicked");

    // Select tokens
    await page.click("[data-token='red']");
    await page.click("[data-token='blue']");

    // Check dock has updated selection
    const dockText = await page.textContent(".dock-selected-tokens");
    assert.match(dockText, /몬스터볼/);
    assert.match(dockText, /슈퍼볼/);

    // Switch back to Market tab
    await page.click("[data-mtab='market']");
    const isMarketVisible = await page.isVisible(".table-area");
    assert.equal(isMarketVisible, true, "Market should be visible when market tab is active");
  } finally {
    await browser.close();
    if (serverProcess) serverProcess.kill();
  }
});

test("mobile supports one-handed play with a bottom ball tray and card sheet", async () => {
  let serverProcess = null;
  try {
    await fetch("http://127.0.0.1:4174");
  } catch {
    serverProcess = spawn("node", ["local-server.mjs"], { stdio: "ignore" });
    for (let i = 0; i < 40; i++) {
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
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("http://127.0.0.1:4174", { waitUntil: "networkidle" });
    await page.click("#solo");
    await page.waitForTimeout(600);

    // 볼 트레이가 하단(엄지 영역)에 상시 노출된다
    const tray = await page.$$(".tray-ball");
    assert.equal(tray.length, 5, "5색 볼이 하단 트레이에 항상 보여야 한다");

    const viewport = page.viewportSize();
    const trayBox = await tray[0].boundingBox();
    assert.ok(
      trayBox.y > viewport.height * 0.6,
      `트레이는 한 손으로 닿는 화면 아래쪽에 있어야 한다 (실제 y=${Math.round(trayBox.y)})`
    );
    assert.ok(trayBox.height >= 44, `터치 목표는 충분히 커야 한다 (실제 ${Math.round(trayBox.height)}px)`);

    // 탭 전환 없이 트레이에서 바로 볼을 고를 수 있다
    await page.click(".tray-ball:not([disabled])");
    await page.waitForTimeout(150);
    assert.equal(await page.$$eval(".tray-picked", (els) => els.length), 1, "선택한 볼에 표시가 붙는다");
    const dockText = await page.textContent(".dock-selected-tokens");
    assert.ok(!dockText.includes("없음"), "선택한 볼이 하단에 요약된다");

    await page.click("#clear-tokens");
    await page.waitForTimeout(150);
    assert.equal(await page.$$eval(".tray-picked", (els) => els.length), 0, "선택 해제가 동작한다");

    // 카드를 누르면 큰 버튼이 달린 바텀시트가 올라온다
    await page.click(".card");
    await page.waitForSelector(".card-sheet", { timeout: 3000 });
    const buy = await page.$(".sheet-btn.buy");
    const buyBox = await buy.boundingBox();
    assert.ok(buyBox.height >= 44, `시트의 잡기 버튼은 충분히 커야 한다 (실제 ${Math.round(buyBox.height)}px)`);
    assert.ok(
      buyBox.y > viewport.height * 0.6,
      "시트 버튼도 엄지가 닿는 아래쪽에 있어야 한다"
    );

    await page.click("#card-sheet-close");
    await page.waitForTimeout(200);
    assert.equal(await page.$(".card-sheet"), null, "시트를 닫을 수 있다");

    // 내 상태 요약 바가 상단에 고정되어 항상 보인다
    assert.equal(await page.isVisible(".mobile-me"), true, "내 점수·보너스 요약이 보여야 한다");

    assert.deepEqual(errors, [], "브라우저 에러가 없어야 한다");
  } finally {
    await browser.close();
    if (serverProcess) serverProcess.kill();
  }
});
