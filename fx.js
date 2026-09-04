// 사운드 & 연출 엔진
// - 오디오 파일 없이 Web Audio API로 합성한다 (에셋 0, 네트워크 요청 0)
// - 애니메이션은 body 직속 오버레이에서 재생하므로 app의 전체 재렌더에 파괴되지 않는다

const STORAGE_KEY = "splendor-pokemon-muted";

let ctx = null;
let master = null;
let muted = false;
try {
  muted = localStorage.getItem(STORAGE_KEY) === "1";
} catch {
  muted = false;
}

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function audio() {
  if (ctx) return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = 0.28;
  master.connect(ctx.destination);
  return ctx;
}

export function unlockAudio() {
  const c = audio();
  if (c && c.state === "suspended") c.resume();
}

export function isMuted() {
  return muted;
}

export function setMuted(next) {
  muted = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    /* 저장 실패는 무시한다 */
  }
}

function tone({ freq, endFreq, type = "sine", dur = 0.15, gain = 0.2, at = 0 }) {
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t0 + dur);
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.02, dur * 0.25));
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(env).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise({ dur = 0.12, gain = 0.12, at = 0, hp = 800 }) {
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime + at;
  const frames = Math.max(1, Math.floor(c.sampleRate * dur));
  const buffer = c.createBuffer(1, frames, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = hp;
  const env = c.createGain();
  env.gain.setValueAtTime(gain, t0);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(env).connect(master);
  src.start(t0);
}

const NOTE = { C4: 261.6, D4: 293.7, E4: 329.6, F4: 349.2, G4: 392, A4: 440, B4: 493.9, C5: 523.3, D5: 587.3, E5: 659.3, G5: 784, C6: 1046.5 };

const RECIPES = {
  tokenPick: () => tone({ freq: 880, type: "triangle", dur: 0.07, gain: 0.16 }),
  tokenTake: () => [NOTE.E5, NOTE.G5, NOTE.C6].forEach((f, i) => tone({ freq: f, type: "triangle", dur: 0.11, gain: 0.16, at: i * 0.05 })),
  reserve: () => {
    tone({ freq: 320, endFreq: 180, type: "sine", dur: 0.16, gain: 0.2 });
    noise({ dur: 0.08, gain: 0.07, hp: 1200, at: 0.02 });
  },
  // 포켓볼을 던져 흔들리다 잠기는 소리
  capture: () => {
    noise({ dur: 0.1, gain: 0.1, hp: 900 });
    tone({ freq: 520, endFreq: 240, type: "square", dur: 0.12, gain: 0.13, at: 0.02 });
    [0.22, 0.42, 0.62].forEach((at) => tone({ freq: 400, type: "sine", dur: 0.09, gain: 0.11, at }));
    [NOTE.C5, NOTE.E5, NOTE.G5].forEach((f, i) => tone({ freq: f, type: "triangle", dur: 0.16, gain: 0.18, at: 0.82 + i * 0.06 }));
  },
  evolve: () => {
    tone({ freq: 220, endFreq: 1400, type: "sawtooth", dur: 0.5, gain: 0.12 });
    [NOTE.G4, NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6].forEach((f, i) => tone({ freq: f, type: "triangle", dur: 0.2, gain: 0.16, at: 0.42 + i * 0.07 }));
  },
  badge: () => [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6].forEach((f, i) => tone({ freq: f, type: "square", dur: 0.16, gain: 0.14, at: i * 0.08 })),
  turn: () => tone({ freq: 520, type: "sine", dur: 0.06, gain: 0.1 }),
  error: () => tone({ freq: 150, endFreq: 90, type: "sawtooth", dur: 0.2, gain: 0.14 }),
  win: () => {
    const melody = [[NOTE.C5, 0], [NOTE.E5, 0.13], [NOTE.G5, 0.26], [NOTE.C6, 0.39], [NOTE.G5, 0.56], [NOTE.C6, 0.68]];
    melody.forEach(([f, at]) => {
      tone({ freq: f, type: "square", dur: 0.24, gain: 0.16, at });
      tone({ freq: f / 2, type: "triangle", dur: 0.24, gain: 0.1, at });
    });
  },
  lose: () => {
    [[NOTE.G4, 0], [NOTE.F4, 0.2], [NOTE.E4, 0.4], [NOTE.C4, 0.62]].forEach(([f, at]) =>
      tone({ freq: f, type: "triangle", dur: 0.34, gain: 0.15, at })
    );
  },
};

export function play(name) {
  if (muted) return;
  const recipe = RECIPES[name];
  if (!recipe) return;
  const c = audio();
  if (!c) return;
  if (c.state === "suspended") c.resume();
  try {
    recipe();
  } catch {
    /* 오디오 실패가 게임을 막아서는 안 된다 */
  }
}

// ── 애니메이션 오버레이 ─────────────────────────────
function layer() {
  let el = document.querySelector("#fx-layer");
  if (!el) {
    el = document.createElement("div");
    el.id = "fx-layer";
    document.body.appendChild(el);
  }
  return el;
}

function animate(el, keyframes, options) {
  const anim = el.animate(keyframes, options);
  anim.finished.catch(() => {}).finally(() => el.remove());
  return anim;
}

/**
 * 요소를 복제해 목적지까지 날린다.
 * 원본은 호출 즉시 복제한다 — app의 전체 재렌더가 원본 DOM을 교체해도 연출이 살아남아야 하기 때문이다.
 * 목적지는 재렌더 이후에 존재하므로 애니메이션 직전에 선택자로 조회한다.
 */
export function flyTo(sourceEl, destSel, { scale = 0.35, duration = 620, delay = 0 } = {}) {
  if (reduced() || !sourceEl) return;
  const from = sourceEl.getBoundingClientRect();
  if (!from.width) return;

  const clone = sourceEl.cloneNode(true);
  clone.className = `${clone.className} fx-flying`;
  Object.assign(clone.style, {
    position: "fixed",
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    margin: "0",
    opacity: delay ? "0" : "1",
    pointerEvents: "none",
  });
  layer().appendChild(clone);

  const start = () => {
    if (!clone.isConnected) return;
    clone.style.opacity = "1";
    const to = document.querySelector(destSel)?.getBoundingClientRect();
    const dx = to ? to.left + to.width / 2 - (from.left + from.width / 2) : 0;
    const dy = to ? to.top + to.height / 2 - (from.top + from.height / 2) : -90;
    animate(
      clone,
      [
        { transform: "translate(0,0) scale(1) rotate(0deg)", opacity: 1 },
        {
          transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 60}px) scale(${(1 + scale) / 2}) rotate(-8deg)`,
          opacity: 0.95,
          offset: 0.55,
        },
        { transform: `translate(${dx}px, ${dy}px) scale(${scale}) rotate(6deg)`, opacity: 0 },
      ],
      { duration, easing: "cubic-bezier(0.4, 0, 0.2, 1)" }
    );
  };

  // 최소 한 프레임을 기다려 재렌더가 끝난 뒤의 목적지 좌표를 쓴다
  if (delay) window.setTimeout(() => requestAnimationFrame(start), delay);
  else requestAnimationFrame(start);
}

/** 포켓볼을 던져 카드를 포획하는 연출 */
export function throwBall(targetEl) {
  if (reduced() || !targetEl) return;
  const rect = targetEl.getBoundingClientRect();
  if (!rect.width) return;
  const ball = document.createElement("div");
  ball.className = "fx-ball";
  Object.assign(ball.style, {
    position: "fixed",
    left: `${rect.left + rect.width / 2 - 17}px`,
    top: `${window.innerHeight - 90}px`,
  });
  layer().appendChild(ball);
  const dy = rect.top + rect.height / 2 - (window.innerHeight - 90);
  animate(
    ball,
    [
      { transform: "translate(0,0) rotate(0deg) scale(0.7)", opacity: 1 },
      { transform: `translate(0, ${dy * 0.55 - 120}px) rotate(540deg) scale(1)`, offset: 0.45 },
      { transform: `translate(0, ${dy}px) rotate(1080deg) scale(0.9)`, opacity: 1, offset: 0.75 },
      { transform: `translate(0, ${dy}px) rotate(1080deg) scale(1.5)`, opacity: 0 },
    ],
    { duration: 700, easing: "cubic-bezier(0.35, 0, 0.3, 1)" }
  );
  burst(rect, 14, 620);
}

/** 지정 위치에서 입자를 터뜨린다 */
export function burst(rect, count = 12, delay = 0) {
  if (reduced() || !rect) return;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  window.setTimeout(() => {
    for (let i = 0; i < count; i += 1) {
      const p = document.createElement("span");
      p.className = "fx-spark";
      Object.assign(p.style, { position: "fixed", left: `${cx}px`, top: `${cy}px` });
      layer().appendChild(p);
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const dist = 50 + Math.random() * 70;
      animate(
        p,
        [
          { transform: "translate(-50%,-50%) scale(1)", opacity: 1 },
          { transform: `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${Math.sin(angle) * dist}px)) scale(0)`, opacity: 0 },
        ],
        { duration: 520 + Math.random() * 220, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" }
      );
    }
  }, delay);
}

/** 화면 전체를 짧게 물들인다 */
export function flash(color = "rgba(255,255,255,0.55)", duration = 420) {
  if (reduced()) return;
  const el = document.createElement("div");
  el.className = "fx-flash";
  el.style.background = color;
  layer().appendChild(el);
  animate(el, [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 0 }], { duration });
}

/** 배지 획득 배너 */
export function badgeBanner(badge, ownerName) {
  const el = document.createElement("div");
  el.className = "fx-badge-banner";
  el.innerHTML = `<span class="fx-badge-icon">${badge.icon}</span><div><b>${badge.name} 획득!</b><small>${ownerName} · ★${badge.points}</small></div>`;
  layer().appendChild(el);
  if (reduced()) {
    window.setTimeout(() => el.remove(), 1600);
    return;
  }
  animate(
    el,
    [
      { transform: "translate(-50%, -50%) scale(0.6)", opacity: 0 },
      { transform: "translate(-50%, -50%) scale(1.06)", opacity: 1, offset: 0.2 },
      { transform: "translate(-50%, -50%) scale(1)", opacity: 1, offset: 0.8 },
      { transform: "translate(-50%, -50%) scale(0.94)", opacity: 0 },
    ],
    { duration: 1900, easing: "ease-out" }
  );
  flash("rgba(251,191,36,0.22)", 420);
}

/** 승리 축포 */
export function confetti(duration = 3400) {
  if (reduced()) return;
  const canvas = document.createElement("canvas");
  canvas.className = "fx-confetti";
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  layer().appendChild(canvas);
  const g = canvas.getContext("2d");
  const colors = ["#ef4444", "#3b82f6", "#eab308", "#22c55e", "#f8fafc", "#d946ef"];
  const bits = Array.from({ length: 150 }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * canvas.height * 0.6,
    w: 6 + Math.random() * 7,
    h: 9 + Math.random() * 10,
    vy: 2.2 + Math.random() * 3.4,
    vx: -1.4 + Math.random() * 2.8,
    rot: Math.random() * Math.PI,
    vr: -0.16 + Math.random() * 0.32,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  const started = performance.now();
  function frame(now) {
    const elapsed = now - started;
    g.clearRect(0, 0, canvas.width, canvas.height);
    const fade = elapsed > duration - 700 ? Math.max(0, (duration - elapsed) / 700) : 1;
    g.globalAlpha = fade;
    for (const b of bits) {
      b.x += b.vx;
      b.y += b.vy;
      b.rot += b.vr;
      if (b.y > canvas.height + 30) {
        b.y = -20;
        b.x = Math.random() * canvas.width;
      }
      g.save();
      g.translate(b.x, b.y);
      g.rotate(b.rot);
      g.fillStyle = b.color;
      g.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      g.restore();
    }
    if (elapsed < duration) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}

export function clearLayer() {
  const el = document.querySelector("#fx-layer");
  if (el) el.innerHTML = "";
}
