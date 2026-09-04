import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import playwright from "/Users/legnaxz/.codex/skills/develop-web-game/node_modules/playwright/index.js";

test("plays effects for actions and shows the win/lose result screen", async () => {
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
    // 사운드 재생 여부는 확인하지만, fx.js의 파티클 애니메이션은 자체적으로 Math.random()을 소비해
    // 실제 경과 시간에 따라 게임 로직의 시드 난수 소비 순서까지 흔들어 놓는다.
    // reducedMotion으로 애니메이션 경로를 끄면 시드가 게임 진행만 결정하게 되어 완전히 재현 가능해진다.
    const page = await browser.newPage({ viewport: { width: 1400, height: 950 }, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    await page.goto("http://127.0.0.1:4174", { waitUntil: "networkidle" });

    // 오디오 호출을 가로채 실제로 재생 요청이 나가는지 확인하고,
    // Math.random을 고정 시드 PRNG로 바꿔 카드 셔플을 결정적으로 만든다.
    // (진짜 무작위 셔플에 의존하면 완주까지 걸리는 시간이 크게 흔들려 이 E2E 테스트가 들쭉날쭉해진다)
    await page.addInitScript((seed) => {
      window.__osc = 0;
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (Ctor) {
        const original = Ctor.prototype.createOscillator;
        Ctor.prototype.createOscillator = function patched(...args) {
          window.__osc += 1;
          return original.apply(this, args);
        };
      }
      let state = seed >>> 0;
      Math.random = function seeded() {
        state |= 0;
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }, 20260904);
    await page.reload({ waitUntil: "networkidle" });

    await page.click('[data-trainer="ash"]');
    await page.click('[data-solo-count="2"]');
    // 테스트는 CPU 진행 속도와 무관하게 동작을 검증하므로 가장 빠른 속도로 실행 시간을 줄인다
    await page.click('[data-solo-speed="fast"]');
    await page.click("#solo");
    await page.waitForTimeout(900);

    assert.ok(await page.$("#toggle-sound"), "음소거 토글 버튼이 있어야 한다");

    // 볼을 고르면 선택음이 난다
    await page.click('[data-token="red"]');
    await page.waitForTimeout(150);
    const afterPick = await page.evaluate(() => window.__osc);
    assert.ok(afterPick > 0, "볼 선택 시 사운드가 재생되어야 한다");

    // 게임을 끝까지 진행시켜 결과 화면을 확인한다
    const deadline = Date.now() + 200000;
    while (Date.now() < deadline) {
      const st = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
      if (st.winner !== null && st.winner !== undefined) break;
      if (st.pending?.type === "evolution") {
        const choice = await page.$(".evolution-panel .btn-choice-card:not([disabled])");
        if (choice) await choice.click();
        else await page.click('[data-evolve="skip"]').catch(() => {});
        await page.waitForTimeout(160);
        continue;
      }
      if (st.pending?.type === "return") {
        await page.evaluate(() => {
          const need = JSON.parse(window.render_game_to_text()).pending.count;
          for (let i = 0; i < need; i += 1) document.querySelector("[data-return]:not([disabled])")?.click();
          const ok = document.querySelector("#confirm-return");
          if (ok && !ok.disabled) ok.click();
        });
        await page.waitForTimeout(160);
        continue;
      }
      const acted = await page.evaluate(() => {
        const buy = document.querySelector("[data-buy]:not([disabled])");
        if (buy) {
          buy.click();
          return true;
        }

        // 마스터볼이 없어 희귀·전설 포획이 막혀 있으면(색은 충분한데 마스터볼만 부족) 예약해 마스터볼을 확보한다.
        // 예약하지 않으면 마스터볼이 영원히 쌓이지 않아 게임이 진행되지 않는 경로가 생긴다.
        const masterBlocked = document.querySelector(".card .afford-tag.master")?.closest(".card");
        const masterReserve = masterBlocked?.querySelector("[data-reserve-card]:not([disabled])");
        if (masterReserve) {
          masterReserve.click();
          return true;
        }

        const tokenButtons = [...document.querySelectorAll("[data-token]")].filter((b) => !b.disabled);
        if (!tokenButtons.length) return false;

        // 화면에 이미 렌더된 "부족한 볼" 힌트(가장 근접한 카드의 lack-chip)를 그대로 읽어
        // 목표 지향적으로 볼을 고른다 — 순수 무작위보다 실제 플레이에 가깝고 훨씬 빨리 수렴한다
        const closest = document.querySelector(".card.is-close, .card.is-affordable");
        const wanted = closest
          ? [...closest.querySelectorAll(".lack-chip")]
              .map((chip) => [...chip.classList].find((c) => ["red", "blue", "yellow", "green", "black"].includes(c)))
              .filter(Boolean)
          : [];

        const byColor = new Map(tokenButtons.map((b) => [b.dataset.token, b]));
        const picked = [];
        for (const color of wanted) {
          if (picked.length >= 3) break;
          const btn = byColor.get(color);
          if (btn && !picked.includes(btn)) picked.push(btn);
        }
        const shuffled = [...tokenButtons];
        for (let i = shuffled.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        for (const btn of shuffled) {
          if (picked.length >= 3) break;
          if (!picked.includes(btn)) picked.push(btn);
        }
        picked.forEach((b) => b.click());
        const take = document.querySelector("#take-tokens");
        if (take && !take.disabled) {
          take.click();
          return true;
        }
        return false;
      });
      await page.waitForTimeout(acted ? 200 : 320);
    }

    const finalState = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
    assert.ok(finalState.winner !== null && finalState.winner !== undefined, "게임이 끝나야 한다");

    await page.waitForSelector(".result-overlay", { timeout: 6000 });
    const resultText = await page.textContent(".result-card");
    assert.match(resultText, /챔피언 등극!|이번엔 아쉽네요/);
    const ranks = await page.$$eval(".result-rank li", (els) => els.length);
    assert.equal(ranks, 2, "모든 플레이어의 순위가 표시되어야 한다");
    assert.ok(await page.$("#result-again"), "다시 하기 버튼이 있어야 한다");

    // 다시 하기로 새 판이 시작되고 결과 화면이 사라진다
    await page.click("#result-again");
    await page.waitForTimeout(700);
    assert.equal(await page.$(".result-overlay"), null, "새 판에서는 결과 화면이 사라져야 한다");
    const restarted = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
    assert.equal(restarted.winner, null, "새 판은 승자가 없어야 한다");

    assert.deepEqual(errors, [], "브라우저 에러가 없어야 한다");
  } finally {
    await browser.close();
    if (serverProcess) serverProcess.kill();
  }
});
