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
  token: null,
  online: false,
  isSolo: false,
  host: false,
  capacity: 0,
  connected: 0,
  seatStates: [],
  revision: 0,
  // "connecting" | "online" | "reconnecting" | "lost"
  link: "online",
  view: "board",
  mobileTab: "market",
  tutorialStep: null,
  settingsOpen: false,
  // 모바일에서 카드를 눌렀을 때 올라오는 바텀시트의 대상 카드
  cardSheet: null,
  myTab: "collection",
};

const SESSION_KEY = "splendor-pokemon-session";
let reconnectTimer = null;
let reconnectAttempt = 0;

function saveSession() {
  if (!session.online || !session.code || !session.token) return;
  try {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ code: session.code, seat: session.seat, token: session.token, at: Date.now() })
    );
  } catch {
    /* 저장이 막혀 있어도 게임 자체는 계속되어야 한다 */
  }
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    // 서버 자리 유예(10분)보다 넉넉히 잡되, 며칠 지난 세션은 되살리지 않는다
    if (!saved?.code || !saved?.token || Date.now() - (saved.at || 0) > 12 * 60 * 60 * 1000) return null;
    return saved;
  } catch {
    return null;
  }
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* 무시 */
  }
}

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
  session.cardSheet = null;
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
  // 게임 시작 클릭은 사용자 제스처이므로 이 시점에 오디오를 열 수 있다
  fx.unlockAudio();
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
    items.push(`<span class="cost-chip wild"><span class="chip-dot"></span><b class="cost-num">1</b></span>`);
  }
  COLORS.forEach((c) => {
    if (cost[c]) {
      items.push(`<span class="cost-chip ${c}"><span class="chip-dot"></span><b class="cost-num">${cost[c]}</b></span>`);
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

function settingsMarkup() {
  if (!session.settingsOpen) return "";
  const audio = fx.getAudioPrefs();
  return `
    <div class="settings-backdrop" id="settings-backdrop">
      <section class="settings-sheet" role="dialog" aria-label="설정">
        <header class="settings-head">
          <h3>⚙️ 설정</h3>
          <button class="settings-close" id="settings-close" aria-label="닫기">✕</button>
        </header>

        <div class="settings-group">
          <span class="settings-label">🎵 사운드</span>
          <p class="settings-hint">이 설정은 내 기기에만 적용됩니다. 다른 트레이너에게는 영향을 주지 않아요.</p>
          <button class="settings-toggle ${audio.bgm ? "on" : ""}" data-audio="bgm">
            <span>배경음악 (BGM)</span>
            <span class="toggle-pill">${audio.bgm ? "켜짐" : "꺼짐"}</span>
          </button>
          <button class="settings-toggle ${audio.sfx ? "on" : ""}" data-audio="sfx">
            <span>효과음</span>
            <span class="toggle-pill">${audio.sfx ? "켜짐" : "꺼짐"}</span>
          </button>
        </div>

        ${
          session.isSolo
            ? `<div class="settings-group">
                 <span class="settings-label">⏱️ CPU 진행 속도</span>
                 <div class="settings-row">
                   ${CPU_SPEED_ORDER.map(
                     (id) => `<button class="settings-choice ${soloSettings.cpuSpeed === id ? "on" : ""}" data-speed="${id}">
                       ${CPU_SPEEDS[id].icon} ${CPU_SPEEDS[id].label}
                     </button>`
                   ).join("")}
                 </div>
               </div>`
            : ""
        }

        <div class="settings-group">
          <span class="settings-label">🖥️ 화면</span>
          <div class="settings-row">
            <button class="settings-choice ${session.view === "board" ? "on" : ""}" data-view="board">보드</button>
            <button class="settings-choice ${session.view === "tui" ? "on" : ""}" data-view="tui">TUI</button>
          </div>
        </div>

        <button class="settings-exit" id="btn-home">🏠 로비로 나가기</button>
      </section>
    </div>`;
}

function linkBannerMarkup() {
  if (!session.online || session.link === "online") return "";
  if (session.link === "lost") {
    return `
      <div class="link-banner lost">
        <span>세션이 만료되어 자리를 잃었습니다.</span>
        <button id="link-retry" class="link-retry">다시 시도</button>
        <button id="link-home" class="link-retry ghost">로비로</button>
      </div>`;
  }
  return `
    <div class="link-banner ${session.link}">
      <span class="link-spinner"></span>
      <span>${session.link === "reconnecting" ? "연결이 끊겼습니다. 다시 잇는 중…" : "연결 중…"}</span>
    </div>`;
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

/**
 * 포켓볼 공급처. 데스크톱 우측과 모바일 하단 트레이가 같은 마크업을 쓴다.
 * 남은 개수를 점으로 시각화해 "얼마나 남았는지"를 숫자보다 빠르게 읽게 한다.
 */
function supplyMarkup({ compact = false } = {}) {
  const me = current();
  const threshold = perk(me, "sameColorThreshold", 4);
  const blocked = !isMine() || Boolean(state.pending) || state.finished;

  const ball = (c) => {
    const left = state.bank[c];
    const picked = selectedTokens.filter((t) => t === c).length;
    const max = state.playerCount === 2 ? 4 : state.playerCount === 3 ? 5 : 7;
    return `
      <button class="ball-token-btn ${c} ${picked ? "selected-token" : ""} ${left < 1 ? "depleted" : ""}"
              data-token="${c}"
              title="${left < 1 ? `${labels[c]} 소진` : `${labels[c]} · ${left}개 남음`}"
              ${blocked || left < 1 ? "disabled" : ""}>
        <span class="chip-ball ${c}"><span class="chip-dot"></span></span>
        <span class="ball-meta">
          <span class="ball-name">${labels[c]}</span>
          <b class="ball-count">${left}</b>
        </span>
        <span class="ball-gauge" aria-hidden="true">
          ${Array.from({ length: max }, (_, i) => `<i class="${i < left ? "on" : ""}"></i>`).join("")}
        </span>
        ${picked ? `<span class="ball-picked">+${picked}</span>` : ""}
      </button>`;
  };

  return `
    <section class="supply-box ${compact ? "compact" : ""}">
      ${compact ? "" : `<p class="supply-tip">서로 다른 색 3개 · 또는 ${threshold}개 이상 남은 같은 색 2개</p>`}
      <div class="supply-grid">${COLORS.map(ball).join("")}</div>
      <div class="supply-wild" title="카드를 손에 보관하면 얻습니다">
        <span class="chip-ball wild"><span class="chip-dot"></span></span>
        <span class="ball-name">마스터볼</span>
        <b class="ball-count">${state.bank.wild}</b>
        <span class="wild-note">희귀·전설 포획 전용</span>
      </div>
    </section>`;
}

/** 내 도감 / 보관함을 탭으로 묶는다. */
function myPanelMarkup() {
  const me = state.players[session.seat];
  if (!me) return "";
  const reserveLimit = perk(me, "reserveLimit", 3);
  const isCollection = session.myTab === "collection";

  return `
    <div class="my-panel">
      <div class="my-tabs">
        <button class="my-tab ${isCollection ? "on" : ""}" data-mytab="collection">
          📕 내 도감 <b>${me.cards.length + me.evolutions.length}</b>
        </button>
        <button class="my-tab ${isCollection ? "" : "on"}" data-mytab="reserve">
          🎒 보관함 <b>${me.reserved.length}/${reserveLimit}</b>
        </button>
      </div>
      ${isCollection ? collectionMarkup() : reserveBoxMarkup()}
    </div>`;
}

function reserveBoxMarkup() {
  const me = state.players[session.seat];
  const firstTarget = target();
  return `
    <section class="my-reserve-box">
      ${
        me.reserved.length
          ? `<div class="reserved-cards-list">${me.reserved
              .map((c) => cardMarkup(c, firstTarget, "reserved"))
              .join("")}</div>`
          : `<div class="empty-reserve-slot">
               보관한 포켓몬이 없습니다<br />
               <small>카드를 보관하면 마스터볼을 받습니다</small>
             </div>`
      }
    </section>`;
}

/** 모바일에서 카드를 누르면 올라오는 바텀시트. 엄지로 닿는 위치에 큰 버튼을 둔다. */
function cardSheetMarkup() {
  if (!session.cardSheet) return "";
  const all = Object.values(state.market).flat().concat(state.players[session.seat]?.reserved || []);
  const card = all.find((c) => c.id === session.cardSheet);
  if (!card) return "";

  const me = current();
  const afford = me ? affordability(me, card) : null;
  const isSpecial = card.kind !== "normal";
  const inReserve = (state.players[session.seat]?.reserved || []).some((c) => c.id === card.id);
  const canAct = isMine() && !state.pending && !state.finished;
  const reserveFull = me ? me.reserved.length >= perk(me, "reserveLimit", 3) : false;
  const stageLabel = card.kind === "rare" ? "희귀" : card.kind === "legend" ? "전설·환상" : `${card.stage}단계`;

  return `
    <div class="card-sheet-backdrop" id="card-sheet-backdrop">
      <section class="card-sheet ${card.bonus}">
        <span class="sheet-grip"></span>
        <div class="sheet-head">
          <img class="sheet-art" src="${card.artwork}" alt="${card.name}" />
          <div class="sheet-info">
            <b class="sheet-name">${card.name}</b>
            <span class="sheet-stage">${stageLabel} · 보너스 ${labels[card.bonus]} ×${card.bonusCount}</span>
            <span class="sheet-points">★${card.points}</span>
          </div>
        </div>

        <div class="sheet-cost">
          <span class="sheet-cost-label">필요한 볼</span>
          <div class="sheet-cost-chips">${costMarkup(afford ? afford.cost : card.cost, card.masterRequired)}</div>
        </div>

        <div class="sheet-afford">${afford ? shortfallMarkup(afford, card) : ""}</div>

        <div class="sheet-actions">
          <button class="sheet-btn buy" data-buy="${card.id}" ${canAct && afford?.canBuy ? "" : "disabled"}>
            ⚡ 잡기
          </button>
          <button class="sheet-btn reserve" data-reserve-card="${card.id}"
                  ${canAct && !isSpecial && !reserveFull && !inReserve ? "" : "disabled"}>
            🎒 보관
          </button>
        </div>
        <button class="sheet-close" id="card-sheet-close">닫기</button>
      </section>
    </div>`;
}

function trainerCardMarkup(p) {
  const trainer = TRAINERS.find((t) => t.id === p.trainerId);
  const isMe = p.seat === session.seat;
  const isActive = p.seat === state.active && !state.finished;
  const owned = p.cards.concat(p.evolutions);
  const reserveLimit = perk(p, "reserveLimit", 3);
  const progress = Math.min(100, Math.round((p.score / WIN_SCORE) * 100));
  const seatState = session.online ? session.seatStates.find((entry) => entry.seat === p.seat) : null;

  return `
    <article class="trainer-card ${isActive ? "active" : ""} ${isMe ? "me" : ""}" data-seat="${p.seat}" tabindex="0">
      <div class="tc-top">
        <span class="tc-avatar">${p.avatar || "🎽"}</span>
        <div class="tc-id">
          <b class="tc-name">${p.name}${isMe ? " (나)" : ""}</b>
          <span class="tc-title">
            ${trainer?.title || ""}
            ${p.isCpu ? `<span class="cpu-tag">${p.difficultyLabel || "CPU"}</span>` : ""}
          </span>
        </div>
        <div class="tc-score-wrap">
          <span class="tc-score ${p.score >= WIN_SCORE - 3 ? "near" : ""}">★${p.score}</span>
          <span class="tc-goal">/${WIN_SCORE}</span>
        </div>
      </div>

      <div class="tc-progress"><span style="width:${progress}%"></span></div>

      <div class="tc-bonuses">
        ${COLORS.map(
          (c) => `<span class="tc-bonus ${c} ${p.bonuses[c] ? "has" : ""}" title="${labels[c]} 보너스 ${p.bonuses[c]}개">
            <i class="tc-dot"></i>${p.bonuses[c]}
          </span>`
        ).join("")}
        <span class="tc-bonus wild ${p.tokens.wild ? "has" : ""}" title="보유 마스터볼 ${p.tokens.wild}개">
          <i class="tc-dot"></i>${p.tokens.wild}
        </span>
      </div>

      <div class="tc-meta">
        <span title="포획한 포켓몬">🃏 ${p.cards.length}</span>
        <span title="진화시킨 포켓몬">🧬 ${p.evolutions.length}</span>
        <span title="손에 보관 중">🎒 ${p.reserved.length}/${reserveLimit}</span>
        <span class="tc-badges" title="획득한 체육관 배지">${p.badges.map((b) => b.icon).join("") || "🏅 0"}</span>
      </div>

      ${
        isActive && p.isCpu
          ? `<div class="cpu-thinking-pill"><span>⚡ 수 계산 중...</span></div>`
          : ""
      }
      ${
        seatState && !seatState.online
          ? `<div class="tc-offline">📴 접속 끊김 — 자리 유지 중</div>`
          : ""
      }

      <!-- 호버·포커스 시 펼쳐지는 상세 -->
      <div class="tc-detail">
        <div class="tcd-head">
          <span>${p.avatar || "🎽"} ${p.name}</span>
          <span class="tcd-perk">${trainer?.title || ""}</span>
        </div>
        <p class="tcd-desc">${trainer?.desc || ""}</p>
        <div class="tcd-row">
          <span class="tcd-label">보유 볼</span>
          <div class="tcd-tokens">
            ${COLORS.map((c) => `<span class="tcd-token ${c}">${p.tokens[c]}</span>`).join("")}
            <span class="tcd-token wild">M${p.tokens.wild}</span>
          </div>
        </div>
        <div class="tcd-row">
          <span class="tcd-label">포획 ${owned.length}장</span>
          <div class="tcd-cards">
            ${
              owned.length
                ? owned
                    .slice(-12)
                    .map(
                      (card) =>
                        `<span class="tcd-card ${card.kind !== "normal" ? "special" : ""}" title="${card.name} ★${card.points}">
                          <img src="${card.artwork}" alt="${card.name}" loading="lazy" />
                        </span>`
                    )
                    .join("")
                : `<span class="tcd-empty">아직 없음</span>`
            }
          </div>
        </div>
        ${
          p.badges.length
            ? `<div class="tcd-row">
                 <span class="tcd-label">배지</span>
                 <div class="tcd-badges">${p.badges.map((b) => `<span title="${b.name}">${b.icon} ${b.name}</span>`).join("")}</div>
               </div>`
            : ""
        }
      </div>
    </article>`;
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
  const me = state.players[session.seat];
  const myTurn = isMine() && !state.pending && !state.finished;

  let modeBadge = "솔로 규칙 연습";
  if (session.online) modeBadge = `온라인 ${session.code} · ${session.seat + 1}번 자리`;
  else if (session.isSolo) modeBadge = `🤖 CPU 대전 · ${state.playerCount}인 (${currentDiffPreset.label})`;

  app.innerHTML = `
    <section class="game ${session.mobileTab ? `tab-${session.mobileTab}` : ""} ${myTurn ? "my-turn" : ""}">
      <header class="topbar">
        <div class="brand-group">
          <h1><span>스플렌더</span> 포켓몬</h1>
          <div class="rule-badge">${modeBadge}</div>
        </div>

        <div class="topbar-actions">
          <button class="rulebook-btn" id="open-rulebook">🎓 룰북</button>
          <button class="icon-btn" id="open-settings" title="설정" aria-label="설정">⚙️</button>
        </div>

        <div class="status-badge ${state.finished ? "finished" : ""} ${myTurn ? "mine" : ""}">
          ${
            state.finished
              ? `🏆 ${state.players[state.winner].name} 승리!`
              : myTurn
                ? `🎯 내 차례 · ${state.turn}R`
                : `⏳ ${current().name}의 차례 · ${state.turn}R`
          }
        </div>
      </header>

      ${linkBannerMarkup()}

      <!-- 모바일 요약 바: 내 점수와 보너스를 항상 보이게 -->
      <div class="mobile-me" id="mobile-me">
        <span class="mm-avatar">${me?.avatar || "🎽"}</span>
        <span class="mm-score">★${me?.score ?? 0}<i>/${WIN_SCORE}</i></span>
        <div class="mm-bonuses">
          ${COLORS.map((c) => `<span class="mm-b ${c} ${me?.bonuses[c] ? "has" : ""}">${me?.bonuses[c] ?? 0}</span>`).join("")}
          <span class="mm-b wild ${me?.tokens.wild ? "has" : ""}">M${me?.tokens.wild ?? 0}</span>
        </div>
        <span class="mm-more">👤 상세</span>
      </div>

      <!-- 모바일 탭 바 -->
      <nav class="mobile-nav" aria-label="모바일 보기 탭">
        <button class="m-tab ${session.mobileTab === "market" ? "active" : ""}" data-mtab="market">🃏 시장</button>
        <button class="m-tab ${session.mobileTab === "supply" ? "active" : ""}" data-mtab="supply">⚪ 볼 공급</button>
        <button class="m-tab ${session.mobileTab === "my" ? "active" : ""}" data-mtab="my">👤 내 현황</button>
        <button class="m-tab ${session.mobileTab === "players" ? "active" : ""}" data-mtab="players">👥 트레이너</button>
      </nav>

      <div class="board-layout">
        <!-- 좌측: 트레이너 현황판 -->
        <aside class="left-rail rail-panel">
          <div class="rail-title">트레이너 현황</div>
          <section class="players">
            ${state.players.map(trainerCardMarkup).join("")}
          </section>
        </aside>

        <!-- 중앙: 포켓몬 시장 -->
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
              ? `<div class="guide-callout">
                   <strong>💡 첫 포획 추천</strong>: <b>${firstTarget.name}</b>에 필요한 볼
                   <span class="inline-chips">${costMarkup(firstTarget.cost)}</span>을(를) 모아보세요!
                 </div>`
              : ""
          }

          ${badgeStripMarkup()}
          ${pendingMarkup()}

          <section class="special-market-row">
            <div class="special-market-col">
              <div class="tier-heading rare-heading">
                <span>🌟 희귀 포켓몬</span>
                <small>마스터볼 필수 · 더블 보너스</small>
              </div>
              <div class="special-cards-deck">
                <div class="deck-card rare-deck" title="희귀 덱 남은 카드 ${state.decks.rare.length}장">
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
                <span>👑 전설·환상 포켓몬</span>
                <small>마스터볼 필수 · 더블 보너스</small>
              </div>
              <div class="special-cards-deck">
                <div class="deck-card legend-deck" title="전설 덱 남은 카드 ${state.decks.legend.length}장">
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

          <section class="tier-market-list">
            ${[3, 2, 1]
              .map(
                (tier) => `
              <div class="tier-row tier-${tier}">
                <div class="tier-deck-side">
                  <button class="deck-card tier-deck" data-reserve-tier="${tier}"
                          ${!isMine() || state.pending || state.finished || me.reserved.length >= perk(me, "reserveLimit", 3) ? "disabled" : ""}
                          title="${tier}단계 덱 맨 위 카드를 보지 않고 보관 (마스터볼 획득)">
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
              </div>`
              )
              .join("")}
          </section>
        </main>

        <!-- 우측: 공급처 + 내 현황 -->
        <aside class="right-rail rail-panel">
          <div class="rail-title">포켓볼 공급처</div>
          ${supplyMarkup()}

          <div class="rail-title">내 현황</div>
          ${myPanelMarkup()}

          <div class="rail-title">게임 로그</div>
          <div class="game-log-box"><p>${state.log}</p></div>
        </aside>
      </div>

      <!-- 하단 조작 독: 모바일에서는 공급처가 여기 상시 노출되어 한 손으로 조작한다 -->
      <footer class="bottom-dock">
        <div class="dock-tray">
          ${COLORS.map((c) => {
            const left = state.bank[c];
            const picked = selectedTokens.filter((t) => t === c).length;
            return `
            <button class="tray-ball ${c} ${picked ? "picked" : ""} ${left < 1 ? "depleted" : ""}"
                    data-token="${c}"
                    ${!myTurn || left < 1 ? "disabled" : ""}
                    aria-label="${labels[c]} ${left}개 남음">
              <span class="chip-ball ${c}"><span class="chip-dot"></span></span>
              <span class="tray-left">${left}</span>
              ${picked ? `<span class="tray-picked">${picked}</span>` : ""}
            </button>`;
          }).join("")}
        </div>

        <div class="dock-container">
          <div class="dock-status">
            <div class="dock-turn-info">
              <b>${current().name}</b>의 차례
              ${!isMine() ? `<span class="dock-wait-pill">대기 중…</span>` : ""}
            </div>
            <div class="dock-selected-tokens">
              선택한 볼: <strong>${selectedTokens.map((c) => labels[c]).join(" / ") || "없음"}</strong>
            </div>
          </div>

          <div class="dock-actions">
            <button id="take-tokens" class="action-btn primary"
                    ${!selectedTokens.length || !myTurn ? "disabled" : ""}>
              ⚪ 볼 획득 (${selectedTokens.length})
            </button>
            <button id="clear-tokens" class="action-btn ghost" ${!selectedTokens.length ? "disabled" : ""}>
              선택 해제
            </button>
          </div>
        </div>
      </footer>

      ${cardSheetMarkup()}
      ${tutModalHtml}
      ${settingsMarkup()}
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
              <button data-token="${c}" ${!isMine() || state.pending || state.finished || state.bank[c] < 1 ? "disabled" : ""}>
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
  document.querySelector("#start")?.addEventListener("click", () => connect({ type: "create", playerCount: onlineCount }));
  document.querySelector("#join")?.addEventListener("click", () =>
    connect({ type: "join", code: document.querySelector("#room-code").value })
  );

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

function socketUrl() {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/ws`;
}

function setLink(next) {
  if (session.link === next) return;
  session.link = next;
  if (state) render();
}

/**
 * 서버와의 연결을 연다.
 * intent: { type: "create", playerCount } | { type: "join", code } | { type: "resume", code, seat, token }
 */
function connect(intent) {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  // 이전 소켓이 살아 있으면 정리하고 새로 연다
  if (session.socket) {
    const stale = session.socket;
    session.socket = null;
    stale.onclose = null;
    try {
      stale.close();
    } catch {
      /* 무시 */
    }
  }

  setLink(intent.type === "resume" ? "reconnecting" : "connecting");

  let socket;
  try {
    socket = new WebSocket(socketUrl());
  } catch {
    scheduleReconnect();
    return;
  }
  session.socket = socket;
  if (intent.type !== "resume") session.host = intent.type === "create";

  socket.addEventListener("open", () => {
    reconnectAttempt = 0;
    socket.send(JSON.stringify(intent));
  });

  socket.addEventListener("message", ({ data }) => {
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    handleServerMessage(message);
  });

  socket.addEventListener("close", () => {
    if (session.socket !== socket) return;
    session.socket = null;
    if (!session.online) return;
    setLink("reconnecting");
    scheduleReconnect();
  });

  socket.addEventListener("error", () => {
    // close 이벤트가 뒤따르므로 여기서는 상태만 표시한다
    if (session.socket === socket && session.online) setLink("reconnecting");
  });
}

/** 끊긴 연결을 되살린다. 처음 몇 번은 거의 즉시 시도해 1초 안에 복구되도록 한다. */
function scheduleReconnect() {
  if (reconnectTimer || !session.online) return;
  const saved = session.token ? { code: session.code, seat: session.seat, token: session.token } : loadSession();
  if (!saved) {
    setLink("lost");
    return;
  }
  const backoff = [0, 250, 500, 1000, 2000, 4000];
  const wait = backoff[Math.min(reconnectAttempt, backoff.length - 1)];
  reconnectAttempt += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connect({ type: "resume", code: saved.code, seat: saved.seat, token: saved.token });
  }, wait);
}

function applySnapshot(snapshot, revision) {
  if (!snapshot) return;
  // 뒤처진 스냅샷이 늦게 도착해 최신 상태를 덮어쓰지 않도록 한다
  if (typeof revision === "number" && revision < session.revision) return;
  if (typeof revision === "number") session.revision = revision;
  state = snapshot;
  selectedTokens = [];
  reserveMode = false;
  returnSelection = {};
  render();
  maybeShowResult();
}

function handleServerMessage(message) {
  if (message.type === "error") {
    session.online = false;
    session.socket = null;
    clearSession();
    setLink("online");
    alert(message.message);
    renderSetup();
    return;
  }

  if (message.type === "resume-failed") {
    // 자리가 이미 회수됐다. 조용히 실패하지 않고 명확히 알린다.
    session.online = false;
    clearSession();
    setLink("lost");
    render();
    return;
  }

  if (message.type === "welcome") {
    session.online = true;
    session.code = message.code;
    session.seat = message.seat;
    session.token = message.token;
    session.capacity = message.capacity;
    session.revision = message.revision || 0;
    reconnectAttempt = 0;
    saveSession();
    setLink("online");

    if (message.snapshot) {
      applySnapshot(message.snapshot, message.revision);
    } else if (message.resumed) {
      // 서버에 아직 스냅샷이 없다면 직접 요청해 본다
      requestSync();
    } else {
      renderLobby();
    }
    return;
  }

  if (message.type === "presence") {
    session.connected = message.connected;
    session.capacity = message.capacity;
    session.seatStates = message.seats || [];
    if (session.host && !state && session.connected === session.capacity) {
      startGame(session.capacity, false);
    } else if (!state) {
      renderLobby();
    } else {
      render();
    }
    return;
  }

  if (message.type === "snapshot") {
    applySnapshot(message.snapshot, message.revision);
  }
}

function requestSync() {
  if (session.socket?.readyState === WebSocket.OPEN) {
    session.socket.send(JSON.stringify({ type: "sync-request" }));
  }
}

/** 화면 복귀·네트워크 복구 시 지체 없이 따라잡는다. */
function watchConnection() {
  const revive = () => {
    if (!session.online) return;
    if (session.socket?.readyState === WebSocket.OPEN) {
      // 연결은 살아 있어도 백그라운드에서 놓친 갱신이 있을 수 있다
      requestSync();
      return;
    }
    reconnectAttempt = 0;
    scheduleReconnect();
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") revive();
  });
  window.addEventListener("focus", revive);
  window.addEventListener("online", revive);
  window.addEventListener("pageshow", revive);
}

watchConnection();

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
      session.settingsOpen = false;
      render();
    });
  });

  document.querySelector("#btn-home")?.addEventListener("click", () => {
    if (cpuTimer) {
      clearTimeout(cpuTimer);
      cpuTimer = null;
    }
    if (session.online) {
      clearSession();
      session.online = false;
      session.token = null;
      try {
        session.socket?.close();
      } catch {
        /* 무시 */
      }
      session.socket = null;
    }
    state = null;
    render();
  });

  document.querySelectorAll("[data-mtab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      session.mobileTab = btn.dataset.mtab;
      render();
    });
  });

  document.querySelectorAll("[data-mytab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      session.myTab = btn.dataset.mytab;
      render();
    });
  });

  // 모바일 요약 바를 누르면 내 현황 탭으로 바로 이동
  document.querySelector("#mobile-me")?.addEventListener("click", () => {
    session.mobileTab = "my";
    render();
  });

  document.querySelector("#clear-tokens")?.addEventListener("click", () => {
    selectedTokens = [];
    render();
  });

  // 모바일에서는 카드를 누르면 바텀시트가 열린다 (좁은 화면에서 작은 버튼을 겨냥하지 않아도 되도록)
  document.querySelectorAll("[data-card-root]").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest(".card-act")) return;
      if (!window.matchMedia("(max-width: 768px)").matches) return;
      session.cardSheet = card.dataset.cardRoot;
      fx.unlockAudio();
      fx.play("tokenPick");
      render();
    });
  });

  const closeSheet = () => {
    session.cardSheet = null;
    render();
  };
  document.querySelector("#card-sheet-close")?.addEventListener("click", closeSheet);
  document.querySelector("#card-sheet-backdrop")?.addEventListener("click", (event) => {
    if (event.target.id === "card-sheet-backdrop") closeSheet();
  });

  document.querySelector("#open-rulebook")?.addEventListener("click", () => {
    session.tutorialStep = 0;
    render();
  });

  document.querySelector("#open-settings")?.addEventListener("click", () => {
    fx.unlockAudio();
    session.settingsOpen = true;
    render();
  });

  const closeSettings = () => {
    session.settingsOpen = false;
    render();
  };
  document.querySelector("#settings-close")?.addEventListener("click", closeSettings);
  document.querySelector("#settings-backdrop")?.addEventListener("click", (event) => {
    if (event.target.id === "settings-backdrop") closeSettings();
  });

  document.querySelectorAll("[data-audio]").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.dataset.audio;
      const prefs = fx.getAudioPrefs();
      fx.unlockAudio();
      if (kind === "bgm") fx.setBgmEnabled(!prefs.bgm);
      else {
        fx.setSfxEnabled(!prefs.sfx);
        if (!prefs.sfx) fx.play("tokenTake");
      }
      render();
    });
  });

  document.querySelectorAll("[data-speed]").forEach((button) => {
    button.addEventListener("click", () => {
      soloSettings.cpuSpeed = button.dataset.speed;
      render();
    });
  });

  document.querySelector("#link-retry")?.addEventListener("click", () => {
    reconnectAttempt = 0;
    session.online = true;
    scheduleReconnect();
    setLink("reconnecting");
  });

  document.querySelector("#link-home")?.addEventListener("click", () => {
    clearSession();
    session.online = false;
    session.token = null;
    state = null;
    render();
  });

  document.querySelectorAll("[data-token]").forEach((button) => {
    button.addEventListener("click", () => {
      const color = button.dataset.token;
      if (selectedTokens.length === 1 && selectedTokens[0] === color) {
        const threshold = perk(current(), "sameColorThreshold", 4);
        selectedTokens = state.bank[color] >= threshold ? [color, color] : [];
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
    const color = button.dataset.token;
    const picked = selectedTokens.filter((t) => t === color).length;
    // 공급처 패널과 하단 트레이가 같은 선택 상태를 공유한다
    button.classList.toggle("selected-token", picked > 0);
    button.classList.toggle("picked", picked > 0);

    const trayBadge = button.querySelector(".tray-picked");
    if (button.classList.contains("tray-ball")) {
      if (picked > 0) {
        if (trayBadge) trayBadge.textContent = String(picked);
        else {
          const badge = document.createElement("span");
          badge.className = "tray-picked";
          badge.textContent = String(picked);
          button.appendChild(badge);
        }
      } else if (trayBadge) {
        trayBadge.remove();
      }
    }

    const supplyBadge = button.querySelector(".ball-picked");
    if (button.classList.contains("ball-token-btn")) {
      if (picked > 0) {
        if (supplyBadge) supplyBadge.textContent = `+${picked}`;
        else {
          const badge = document.createElement("span");
          badge.className = "ball-picked";
          badge.textContent = `+${picked}`;
          button.appendChild(badge);
        }
      } else if (supplyBadge) {
        supplyBadge.remove();
      }
    }
  });

  const clear = document.querySelector("#clear-tokens");
  if (clear) clear.disabled = !selectedTokens.length;
  const selected = selectedTokens.map((c) => labels[c]).join(" / ") || "없음";
  const summary =
    document.querySelector(".dock-selected-tokens strong") || document.querySelector(".my-board span:last-child");
  if (summary) summary.textContent = selected;
  const take = document.querySelector("#take-tokens");
  if (take) {
    take.disabled = !selectedTokens.length || !isMine() || Boolean(state.pending) || state.finished;
    take.textContent = `⚪ 볼 획득 (${selectedTokens.length})`;
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

// 새로고침이나 탭 복귀로 앱이 다시 뜬 경우, 진행 중이던 온라인 세션을 자동 복구한다.
function restoreSessionOnBoot() {
  const saved = loadSession();
  if (!saved) return false;
  session.online = true;
  session.code = saved.code;
  session.seat = saved.seat;
  session.token = saved.token;
  connect({ type: "resume", code: saved.code, seat: saved.seat, token: saved.token });
  return true;
}

if (!restoreSessionOnBoot()) render();
else render();
