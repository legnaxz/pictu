import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import playwright from "/Users/legnaxz/.codex/skills/develop-web-game/node_modules/playwright/index.js";

async function startServer() {
  try {
    await fetch("http://127.0.0.1:4174");
    return null;
  } catch {
    const proc = spawn("node", ["local-server.mjs"], { stdio: "ignore" });
    for (let i = 0; i < 40; i++) {
      try {
        await fetch("http://127.0.0.1:4174");
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    return proc;
  }
}

test("online seat survives a disconnect and catches up within a second", async () => {
  const server = await startServer();
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const hostCtx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
    const guestCtx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    const errors = [];
    for (const [name, page] of [["host", host], ["guest", guest]]) {
      page.on("pageerror", (e) => errors.push(`${name}: ${e}`));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(`${name}: ${m.text()}`);
      });
    }

    await host.goto("http://127.0.0.1:4174", { waitUntil: "networkidle" });
    await host.click('[data-count="2"]');
    await host.click("#start");
    await host.waitForFunction(() => localStorage.getItem("splendor-pokemon-session") !== null, { timeout: 5000 });
    const saved = await host.evaluate(() => JSON.parse(localStorage.getItem("splendor-pokemon-session")));
    assert.ok(saved.token, "호스트는 재접속용 토큰을 받아 저장해야 한다");

    await guest.goto("http://127.0.0.1:4174", { waitUntil: "networkidle" });
    await guest.fill("#room-code", saved.code);
    await guest.click("#join");
    await guest.waitForFunction(() => JSON.parse(window.render_game_to_text()).mode === "playing", { timeout: 8000 });

    const guestSeat = await guest.evaluate(() => JSON.parse(localStorage.getItem("splendor-pokemon-session")).seat);
    assert.equal(guestSeat, 1, "게스트는 1번 자리를 받는다");

    const snap = (page) => page.evaluate(() => JSON.parse(window.render_game_to_text()));

    // 게스트를 네트워크에서 떼어낸다
    await guestCtx.setOffline(true);
    const stale = await snap(guest);

    // 그 사이 호스트가 자기 차례에 행동해 상태를 바꾼다
    let changed = false;
    for (let i = 0; i < 10 && !changed; i++) {
      const st = await snap(host);
      if (st.activePlayer === st.scores[0].name && !st.pending) {
        changed = await host.evaluate(() => {
          const buttons = [...document.querySelectorAll("[data-token]")].filter((b) => !b.disabled).slice(0, 3);
          if (!buttons.length) return false;
          buttons.forEach((b) => b.click());
          const take = document.querySelector("#take-tokens");
          if (take && !take.disabled) {
            take.click();
            return true;
          }
          return false;
        });
      }
      await host.waitForTimeout(250);
    }
    assert.ok(changed, "호스트가 상태를 바꿀 수 있어야 한다");

    const advanced = await snap(host);
    assert.notDeepEqual(stale.bank, advanced.bank, "끊긴 게스트는 뒤처진 상태여야 한다");

    // 게스트 복귀: 1초 안에 따라잡아야 한다
    const startedAt = Date.now();
    await guestCtx.setOffline(false);
    await guest.evaluate(() => window.dispatchEvent(new Event("online")));
    await guest.waitForFunction(
      (expected) => JSON.stringify(JSON.parse(window.render_game_to_text()).bank) === expected,
      JSON.stringify(advanced.bank),
      { timeout: 5000 }
    );
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed < 1000, `복구는 1초 안에 끝나야 한다 (실제 ${elapsed}ms)`);

    const recovered = await snap(guest);
    assert.deepEqual(recovered.bank, advanced.bank, "복구 후 상태가 완전히 일치해야 한다");
    assert.equal(
      await guest.evaluate(() => JSON.parse(localStorage.getItem("splendor-pokemon-session")).seat),
      1,
      "복구 후에도 원래 자리를 유지해야 한다"
    );

    assert.deepEqual(errors, [], "브라우저 에러가 없어야 한다");
  } finally {
    await browser.close();
    if (server) server.kill();
  }
});

test("audio preferences are per-device and survive a reload", async () => {
  const server = await startServer();
  const browser = await playwright.chromium.launch({
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  try {
    const first = await browser.newContext();
    const second = await browser.newContext();
    const a = await first.newPage();
    const b = await second.newPage();

    for (const page of [a, b]) {
      await page.addInitScript(() => {
        window.__osc = 0;
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return;
        const original = Ctor.prototype.createOscillator;
        Ctor.prototype.createOscillator = function patched(...args) {
          window.__osc += 1;
          return original.apply(this, args);
        };
      });
      await page.goto("http://127.0.0.1:4174", { waitUntil: "networkidle" });
      await page.click("#solo");
    }

    // BGM은 게임이 시작되면 저절로 흐른다 (오디오 초기화는 환경에 따라 지연될 수 있다)
    await a.waitForFunction(() => window.__osc > 0, { timeout: 8000 });
    await b.waitForFunction(() => window.__osc > 0, { timeout: 8000 });

    // A만 소리를 끈다
    await a.click("#open-settings");
    await a.waitForSelector(".settings-sheet");
    await a.click('[data-audio="bgm"]');
    await a.click('[data-audio="sfx"]');
    const aPrefs = await a.evaluate(() => JSON.parse(localStorage.getItem("splendor-pokemon-audio")));
    assert.deepEqual(aPrefs, { sfx: false, bgm: false });

    // B(다른 트레이너)는 영향을 받지 않아야 한다
    const bPrefs = await b.evaluate(() => localStorage.getItem("splendor-pokemon-audio"));
    assert.equal(bPrefs, null, "다른 트레이너의 설정은 건드리지 않는다");

    // B는 계속 소리가 나야 한다: 끄지 않았으므로 BGM 루프가 이어진다
    const bBefore = await b.evaluate(() => window.__osc);
    await b.waitForFunction((prev) => window.__osc > prev, bBefore, { timeout: 12000 });

    // 새로고침해도 A의 설정은 유지된다
    await a.reload({ waitUntil: "networkidle" });
    const afterReload = await a.evaluate(() => JSON.parse(localStorage.getItem("splendor-pokemon-audio")));
    assert.deepEqual(afterReload, { sfx: false, bgm: false }, "설정은 세션을 넘어 유지된다");
  } finally {
    await browser.close();
    if (server) server.kill();
  }
});
