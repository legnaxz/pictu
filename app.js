import { BADGES, COLORS, EVOLUTION_DISCOUNT, TRAINERS, WIN_SCORE, badgeRequirement, buyCard, createGame, effectiveCost, evolveCard, perk, reserveCard, returnTokens, takeTokens } from "./rules.js";
import { TUTORIAL_STEPS, renderTutorialModal } from "./tutorial.js";
import { AI_PROFILES, DIFFICULTY_PRESETS, chooseCpuAction } from "./ai.js";
import * as fx from "./fx.js";

const labels = { red: "몬스터볼", blue: "슈퍼볼", yellow: "퀵볼", green: "힐볼", black: "하이퍼볼", wild: "마스터볼" };
const app = document.querySelector("#app");
const session = {
  socket: null,
  seat: 0,
  code: null,
  online: false,
  isSolo: false,
  host: false,
  capacity: 0,
  connected: 0,
  view: "board",
  mobileTab: "market",
  tutorialStep: null,
};

const CPU_SPEEDS = {
  slow: { label: "느림", icon: "🐢", delay: 2400 },
  normal: { label: "보통", icon: "🚶", delay: 1600 },
  fast: { label: "빠름", icon: "⚡", delay: 800 },
};
const CPU_SPEED_ORDER = ["slow", "normal", "fast"];

const soloSettings = {
  playerCount: 2,
  difficulty: "intermediate",
  trainerId: "ash",
  cpuSpeed: "normal",
};

let state;
let resultShown = false;
let selectedTokens = [];
let returnSelection = {};
let reserveMode = false;
let cpuTimer = null;

const isMine = () =>
  session.online ? session.seat === state?.active : (!state || (state.active === 0 && !state.players[0].isCpu));
const current = () => (state ? state.players[state.active] : null);
const target = () => {
  if (!state || current()?.score !== 0) return null;
  return [...state.market[1]].sort((a, b) => {
    const costA = Object.values(a.cost).reduce((s, v) => s + v, 0);
    const costB = Object.values(b.cost).reduce((s, v) => s + v, 0);
    return costA - costB;
  })[0];
};

function sync() {
  if (session.online && session.socket?.readyState === WebSocket.OPEN) {
    session.socket.send(JSON.stringify({ type: "snapshot", snapshot: state }));
  }
}

function badgeCounts() {
  return state ? state.players.map((p) => p.badges.length) : [];
}

// 행동을 실행하고 결과에 맞는 사운드·연출을 재생한다
function act(sound, run, { source = null, onSuccess = null } = {}) {
  fx.unlockAudio();
  const before = badgeCounts();
  const result = run();

  if (!result.ok) {
    fx.play("error");
    update(result);
    return result;
  }

  fx.play(sound);
  if (onSuccess) onSuccess();

  // 배지 선점은 규칙 엔진이 턴 종료 시 자동 처리하므로 사후에 감지한다
  const after = badgeCounts();
  const gained = after.findIndex((count, seat) => count > (before[seat] ?? 0));
  if (gained >= 0) {
    const owner = state.players[gained];
    const badge = owner.badges[owner.badges.length - 1];
    window.setTimeout(() => {
      fx.play("badge");
      fx.badgeBanner(badge, owner.name);
    }, 320);
  }

  update(result);
  return result;
}

function update(result) {
  if (!result.ok) state.log = result.message;
  selectedTokens = [];
  reserveMode = false;
  sync();
  render();
  maybeShowResult();
  checkAndTriggerCpu();
}

function maybeShowResult() {
  if (!state?.finished || resultShown) return;
  resultShown = true;
  const iWon = state.winner === session.seat;
  window.setTimeout(() => {
    fx.play(iWon ? "win" : "lose");
    if (iWon) fx.confetti(3600);
    else fx.flash("rgba(15,23,42,0.5)", 700);
    showResultOverlay(iWon);
  }, 520);
}

function checkAndTriggerCpu() {
  if (cpuTimer) {
    clearTimeout(cpuTimer);
    cpuTimer = null;
  }
  if (!state || state.finished || session.online) return;

  const pendingTarget = state.pending ? state.players[state.pending.player] : null;
  const activeTarget = current();

  const cpuPlayer = pendingTarget && pendingTarget.isCpu ? pendingTarget : activeTarget && activeTarget.isCpu ? activeTarget : null;
  if (!cpuPlayer) return;

  const delay = (CPU_SPEEDS[soloSettings.cpuSpeed] || CPU_SPEEDS.normal).delay;
  cpuTimer = setTimeout(() => {
    cpuTimer = null;
    runCpuTurn(cpuPlayer.seat);
  }, delay);
}

function runCpuTurn(seat) {
  if (!state || state.finished || session.online) return;
  const player = state.players[seat];
  if (!player || !player.isCpu) return;

  const profileId = player.cpuProfileId || "cynthia";
  const decision = chooseCpuAction(state, seat, profileId);

  if (!decision) return;

  const badgesBefore = badgeCounts();

  let res = null;
  if (decision.action === "buy") {
    res = buyCard(state, seat, decision.cardId);
  } else if (decision.action === "reserve") {
    res = reserveCard(state, seat, decision.tier, decision.cardId);
  } else if (decision.action === "take") {
    res = takeTokens(state, seat, decision.colors);
  } else if (decision.action === "evolve") {
    res = evolveCard(state, seat, decision.cardId);
  } else if (decision.action === "return") {
    res = returnTokens(state, seat, decision.tokens);
  }

  if (res && res.ok) {
    state.log = `🤖 [${player.name}] ${decision.reason || res.message}`;
    const soundByAction = { buy: "capture", reserve: "reserve", take: "tokenTake", evolve: "evolve", return: "turn" };
    fx.play(soundByAction[decision.action] || "turn");
    const after = badgeCounts();
    const gained = after.findIndex((count, seat) => count > (badgesBefore[seat] ?? 0));
    if (gained >= 0) {
      const owner = state.players[gained];
      const badge = owner.badges[owner.badges.length - 1];
      window.setTimeout(() => {
        fx.play("badge");
        fx.badgeBanner(badge, owner.name);
      }, 320);
    }
  }

  selectedTokens = [];
  reserveMode = false;
  render();
  sync();

  maybeShowResult();
  checkAndTriggerCpu();
}

function startGame(count, isSolo = false) {
  if (cpuTimer) {
    clearTimeout(cpuTimer);
    cpuTimer = null;
  }
  state = createGame(count, Math.random, isSolo ? [soloSettings.trainerId] : []);
  session.isSolo = isSolo;
  resultShown = false;
  fx.clearLayer();
  document.querySelector(".result-overlay")?.remove();

  if (isSolo) {
    session.online = false;
    session.seat = 0;
    state.players[0].isCpu = false;

    const profilesByDiff = {
      beginner: ["beginner", "beginner", "beginner"],
      intermediate: ["brock", "oak", "blue"],
      advanced: ["cynthia", "blue", "oak"],
    };
    const list = profilesByDiff[soloSettings.difficulty] || ["brock", "oak", "blue"];

    for (let seat = 1; seat < count; seat++) {
      const prof = AI_PROFILES[list[seat - 1] || "cynthia"];
      state.players[seat].isCpu = true;
      state.players[seat].cpuProfileId = prof.id;
      state.players[seat].difficultyLabel = prof.difficultyLabel;
    }
  }

  selectedTokens = [];
  reserveMode = false;
  session.tutorialStep = null;
  render();
  sync();
  checkAndTriggerCpu();
}

function affordability(player, card) {
  const cost = effectiveCost(player, card);
  const missing = {};
  let short = 0;
  COLORS.forEach((c) => {
    const need = Math.max(0, cost[c] - player.bonuses[c]);
    const gap = Math.max(0, need - player.tokens[c]);
    missing[c] = gap;
    short += gap;
  });
  const masterOk = !card.masterRequired || player.tokens.wild >= 1;
  // 마스터볼은 희귀·전설 포획에만 쓸 수 있고, 그중 1개는 포획 자체에 소모된다
  const wildUsable = card.masterRequired ? Math.max(0, player.tokens.wild - 1) : 0;
  return { cost, missing, short, masterOk, wildUsable, canBuy: masterOk && short <= wildUsable };
}

function shortfallMarkup(afford, card) {
  if (afford.canBuy) return `<span class="afford-tag ok">지금 잡을 수 있어요</span>`;
  if (!afford.masterOk) return `<span class="afford-tag master">마스터볼 필요</span>`;
  const parts = COLORS.filter((c) => afford.missing[c] > 0).map(
    (c) => `<span class="lack-chip ${c}"><span class="chip-dot"></span>${afford.missing[c]}</span>`
  );
  const covered = afford.wildUsable ? Math.min(afford.wildUsable, afford.short) : 0;
  const remain = afford.short - covered;
  return `<span class="afford-tag short">${remain > 0 ? `${remain}개 부족` : "마스터볼로 충당"}</span>${parts.join("")}`;
}

function evolutionCost(player, card) {
  const remaining = {};
  COLORS.forEach((c) => {
    remaining[c] = Math.max(0, card.cost[c] - player.bonuses[c] - perk(player, "evolutionDiscount", EVOLUTION_DISCOUNT));
  });
  return remaining;
}

function costMarkup(cost, masterRequired = false) {
  const items = [];
  if (masterRequired) {
    items.push(`<span class="cost-chip wild"><span class="chip-dot"></span>1</span>`);
  }
  COLORS.forEach((c) => {
    if (cost[c]) {
      items.push(`<span class="cost-chip ${c}"><span class="chip-dot"></span>${cost[c]}</span>`);
    }
  });
  return items.join("");
}

function bonusMarkup(bonuses) {
  const items = COLORS.filter((c) => bonuses[c]).map((c) =>
    `<span class="bonus-chip ${c}">+${bonuses[c]}</span>`
  );
  return items.join("") || "—";
}

function cardMarkup(card, firstTarget, context = "market") {
  const isSpecial = card.kind !== "normal";
  const me = current();
  const stageLabel = card.kind === "rare" ? "희귀" : card.kind === "legend" ? "전설·환상" : `${card.stage}단계`;
  const evoTag =
    card.kind === "normal" && card.stage < 3
      ? `<span class="card-evo-badge">${card.stage}단계➔${card.stage + 1}</span>`
      : `<span class="card-evo-badge ${card.kind}">${stageLabel}</span>`;

  const canAct = isMine() && !state.pending && !state.finished;
  const afford = me ? affordability(me, card) : null;
  const reserveLimit = me ? perk(me, "reserveLimit", 3) : 3;
  const reserveFull = me ? me.reserved.length >= reserveLimit : false;

  const canBuy = canAct && Boolean(afford?.canBuy);
  const canReserve = canAct && !isSpecial && !reserveFull && context !== "reserved";

  const buyReason = !canAct
    ? "지금은 행동할 수 없습니다"
    : afford?.canBuy
      ? `${card.name} 포획하기`
      : !afford?.masterOk
        ? "마스터볼이 필요합니다 (카드를 보관하면 받습니다)"
        : "포켓볼이 부족합니다";
  const reserveReason = !canAct
    ? "지금은 행동할 수 없습니다"
    : isSpecial
      ? "희귀·전설 포켓몬은 손에 보관할 수 없습니다"
      : context === "reserved"
        ? "이미 손에 보관 중입니다"
        : reserveFull
          ? `손에는 최대 ${reserveLimit}장까지 보관할 수 있습니다`
          : "손에 보관하고 마스터볼 받기";

  const state_class = !me ? "" : afford.canBuy ? "is-affordable" : afford.short <= 2 ? "is-close" : "";

  return `
    <article class="card ${card.kind} ${card.bonus} ${state_class} ${firstTarget?.id === card.id ? "guide-target" : ""}"
             data-card-root="${card.id}"
             title="${card.name} (${stageLabel}) · 보너스 ${labels[card.bonus]}">
      <div class="card-header">
        <span class="card-points">${card.points > 0 ? `★${card.points}` : ""}</span>
        ${firstTarget?.id === card.id ? `<span class="guide-pill">첫 목표</span>` : evoTag}
        <div class="card-bonus-balls">
          ${Array.from({ length: card.bonusCount || 1 })
            .map(() => `<span class="bonus-ball ${card.bonus}" title="보너스 ${labels[card.bonus]}"></span>`)
            .join("")}
        </div>
      </div>

      <div class="card-body">
        <div class="card-cost-stack">
          <span class="cost-label">잡기</span>
          ${costMarkup(afford ? afford.cost : card.cost, card.masterRequired)}
        </div>
        <div class="card-art-box">
          <img class="card-art" src="${card.artwork}" alt="${card.name}" loading="eager" decoding="async" fetchpriority="high" />
        </div>
      </div>

      <div class="card-footer">
        <span class="card-name-pill ${card.bonus}">${card.name}</span>
      </div>

      ${afford ? `<div class="card-afford">${shortfallMarkup(afford, card)}</div>` : ""}

      <div class="card-actions">
        <button class="card-act act-buy" data-buy="${card.id}" ${canBuy ? "" : "disabled"} title="${buyReason}">
          <span class="act-icon">⚡</span>잡기
        </button>
        <button class="card-act act-reserve" data-reserve-card="${card.id}" ${canReserve ? "" : "disabled"} title="${reserveReason}">
          <span class="act-icon">🎒</span>보관
        </button>
      </div>
    </article>
  `;
}

function collectionMarkup() {
  const me = state.players[session.seat];
  if (!me) return "";
  const owned = me.cards.concat(me.evolutions);
  const trainer = TRAINERS.find((t) => t.id === me.trainerId);
  const points = owned.reduce((sum, c) => sum + c.points, 0);

  return `
    <div class="rail-title">내 포켓몬 도감</div>
    <section class="my-collection">
      <div class="collection-summary">
        <span>포획 <b>${me.cards.length}</b></span>
        <span>진화 <b>${me.evolutions.length}</b></span>
        <span>카드 점수 <b>★${points}</b></span>
        ${me.badges.length ? `<span>배지 <b>${me.badges.map((b) => b.icon).join("")}</b></span>` : ""}
      </div>
      <div class="collection-columns">
        ${COLORS.map((c) => {
          const cards = owned.filter((card) => card.bonus === c);
          const fromTrainer = trainer?.bonus === c ? 1 : 0;
          return `
          <div class="col-stack ${c} ${me.bonuses[c] ? "has" : ""}" title="${labels[c]} 보너스 ${me.bonuses[c]}개">
            <div class="col-head">
              <span class="chip-dot"></span>
              <b>+${me.bonuses[c]}</b>
            </div>
            <div class="col-cards">
              ${
                fromTrainer
                  ? `<span class="col-trainer" title="${trainer.name}의 시작 보너스">${trainer.avatar}</span>`
                  : ""
              }
              ${cards
                .map(
                  (card) => `
                <span class="col-card ${card.kind !== "normal" ? "special" : ""} ${me.evolutions.includes(card) ? "evolved" : ""}"
                      title="${card.name} · ★${card.points} · 보너스 ${card.bonusCount}">
                  <img src="${card.artwork}" alt="${card.name}" loading="lazy" />
                  ${card.points ? `<i>${card.points}</i>` : ""}
                </span>`
                )
                .join("")}
              ${!fromTrainer && !cards.length ? `<span class="col-empty">—</span>` : ""}
            </div>
          </div>`;
        }).join("")}
      </div>
    </section>
  `;
}

function badgeStripMarkup() {
  const me = current();
  return `
    <section class="badge-strip">
      <div class="badge-strip-head">
        <span class="eyebrow">GYM BADGES</span>
        <small>보너스 조건을 먼저 채운 트레이너가 선점합니다 · 각 ★3</small>
      </div>
      <div class="badge-list">
        ${state.badges
          .map((badge) => {
            const need = me ? badgeRequirement(me, badge) : badge.need;
            const owner = badge.owner !== null ? state.players[badge.owner] : null;
            const remain = me ? COLORS.reduce((sum, c) => sum + Math.max(0, need[c] - me.bonuses[c]), 0) : null;
            return `
            <div class="badge-card ${owner ? "claimed" : remain === 0 ? "ready" : remain <= 2 ? "close" : ""}"
                 title="${badge.leader} · ${owner ? `${owner.name} 획득` : "미획득"}">
              <div class="badge-icon">${badge.icon}</div>
              <div class="badge-info">
                <b>${badge.name}</b>
                <div class="badge-need">
                  ${COLORS.filter((c) => need[c] > 0)
                    .map(
                      (c) => `<span class="need-chip ${c} ${me && me.bonuses[c] >= need[c] ? "met" : ""}">
                        <span class="chip-dot"></span>${me ? Math.min(me.bonuses[c], need[c]) : 0}/${need[c]}
                      </span>`
                    )
                    .join("")}
                </div>
              </div>
              <div class="badge-status">
                ${owner ? `<span class="badge-owner">${owner.avatar || ""}${owner.name}</span>` : `<span class="badge-points">★3</span>`}
              </div>
            </div>`;
          })
          .join("")}
      </div>
    </section>
  `;
}

function pendingMarkup() {
  if (!state.pending) return "";
  if (state.pending.type === "evolution") {
    const isCpuPending = state.players[state.pending.player]?.isCpu;
    if (isCpuPending) {
      return `
        <section class="choice-panel evolution-panel">
          <div class="choice-header">
            <b>🧬 ${state.players[state.pending.player].name}의 진화 선택 중...</b>
            <p>할인된 진화 비용을 지불할지 계산하고 있습니다.</p>
          </div>
        </section>
      `;
    }
    const choices = Object.values(state.market)
      .flat()
      .concat(current().reserved)
      .filter((c) => state.pending.choices.includes(c.id));
    return `
      <section class="choice-panel evolution-panel">
        <div class="choice-header">
          <b>🧬 포켓몬 진화 기회 (1턴 1회)</b>
          <p>모든 색 1개씩 할인된 비용으로 포획합니다. <b>명성 점수와 영구 보너스를 그대로 획득</b>하며, 동점 시 1순위 승리 열쇠가 됩니다!</p>
        </div>
        <div class="choice-cards">
          ${choices
            .map(
              (c) => `
            <button class="btn-choice-card" data-evolve="${c.id}">
              <img src="${c.artwork}" alt="${c.name}" />
              <span>${c.name} (${c.stage}단계) · ★${c.points}</span>
              <span class="evolve-cost">${costMarkup(evolutionCost(current(), c)) || "무료"}</span>
            </button>
          `
            )
            .join("")}
          <button class="btn-choice-skip" data-evolve="skip">진화하지 않고 턴 마치기</button>
        </div>
      </section>
    `;
  }

  const isCpuPending = state.players[state.pending.player]?.isCpu;
  if (isCpuPending) {
    return `
      <section class="choice-panel return-panel">
        <div class="choice-header">
          <b>⚠️ ${state.players[state.pending.player].name}의 초과 볼 ${state.pending.count}개 반납 중...</b>
          <p>보유 포켓볼 한도(10개)에 맞춰 반납할 볼을 계산하고 있습니다.</p>
        </div>
      </section>
    `;
  }

  return `
    <section class="choice-panel return-panel">
      <div class="choice-header">
        <b>⚠️ 포켓볼 ${state.pending.count}개 반납</b>
        <p>보유 포켓볼 한도(10개)를 초과했습니다. 반납할 볼을 골라 10개로 맞추세요.</p>
      </div>
      <div class="return-grid">
        ${COLORS.concat("wild")
          .map(
            (c) => `
          <button class="return-chip-btn ${c}" data-return="${c}" ${current().tokens[c] <= (returnSelection[c] || 0) ? "disabled" : ""}>
            <span class="chip-icon ${c}"></span>
            <span>${labels[c]}</span>
            <b>${returnSelection[c] || 0} / ${current().tokens[c]}</b>
          </button>
        `
          )
          .join("")}
      </div>
      <button id="confirm-return" class="confirm-btn" ${Object.values(returnSelection).reduce((s, a) => s + a, 0) !== state.pending.count ? "disabled" : ""}>
        반납 완료 (${Object.values(returnSelection).reduce((s, a) => s + a, 0)} / ${state.pending.count})
      </button>
    </section>
  `;
}

function renderBoard() {
  const firstTarget = target();
  const tutModalHtml = session.tutorialStep !== null ? renderTutorialModal(session.tutorialStep) : "";
  const currentDiffPreset = DIFFICULTY_PRESETS.find((d) => d.id === soloSettings.difficulty) || DIFFICULTY_PRESETS[1];

  let modeBadge = "솔로 규칙 연습";
  if (session.online) {
    modeBadge = `온라인 ${session.code} · ${session.seat + 1}번 자리`;
  } else if (session.isSolo) {
    modeBadge = `🤖 CPU 대전 · ${state.playerCount}인 (${currentDiffPreset.label})`;
  }

  app.innerHTML = `
    <section class="game ${session.mobileTab ? `tab-${session.mobileTab}` : ""}">
      <header class="topbar">
        <div class="brand-group">
          <h1><span>스플렌더</span> 포켓몬</h1>
          <div class="rule-badge">${modeBadge}</div>
        </div>

        <div class="topbar-actions">
          <button class="rulebook-btn" id="open-rulebook">🎓 룰북</button>
          <button class="sound-btn" id="toggle-sound" title="${fx.isMuted() ? "소리 켜기" : "소리 끄기"}">${fx.isMuted() ? "🔇" : "🔊"}</button>
          ${
            session.isSolo
              ? `<button class="sound-btn cpu-speed-btn" id="toggle-cpu-speed" title="CPU 진행 속도: ${CPU_SPEEDS[soloSettings.cpuSpeed].label} (클릭해서 변경)">${CPU_SPEEDS[soloSettings.cpuSpeed].icon} ${CPU_SPEEDS[soloSettings.cpuSpeed].label}</button>`
              : ""
          }
          <button class="btn-new-game" id="btn-home">🏠 로비</button>
          <div class="view-switch">
            <button data-view="board" class="selected">보드</button>
            <button data-view="tui">TUI</button>
          </div>
        </div>

        <div class="status-badge ${state.finished ? "finished" : ""}">
          ${state.finished ? `🏆 ${state.players[state.winner].name} 승리!` : `🎯 ${current().name}의 턴 · ${state.turn}R`}
        </div>
      </header>

      <!-- 모바일 탭 바 -->
      <nav class="mobile-nav" aria-label="모바일 보기 탭">
        <button class="m-tab ${session.mobileTab === "market" ? "active" : ""}" data-mtab="market">🃏 시장</button>
        <button class="m-tab ${session.mobileTab === "supply" ? "active" : ""}" data-mtab="supply">⚪ 볼 공급</button>
        <button class="m-tab ${session.mobileTab === "my" ? "active" : ""}" data-mtab="my">👤 내 현황</button>
        <button class="m-tab ${session.mobileTab === "players" ? "active" : ""}" data-mtab="players">👥 트레이너</button>
      </nav>

      <div class="board-layout">
        <!-- 좌측 레일: 트레이너 목록 -->
        <aside class="left-rail rail-panel">
          <div class="rail-title">트레이너 현황</div>
          <section class="players">
            ${state.players
              .map(
                (p) => `
              <article class="player-card ${p.seat === state.active && !state.finished ? "active" : ""}" data-seat="${p.seat}">
                <div class="player-head">
                  <span class="player-name">
                    ${p.avatar ? `${p.avatar} ` : ""}${p.name}${p.seat === session.seat ? " (나)" : ""}
                    ${p.isCpu ? `<span class="cpu-tag ${p.difficultyLabel || "중급"}">${p.difficultyLabel || "CPU"}</span>` : ""}
                  </span>
                  <span class="player-score ${p.score >= WIN_SCORE - 3 ? "near-win" : ""}">★ ${p.score}<small>/${WIN_SCORE}</small></span>
                </div>
                ${p.seat === state.active && p.isCpu && !state.finished ? `<div class="cpu-thinking-pill"><span>⚡ 수 계산 중...</span></div>` : ""}
                <div class="player-trainer">
                  <span class="trainer-title">${TRAINERS.find((t) => t.id === p.trainerId)?.title || ""}</span>
                  <span class="trainer-perk" title="${TRAINERS.find((t) => t.id === p.trainerId)?.desc || ""}">특전</span>
                </div>
                <div class="player-stats">
                  <span>포획 ${p.cards.length} · 진화 ${p.evolutions.length} · 손 ${p.reserved.length}/${perk(p, "reserveLimit", 3)}</span>
                </div>
                ${
                  p.badges.length
                    ? `<div class="player-badges">${p.badges.map((b) => `<span class="mini-badge" title="${b.name}">${b.icon}</span>`).join("")}</div>`
                    : ""
                }
                <div class="player-bonus-row">
                  <span class="sub-label">보너스</span>
                  <div class="bonus-chips">${bonusMarkup(p.bonuses)}</div>
                </div>
                <div class="player-tokens-row">
                  <span class="sub-label">보유 볼</span>
                  <div class="mini-tokens">
                    ${COLORS.map((c) => `<span class="token-pill ${c}">${p.tokens[c]}</span>`).join("")}
                    <span class="token-pill wild" title="마스터볼">M ${p.tokens.wild}</span>
                  </div>
                </div>
              </article>
            `
              )
              .join("")}
          </section>
        </aside>

        <!-- 중앙 메인: 포켓몬 시장 -->
        <main class="table-area">
          <div class="market-header">
            <div>
              <span class="eyebrow">POKÉMON MARKET</span>
              <h2>포켓몬 시장</h2>
            </div>
            <span class="market-sub">포획 · 손에 보관 · 차례 후 진화</span>
          </div>

          ${
            firstTarget
              ? `
            <div class="guide-callout">
              <strong>💡 첫 포획 추천 가이드</strong>: <b>${firstTarget.name}</b>에 필요한 볼 <span class="inline-chips">${costMarkup(firstTarget.cost)}</span>을(를) 모아보세요!
            </div>
          `
              : ""
          }

          ${badgeStripMarkup()}

          ${pendingMarkup()}

          <!-- 특수 시장: 희귀 / 전설·환상 -->
          <section class="special-market-row">
            <div class="special-market-col">
              <div class="tier-heading rare-heading">
                <span>🌟 희귀 포켓몬 (마스터볼 필수)</span>
                <small>더블 보너스</small>
              </div>
              <div class="special-cards-deck">
                <div class="deck-card rare-deck" title="희귀 덱 남은 카드: ${state.decks.rare.length}장">
                  <div class="deck-inner">
                    <span class="deck-badge">RARE</span>
                    <span class="deck-count">${state.decks.rare.length}</span>
                  </div>
                </div>
                <div class="special-card-slot">
                  ${state.market.rare.map((c) => cardMarkup(c, firstTarget)).join("")}
                </div>
              </div>
            </div>

            <div class="special-market-col">
              <div class="tier-heading legend-heading">
                <span>👑 전설·환상 포켓몬 (마스터볼 필수)</span>
                <small>더블 보너스</small>
              </div>
              <div class="special-cards-deck">
                <div class="deck-card legend-deck" title="전설 덱 남은 카드: ${state.decks.legend.length}장">
                  <div class="deck-inner">
                    <span class="deck-badge">LEGEND</span>
                    <span class="deck-count">${state.decks.legend.length}</span>
                  </div>
                </div>
                <div class="special-card-slot">
                  ${state.market.legend.map((c) => cardMarkup(c, firstTarget)).join("")}
                </div>
              </div>
            </div>
          </section>

          <!-- 일반 시장: 3단계, 2단계, 1단계 -->
          <section class="tier-market-list">
            ${[3, 2, 1]
              .map(
                (tier) => `
              <div class="tier-row tier-${tier}">
                <div class="tier-deck-side">
                  <button class="deck-card tier-deck" data-reserve-tier="${tier}" ${!isMine() || state.pending || state.finished || current().reserved.length >= perk(current(), "reserveLimit", 3) ? "disabled" : ""} title="${tier}단계 덱 맨 위 카드를 보지 않고 손에 보관 (마스터볼 획득)">
                    <div class="deck-inner">
                      <span class="deck-badge">${tier}단계</span>
                      <span class="deck-count">${state.decks[tier].length}</span>
                      <span class="deck-reserve-hint">🎒 덱에서 보관</span>
                    </div>
                  </button>
                </div>
                <div class="tier-cards-grid">
                  ${state.market[tier].map((c) => cardMarkup(c, firstTarget)).join("")}
                </div>
              </div>
            `
              )
              .join("")}
          </section>
        </main>

        <!-- 우측 레일: 공급처 및 내 현황 -->
        <aside class="right-rail rail-panel">
          <div class="rail-title">포켓볼 공급처</div>
          <section class="supply-box">
            <p class="supply-tip">서로 다른 색 3개 또는 4개 이상 남은 같은 색 2개</p>
            <div class="supply-grid">
              ${COLORS.map(
                (c) => `
                <button class="ball-token-btn ${c} ${selectedTokens.includes(c) ? "selected-token" : ""}"
                        data-token="${c}"
                        ${!isMine() || state.pending || state.finished ? "disabled" : ""}>
                  <div class="chip-ball ${c}">
                    <span class="chip-dot"></span>
                  </div>
                  <div class="ball-meta">
                    <span class="ball-name">${labels[c]}</span>
                    <b class="ball-count">${state.bank[c]}</b>
                  </div>
                </button>
              `
              ).join("")}
            </div>

            <div class="wild-supply">
              <div class="ball-token-btn wild-token disabled" title="보관 시에만 획득 가능">
                <div class="chip-ball wild">
                  <span class="chip-dot"></span>
                </div>
                <div class="ball-meta">
                  <span class="ball-name">마스터볼</span>
                  <b class="ball-count">${state.bank.wild}</b>
                </div>
              </div>
              <small class="wild-desc">카드 보관 시 1개 획득 · <b>희귀·전설 포획 전용</b> (일반 포켓몬에는 사용 불가)</small>
            </div>
          </section>

          ${collectionMarkup()}

          <div class="rail-title">내 보관함 & 예약</div>
          <section class="my-reserve-box">
            <div class="reserve-header">
              <span>손에 보관한 포켓몬 (${state.players[session.seat].reserved.length}/${perk(state.players[session.seat], "reserveLimit", 3)})</span>
            </div>
            <div class="reserved-cards-list">
              ${
                state.players[session.seat].reserved.length
                  ? state.players[session.seat].reserved.map((c) => cardMarkup(c, firstTarget, "reserved")).join("")
                  : `<div class="empty-reserve-slot">보관된 포켓몬이 없습니다</div>`
              }
            </div>
          </section>

          <div class="rail-title">게임 로그</div>
          <div class="game-log-box">
            <p>${state.log}</p>
          </div>
        </aside>
      </div>

      <!-- 플로팅 바텀 독 (조작 버튼) -->
      <footer class="bottom-dock">
        <div class="dock-container">
          <div class="dock-status">
            <div class="dock-turn-info">
              <b>${current().name}</b>의 차례
              ${!isMine() ? `<span class="dock-wait-pill">상대 수 계산 중...</span>` : ""}
            </div>
            <div class="dock-selected-tokens">
              선택한 볼: <strong>${selectedTokens.map((c) => labels[c]).join(" / ") || "없음"}</strong>
            </div>
          </div>

          <div class="dock-actions">
            <button id="take-tokens" class="action-btn primary"
                    ${!selectedTokens.length || !isMine() || state.pending || state.finished ? "disabled" : ""}>
              선택 볼 획득 (${selectedTokens.length}개)
            </button>
            <div class="dock-hint">카드의 <b>⚡잡기</b> · <b>🎒보관</b> 버튼으로 행동하세요</div>
          </div>
        </div>
      </footer>

      ${tutModalHtml}
    </section>
  `;
  bind();
}

function renderTui() {
  const tutModalHtml = session.tutorialStep !== null ? renderTutorialModal(session.tutorialStep) : "";
  app.innerHTML = `
    <section class="tui-shell">
      <header class="tui-header">
        <div>
          <b>POKÉMON SPLENDOR TUI</b>
          <span>${current().name} · ${state.turn}라운드</span>
        </div>
        <div class="tui-header-right">
          <button class="rulebook-btn" id="open-rulebook">📖 룰북</button>
          <button class="btn-new-game" id="btn-home">🏠 로비</button>
          <div class="view-switch">
            <button data-view="board">보드</button>
            <button data-view="tui" class="selected">TUI</button>
          </div>
        </div>
      </header>
      <main class="tui-main">
        <section class="tui-panel">
          <h2>상태</h2>
          <p>현재 차례: ${current().name}${!isMine() ? " (상대 차례)" : ""}</p>
          <p>명성: ★${current().score} · 포획: ${current().cards.length} · 진화: ${current().evolutions.length}</p>
          <p>포켓볼: ${COLORS.map((c) => `${labels[c]} ${current().tokens[c]}`).join(" / ")} / 마스터 ${current().tokens.wild}</p>
          <h2>공급처</h2>
          <div class="tui-tokens">
            ${COLORS.map(
              (c) => `
              <button data-token="${c}" ${!isMine() || state.pending || state.finished ? "disabled" : ""}>
                [${labels[c]} ${state.bank[c]}]
              </button>
            `
            ).join("")}
          </div>
          <p>${state.log}</p>
          ${pendingMarkup()}
          <button id="take-tokens" ${!selectedTokens.length || !isMine() || state.pending || state.finished ? "disabled" : ""}>선택 볼 획득</button>
          <button id="reserve" ${!isMine() || state.pending || state.finished ? "disabled" : ""}>${reserveMode ? "보관 취소" : "카드 보관"}</button>
        </section>
        <section class="tui-panel tui-market">
          <h2>포켓몬 시장</h2>
          ${["rare", "legend", 3, 2, 1]
            .map(
              (tier) => `
            <h3>[${tier === "rare" ? "희귀" : tier === "legend" ? "전설 · 환상" : `${tier}단계`}]</h3>
            ${state.market[tier]
              .map(
                (c) => `
              <button class="tui-card" data-card="${c.id}" ${!isMine() || state.pending || state.finished ? "disabled" : ""}>
                ${c.name} | ★${c.points} | 보너스 ${labels[c.bonus]}${c.masterRequired ? " | 마스터볼 필요" : ""} | 비용 ${COLORS.filter((col) => c.cost[col]).map((col) => `${labels[col]} ${c.cost[col]}`).join(", ")}
              </button>
            `
              )
              .join("")}
            ${
              typeof tier === "number"
                ? `
              <button data-reserve-tier="${tier}" ${!reserveMode || !isMine() || state.pending ? "disabled" : ""}>
                [${tier}단계 비공개 보관]
              </button>
            `
                : ""
            }
          `
            )
            .join("")}
        </section>
      </main>
      ${tutModalHtml}
    </section>
  `;
  bind();
}

function renderSetup() {
  const tutModalHtml = session.tutorialStep !== null ? renderTutorialModal(session.tutorialStep) : "";
  const currentDiffPreset = DIFFICULTY_PRESETS.find((d) => d.id === soloSettings.difficulty) || DIFFICULTY_PRESETS[1];

  app.innerHTML = `
    <section class="setup">
      <div class="setup-box">
        <div class="logo-badge">POKÉMON SPLENDOR</div>
        <h1>스플렌더 포켓몬</h1>
        <p class="subtitle">공식 보드게임 룰 완벽 구현 · 웹 에디션</p>

        <!-- 튜토리얼 모드 메인 진입 버튼 -->
        <button class="start tutorial-btn" id="start-tutorial">
          🎓 룰 튜토리얼 (처음이라면 필독!)
        </button>

        <hr class="setup-divider" />

        <div class="mode-section">
          <h3>🎮 혼자서 즐기기 (솔로 CPU 대전)</h3>

          <div class="solo-config-group">
            <span class="solo-config-title">👥 대전 인원 선택</span>
            <div class="solo-count-group" id="solo-count-buttons">
              <button class="solo-choice-btn ${soloSettings.playerCount === 2 ? "selected" : ""}" data-solo-count="2">
                <span>2명 대전</span>
                <small>나 vs CPU 1명</small>
              </button>
              <button class="solo-choice-btn ${soloSettings.playerCount === 3 ? "selected" : ""}" data-solo-count="3">
                <span>3명 대전</span>
                <small>나 vs CPU 2명</small>
              </button>
              <button class="solo-choice-btn ${soloSettings.playerCount === 4 ? "selected" : ""}" data-solo-count="4">
                <span>4명 대전</span>
                <small>나 vs CPU 3명</small>
              </button>
            </div>
          </div>

          <div class="solo-config-group">
            <span class="solo-config-title">🎽 내 트레이너 선택 (고유 특전)</span>
            <div class="trainer-grid" id="trainer-buttons">
              ${TRAINERS.map(
                (t) => `
                <button class="trainer-choice ${soloSettings.trainerId === t.id ? "selected" : ""}" data-trainer="${t.id}" title="${t.desc}">
                  <span class="trainer-avatar">${t.avatar}</span>
                  <span class="trainer-name">${t.name}</span>
                  <span class="trainer-sub">${t.title}</span>
                  <span class="trainer-start ${t.bonus}">시작 ${labels[t.bonus]} +1</span>
                  <span class="trainer-desc">${t.desc}</span>
                </button>`
              ).join("")}
            </div>
          </div>

          <div class="solo-config-group">
            <span class="solo-config-title">⚔️ CPU 난이도 & 상대 선택</span>
            <div class="solo-diff-group" id="solo-diff-buttons">
              <button class="solo-choice-btn ${soloSettings.difficulty === "beginner" ? "selected" : ""}" data-solo-diff="beginner">
                <span>🌱 초보</span>
                <small>규칙을 익히는 단계</small>
              </button>
              <button class="solo-choice-btn ${soloSettings.difficulty === "intermediate" ? "selected" : ""}" data-solo-diff="intermediate">
                <span>🌿 중급</span>
                <small>진화 체인을 노리는 상대</small>
              </button>
              <button class="solo-choice-btn ${soloSettings.difficulty === "advanced" ? "selected" : ""}" data-solo-diff="advanced">
                <span>👑 고급</span>
                <small>정밀 계산 챔피언</small>
              </button>
            </div>
            <div class="solo-diff-desc" id="solo-diff-desc">
              💡 ${currentDiffPreset.desc}
            </div>
          </div>

          <div class="solo-config-group">
            <span class="solo-config-title">⏱️ CPU 진행 속도</span>
            <div class="solo-speed-group" id="solo-speed-buttons">
              ${CPU_SPEED_ORDER.map(
                (id) => `
                <button class="solo-choice-btn ${soloSettings.cpuSpeed === id ? "selected" : ""}" data-solo-speed="${id}">
                  <span>${CPU_SPEEDS[id].icon} ${CPU_SPEEDS[id].label}</span>
                  <small>${id === "slow" ? "차근차근 지켜보기" : id === "normal" ? "기본 속도 (추천)" : "빠르게 진행"}</small>
                </button>`
              ).join("")}
            </div>
            <div class="solo-diff-desc">💡 게임 중에도 상단 ${CPU_SPEEDS[soloSettings.cpuSpeed].icon} 버튼으로 언제든 바꿀 수 있어요</div>
          </div>

          <button class="start solo-start-btn" id="solo">🎮 ${soloSettings.playerCount}인 대전 시작 (${currentDiffPreset.label})</button>
        </div>

        <hr class="setup-divider" />

        <div class="mode-section">
          <h3>친구와 온라인 대전</h3>
          <p class="player-count-label">플레이어 인원 선택</p>
          <div id="count" class="count-buttons">
            <button data-count="2" class="selected">2명</button>
            <button data-count="3">3명</button>
            <button data-count="4">4명</button>
          </div>
          <button class="start online-create-btn" id="start">방 만들기 (호스트)</button>

          <div class="join-box">
            <input id="room-code" maxlength="5" placeholder="방 코드 5자리" />
            <button class="start join-btn" id="join">방 참가</button>
          </div>
        </div>
      </div>
      ${tutModalHtml}
    </section>
  `;

  let onlineCount = 2;
  document.querySelectorAll("[data-count]").forEach((button) => {
    button.addEventListener("click", () => {
      onlineCount = Number(button.dataset.count);
      document.querySelectorAll("[data-count]").forEach((item) => item.classList.toggle("selected", item === button));
    });
  });

  document.querySelectorAll("[data-solo-count]").forEach((button) => {
    button.addEventListener("click", () => {
      soloSettings.playerCount = Number(button.dataset.soloCount);
      renderSetup();
    });
  });

  document.querySelectorAll("[data-solo-diff]").forEach((button) => {
    button.addEventListener("click", () => {
      soloSettings.difficulty = button.dataset.soloDiff;
      renderSetup();
    });
  });

  document.querySelectorAll("[data-trainer]").forEach((button) => {
    button.addEventListener("click", () => {
      soloSettings.trainerId = button.dataset.trainer;
      renderSetup();
    });
  });

  document.querySelectorAll("[data-solo-speed]").forEach((button) => {
    button.addEventListener("click", () => {
      soloSettings.cpuSpeed = button.dataset.soloSpeed;
      renderSetup();
    });
  });

  document.querySelector("#start-tutorial")?.addEventListener("click", () => {
    session.tutorialStep = 0;
    render();
  });
  document.querySelector("#solo")?.addEventListener("click", () => {
    session.online = false;
    session.seat = 0;
    startGame(soloSettings.playerCount, true);
  });
  document.querySelector("#start")?.addEventListener("click", () => connect("create", onlineCount));
  document.querySelector("#join")?.addEventListener("click", () => connect("join", document.querySelector("#room-code").value));

  bindTutorialEvents();
}

function renderLobby() {
  app.innerHTML = `
    <section class="setup">
      <div class="setup-box lobby">
        <div class="logo-badge">대기실</div>
        <h1>방 코드: ${session.code}</h1>
        <p>친구에게 방 코드를 공유하세요. 정원이 차면 게임이 자동으로 시작됩니다.</p>
        <div class="seat-count">${session.connected} / ${session.capacity}</div>
        <button class="start secondary" id="lobby-cancel">방 나가기</button>
      </div>
    </section>
  `;
  document.querySelector("#lobby-cancel")?.addEventListener("click", () => {
    if (session.socket) session.socket.close();
    session.socket = null;
    session.online = false;
    renderSetup();
  });
}

function connect(type, value) {
  const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`);
  session.socket = socket;
  session.host = type === "create";
  socket.addEventListener("open", () => {
    socket.send(JSON.stringify(type === "create" ? { type, playerCount: value } : { type, code: value }));
  });
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.type === "error") {
      alert(message.message);
      session.socket = null;
      renderSetup();
    }
    if (message.type === "welcome") {
      session.online = true;
      session.code = message.code;
      session.seat = message.seat;
      session.capacity = message.capacity;
      session.connected = message.snapshot ? message.capacity : 1;
      if (message.snapshot) {
        state = message.snapshot;
        render();
      } else {
        renderLobby();
      }
    }
    if (message.type === "presence") {
      session.connected = message.connected;
      session.capacity = message.capacity;
      if (session.host && !state && session.connected === session.capacity) {
        startGame(session.capacity, false);
      } else if (!state) {
        renderLobby();
      }
    }
    if (message.type === "snapshot") {
      state = message.snapshot;
      selectedTokens = [];
      reserveMode = false;
      returnSelection = {};
      render();
    }
  });
}

function bindTutorialEvents() {
  document.querySelector("#tut-close")?.addEventListener("click", () => {
    session.tutorialStep = null;
    render();
  });
  document.querySelector("#tut-prev")?.addEventListener("click", () => {
    if (session.tutorialStep > 0) {
      session.tutorialStep -= 1;
      render();
    }
  });
  document.querySelector("#tut-next")?.addEventListener("click", () => {
    if (session.tutorialStep < TUTORIAL_STEPS.length - 1) {
      session.tutorialStep += 1;
      render();
    }
  });
  document.querySelector("#tut-finish")?.addEventListener("click", () => {
    session.tutorialStep = null;
    session.online = false;
    session.seat = 0;
    startGame(2, true);
  });
  document.querySelectorAll("[data-step]").forEach((dot) => {
    dot.addEventListener("click", () => {
      session.tutorialStep = Number(dot.dataset.step);
      render();
    });
  });
}

function bind() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      session.view = button.dataset.view;
      render();
    });
  });

  document.querySelector("#btn-home")?.addEventListener("click", () => {
    if (cpuTimer) {
      clearTimeout(cpuTimer);
      cpuTimer = null;
    }
    state = null;
    session.online = false;
    render();
  });

  document.querySelectorAll("[data-mtab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      session.mobileTab = btn.dataset.mtab;
      render();
    });
  });

  document.querySelector("#open-rulebook")?.addEventListener("click", () => {
    session.tutorialStep = 0;
    render();
  });

  document.querySelector("#toggle-sound")?.addEventListener("click", () => {
    fx.setMuted(!fx.isMuted());
    fx.unlockAudio();
    if (!fx.isMuted()) fx.play("tokenPick");
    render();
  });

  document.querySelector("#toggle-cpu-speed")?.addEventListener("click", () => {
    const idx = CPU_SPEED_ORDER.indexOf(soloSettings.cpuSpeed);
    soloSettings.cpuSpeed = CPU_SPEED_ORDER[(idx + 1) % CPU_SPEED_ORDER.length];
    render();
  });

  document.querySelectorAll("[data-token]").forEach((button) => {
    button.addEventListener("click", () => {
      const color = button.dataset.token;
      if (selectedTokens.length === 1 && selectedTokens[0] === color) {
        selectedTokens = state.bank[color] >= 4 ? [color, color] : [];
      } else if (selectedTokens.length === 2 && selectedTokens.every((v) => v === color)) {
        selectedTokens = [];
      } else if (selectedTokens.includes(color)) {
        selectedTokens = selectedTokens.filter((v) => v !== color);
      } else if (selectedTokens.length < 3) {
        selectedTokens = [...selectedTokens, color];
      }
      fx.unlockAudio();
      fx.play("tokenPick");
      refreshTokenSelection();
    });
  });

  document.querySelectorAll("[data-buy]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const card = button.closest(".card");
      const art = card?.querySelector(".card-art");
      fx.throwBall(card);
      act("capture", () => buyCard(state, state.active, button.dataset.buy), {
        onSuccess: () => fx.flyTo(art, ".my-collection", { delay: 600 }),
      });
    });
  });

  document.querySelectorAll("[data-reserve-card]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const cardId = button.dataset.reserveCard;
      const art = button.closest(".card")?.querySelector(".card-art");
      act("reserve", () => reserveCard(state, state.active, Number(cardId.split("-")[0]), cardId), {
        onSuccess: () => fx.flyTo(art, ".my-reserve-box"),
      });
    });
  });

  // TUI 전용: 보관 토글 후 카드 클릭
  document.querySelectorAll("[data-card]").forEach((button) => {
    button.addEventListener("click", () => {
      const cardId = button.dataset.card;
      if (reserveMode) {
        act("reserve", () => reserveCard(state, state.active, Number(cardId.split("-")[0]), cardId));
      } else {
        act("capture", () => buyCard(state, state.active, cardId));
      }
    });
  });

  document.querySelectorAll("[data-reserve-tier]").forEach((button) => {
    button.addEventListener("click", () => {
      const deck = button;
      act("reserve", () => reserveCard(state, state.active, Number(button.dataset.reserveTier)), {
        onSuccess: () => fx.flyTo(deck, ".my-reserve-box", { scale: 0.5 }),
      });
    });
  });

  document.querySelectorAll("[data-evolve]").forEach((button) => {
    button.addEventListener("click", () => {
      const skip = button.dataset.evolve === "skip";
      const img = button.querySelector("img");
      act(skip ? "turn" : "evolve", () => evolveCard(state, state.active, skip ? null : button.dataset.evolve), {
        onSuccess: () => {
          if (skip) return;
          fx.flash("rgba(255,255,255,0.6)", 520);
          fx.flyTo(img, ".my-collection", { scale: 0.4, duration: 720 });
        },
      });
    });
  });

  document.querySelectorAll("[data-return]").forEach((button) => {
    button.addEventListener("click", () => {
      const selected = Object.values(returnSelection).reduce((sum, amount) => sum + amount, 0);
      if (selected < state.pending.count) {
        returnSelection[button.dataset.return] = (returnSelection[button.dataset.return] || 0) + 1;
      }
      render();
    });
  });

  document.querySelector("#confirm-return")?.addEventListener("click", () => {
    act("reserve", () => returnTokens(state, state.active, returnSelection));
    returnSelection = {};
  });

  document.querySelector("#take-tokens")?.addEventListener("click", () => {
    const chips = selectedTokens.map((color) => document.querySelector(`[data-token="${color}"]`));
    act("tokenTake", () => takeTokens(state, state.active, selectedTokens), {
      onSuccess: () => chips.forEach((chip, i) => fx.flyTo(chip, `[data-seat="${session.seat}"]`, { scale: 0.4, duration: 520, delay: i * 90 })),
    });
  });

  document.querySelector("#reserve")?.addEventListener("click", () => {
    reserveMode = !reserveMode;
    render();
  });

  bindTutorialEvents();
}

function refreshTokenSelection() {
  document.querySelectorAll("[data-token]").forEach((button) => {
    button.classList.toggle("selected-token", selectedTokens.includes(button.dataset.token));
  });
  const selected = selectedTokens.map((c) => labels[c]).join(" / ") || "없음";
  const summary =
    document.querySelector(".dock-selected-tokens strong") || document.querySelector(".my-board span:last-child");
  if (summary) summary.textContent = selected;
  const take = document.querySelector("#take-tokens");
  if (take) {
    take.disabled = !selectedTokens.length || !isMine() || Boolean(state.pending) || state.finished;
    take.textContent = `선택 볼 획득 (${selectedTokens.length}개)`;
  }
}

function showResultOverlay(iWon) {
  const ranked = [...state.players].sort(
    (a, b) =>
      b.score - a.score ||
      b.badges.length - a.badges.length ||
      b.evolutions.length - a.evolutions.length ||
      b.cards.length - a.cards.length ||
      a.seat - b.seat
  );
  const overlay = document.createElement("div");
  overlay.className = `result-overlay ${iWon ? "won" : "lost"}`;
  overlay.innerHTML = `
    <div class="result-card">
      <div class="result-crest">${iWon ? "🏆" : "😢"}</div>
      <h2>${iWon ? "챔피언 등극!" : "이번엔 아쉽네요"}</h2>
      <p class="result-sub">${state.players[state.winner].name} 승리 · ${state.turn}라운드</p>
      <ol class="result-rank">
        ${ranked
          .map(
            (p, index) => `
          <li class="${p.seat === session.seat ? "me" : ""} ${index === 0 ? "top" : ""}">
            <span class="rank-no">${index + 1}</span>
            <span class="rank-avatar">${p.avatar || "🎽"}</span>
            <span class="rank-name">${p.name}${p.seat === session.seat ? " (나)" : ""}</span>
            <span class="rank-detail">${p.badges.map((b) => b.icon).join("") || "—"}</span>
            <span class="rank-meta">포획 ${p.cards.length} · 진화 ${p.evolutions.length}</span>
            <span class="rank-score">★${p.score}</span>
          </li>`
          )
          .join("")}
      </ol>
      <div class="result-actions">
        <button id="result-again" class="start">🔄 다시 하기</button>
        <button id="result-home" class="btn-new-game">🏠 로비로</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#result-again").addEventListener("click", () => {
    overlay.remove();
    fx.clearLayer();
    startGame(state.playerCount, session.isSolo);
  });
  overlay.querySelector("#result-home").addEventListener("click", () => {
    overlay.remove();
    fx.clearLayer();
    state = null;
    session.online = false;
    render();
  });
}

function render() {
  if (!state) renderSetup();
  else if (session.view === "tui") renderTui();
  else renderBoard();
}

window.render_game_to_text = () =>
  JSON.stringify({
    mode: state ? "playing" : "setup",
    activePlayer: state?.players[state.active]?.name,
    turn: state?.turn,
    bank: state?.bank,
    pending: state?.pending,
    scores: state?.players.map((p) => ({
      name: p.name,
      score: p.score,
      cards: p.cards.length,
      evolutions: p.evolutions.length,
      reserved: p.reserved.length,
      isCpu: p.isCpu,
    })),
    rare: state?.market.rare.map((c) => c.name),
    legend: state?.market.legend.map((c) => c.name),
    winner: state?.winner ?? null,
  });

window.advanceTime = () => render();
render();
