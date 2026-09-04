import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import playwright from "/Users/legnaxz/.codex/skills/develop-web-game/node_modules/playwright/index.js";

test("keeps rendered card images mounted while selecting a ball", async () => {
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
    await page.click("#solo");
    await page.evaluate(() => { window.__uiProbe = document.querySelector(".card img"); });
    await page.click("[data-token=red]");
    const preserved = await page.evaluate(() => document.querySelector(".card img") === window.__uiProbe);
    assert.equal(preserved, true);
  } finally {
    await browser.close();
    if (serverProcess) serverProcess.kill();
  }
});
