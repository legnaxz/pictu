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
