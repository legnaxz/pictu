// 사운드 & 연출 엔진
// - 오디오 파일 없이 Web Audio API로 합성한다 (에셋 0, 네트워크 요청 0)
// - 애니메이션은 body 직속 오버레이에서 재생하므로 app의 전체 재렌더에 파괴되지 않는다

// ─────────────────────────────────────────────────────────────
// 게임보이 사운드칩(PSG) 재현
//
// 실제 포켓몬 게임의 음원 파일은 저작권이 있어 사용할 수 없으므로,
// 그 소리를 만들어낸 하드웨어 특성을 Web Audio로 재현한다.
//   - 채널 1·2: 듀티사이클 펄스파 (12.5% / 25% / 50% / 75%)
//   - 채널 4: LFSR 노이즈 (타악·효과음)
//   - 볼륨/피치는 계단식으로 변한다 (부드러운 램프가 아님)
// 덕분에 오디오 파일 0바이트로 그 시절 질감을 낸다.
// ─────────────────────────────────────────────────────────────

const AUDIO_KEY = "splendor-pokemon-audio";
const LEGACY_MUTE_KEY = "splendor-pokemon-muted";

let ctx = null;
let sfxBus = null;
let bgmBus = null;

// 브라우저(=트레이너)마다 독립적인 설정. 다른 참가자에게 영향을 주지 않는다.
const audioPrefs = { sfx: true, bgm: true };

(function loadPrefs() {
  try {
    const raw = localStorage.getItem(AUDIO_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      audioPrefs.sfx = saved.sfx !== false;
      audioPrefs.bgm = saved.bgm !== false;
      return;
    }
    // 이전 버전의 단일 음소거 설정을 이어받는다
    if (localStorage.getItem(LEGACY_MUTE_KEY) === "1") {
      audioPrefs.sfx = false;
      audioPrefs.bgm = false;
    }
  } catch {
    /* 저장소 접근이 막혀 있어도 기본값으로 동작한다 */
  }
})();

function savePrefs() {
  try {
    localStorage.setItem(AUDIO_KEY, JSON.stringify(audioPrefs));
  } catch {
    /* 무시 */
  }
}

const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function audio() {
  if (ctx) return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  sfxBus = ctx.createGain();
  sfxBus.gain.value = 0.3;
  sfxBus.connect(ctx.destination);
  bgmBus = ctx.createGain();
  // 요청대로 BGM은 배경에 작게 깔린다
  bgmBus.gain.value = 0.075;
  bgmBus.connect(ctx.destination);
  return ctx;
}

export function unlockAudio() {
  const c = audio();
  if (c && c.state === "suspended") c.resume();
  if (audioPrefs.bgm) startBgm();
}

export function getAudioPrefs() {
  return { ...audioPrefs };
}

export function setSfxEnabled(on) {
  audioPrefs.sfx = Boolean(on);
  savePrefs();
}

export function setBgmEnabled(on) {
  audioPrefs.bgm = Boolean(on);
  savePrefs();
  if (audioPrefs.bgm) startBgm();
  else stopBgm();
}

// 기존 호출부 호환: 둘 다 꺼져 있으면 음소거로 본다
export function isMuted() {
  return !audioPrefs.sfx && !audioPrefs.bgm;
}

export function setMuted(next) {
  setSfxEnabled(!next);
  setBgmEnabled(!next);
}

// 듀티사이클 펄스파. GB 특유의 "삐빅" 음색이 여기서 나온다.
const waveCache = new Map();
function pulse(duty) {
  const c = audio();
  if (!c) return null;
  if (waveCache.has(duty)) return waveCache.get(duty);
  const size = 48;
  const real = new Float32Array(size);
  const imag = new Float32Array(size);
  for (let n = 1; n < size; n += 1) {
    real[n] = (2 / (n * Math.PI)) * Math.sin(Math.PI * n * duty);
  }
  const wave = c.createPeriodicWave(real, imag, { disableNormalization: false });
  waveCache.set(duty, wave);
  return wave;
}

/**
 * PSG 펄스 채널 한 음.
 * GB는 볼륨을 계단식으로 깎기 때문에 지수 감쇠 대신 단계별로 떨어뜨린다.
 */
function psg({ freq, dur = 0.12, gain = 0.2, duty = 0.5, at = 0, slide = null, bus = null, steps = 6 }) {
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  const wave = pulse(duty);
  if (wave) osc.setPeriodicWave(wave);
  else osc.type = "square";

  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.linearRampToValueAtTime(Math.max(20, slide), t0 + dur);

  const env = c.createGain();
  env.gain.setValueAtTime(gain, t0);
  // 계단식 볼륨 감쇠
  for (let i = 1; i <= steps; i += 1) {
    env.gain.setValueAtTime(gain * (1 - i / steps), t0 + (dur * i) / steps);
  }
  env.gain.setValueAtTime(0, t0 + dur);

  osc.connect(env).connect(bus || sfxBus);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** 노이즈 채널. 타악과 "슉" 소리를 만든다. */
function psgNoise({ dur = 0.1, gain = 0.14, at = 0, hp = 900, bus = null }) {
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime + at;
  const frames = Math.max(1, Math.floor(c.sampleRate * dur));
  const buffer = c.createBuffer(1, frames, c.sampleRate);
  const data = buffer.getChannelData(0);
  // LFSR을 흉내낸 거친 의사 난수
  let reg = 0x7fff;
  for (let i = 0; i < frames; i += 1) {
    const bit = (reg ^ (reg >> 1)) & 1;
    reg = (reg >> 1) | (bit << 14);
    data[i] = ((reg & 1) * 2 - 1) * (1 - i / frames);
  }
  const src = c.createBufferSource();
  src.buffer = buffer;
  const filter = c.createBiquadFilter();
  filter.type = "highpass";
  filter.frequency.value = hp;
  const env = c.createGain();
  env.gain.setValueAtTime(gain, t0);
  env.gain.linearRampToValueAtTime(0, t0 + dur);
  src.connect(filter).connect(env).connect(bus || sfxBus);
  src.start(t0);
}

/** GB 음악이 화음을 표현하던 방식: 음을 아주 빠르게 번갈아 친다. */
function arpeggio(freqs, { dur = 0.4, gain = 0.16, duty = 0.5, at = 0, rate = 0.035 } = {}) {
  const count = Math.floor(dur / rate);
  for (let i = 0; i < count; i += 1) {
    psg({ freq: freqs[i % freqs.length], dur: rate, gain, duty, at: at + i * rate, steps: 2 });
  }
}

const N = {
  C3: 130.8, D3: 146.8, E3: 164.8, F3: 174.6, G3: 196, A3: 220, B3: 246.9,
  C4: 261.6, D4: 293.7, E4: 329.6, F4: 349.2, G4: 392, A4: 440, B4: 493.9,
  C5: 523.3, D5: 587.3, E5: 659.3, F5: 698.5, G5: 784, A5: 880, B5: 987.8,
  C6: 1046.5, D6: 1174.7, E6: 1318.5, G6: 1568,
};

const RECIPES = {
  // 커서 이동 — 짧고 건조한 블립
  tokenPick: () => psg({ freq: N.C6, dur: 0.05, gain: 0.16, duty: 0.25, steps: 2 }),

  // 결정음 — 두 음 상승
  tokenTake: () => {
    psg({ freq: N.G5, dur: 0.05, gain: 0.17, duty: 0.5, steps: 2 });
    psg({ freq: N.C6, dur: 0.09, gain: 0.17, duty: 0.5, at: 0.05, steps: 3 });
  },

  // 가방에 넣는 소리
  reserve: () => {
    psgNoise({ dur: 0.05, gain: 0.09, hp: 1600 });
    psg({ freq: N.E4, dur: 0.06, gain: 0.15, duty: 0.125, at: 0.02, slide: N.C4, steps: 3 });
  },

  // 포켓볼 투척 → 흔들림 3번 → 포획 성공 팡파르
  capture: () => {
    psgNoise({ dur: 0.14, gain: 0.11, hp: 700 });
    psg({ freq: N.B5, dur: 0.16, gain: 0.14, duty: 0.125, slide: N.E4, steps: 5 });
    [0.34, 0.58, 0.82].forEach((at) => {
      psg({ freq: N.A4, dur: 0.05, gain: 0.13, duty: 0.25, at, steps: 2 });
      psgNoise({ dur: 0.035, gain: 0.05, hp: 2400, at });
    });
    [
      [N.C5, 1.06], [N.E5, 1.13], [N.G5, 1.2], [N.C6, 1.27],
    ].forEach(([freq, at]) => psg({ freq, dur: 0.14, gain: 0.18, duty: 0.5, at, steps: 4 }));
  },

  // 진화 — 상승 스윕 후 반짝이는 아르페지오
  evolve: () => {
    psg({ freq: N.C4, dur: 0.42, gain: 0.13, duty: 0.25, slide: N.C6, steps: 10 });
    arpeggio([N.C5, N.E5, N.G5, N.C6], { dur: 0.42, gain: 0.15, duty: 0.5, at: 0.42, rate: 0.03 });
    psg({ freq: N.C6, dur: 0.22, gain: 0.18, duty: 0.5, at: 0.86, steps: 5 });
  },

  // 배지 획득 — 짧은 승리 팡파르
  badge: () => {
    [
      [N.G5, 0, 0.1], [N.G5, 0.12, 0.1], [N.G5, 0.24, 0.1], [N.C6, 0.36, 0.34],
    ].forEach(([freq, at, dur]) => {
      psg({ freq, dur, gain: 0.17, duty: 0.5, at, steps: 4 });
      psg({ freq: freq / 2, dur, gain: 0.09, duty: 0.25, at, steps: 4 });
    });
  },

  turn: () => psg({ freq: N.E5, dur: 0.045, gain: 0.11, duty: 0.25, steps: 2 }),

  // 실패 — 낮은 하강 버즈
  error: () => psg({ freq: N.G3, dur: 0.18, gain: 0.15, duty: 0.125, slide: N.C3, steps: 4 }),

  // 승리 팡파르
  win: () => {
    const melody = [
      [N.C5, 0, 0.11], [N.E5, 0.11, 0.11], [N.G5, 0.22, 0.11], [N.C6, 0.33, 0.2],
      [N.G5, 0.55, 0.11], [N.C6, 0.66, 0.42],
    ];
    melody.forEach(([freq, at, dur]) => {
      psg({ freq, dur, gain: 0.18, duty: 0.5, at, steps: 5 });
      psg({ freq: freq / 2, dur, gain: 0.1, duty: 0.25, at, steps: 5 });
    });
    [0, 0.22, 0.44, 0.66].forEach((at) => psgNoise({ dur: 0.05, gain: 0.05, hp: 3000, at }));
  },

  // 패배 — 힘 빠지는 하강
  lose: () => {
    [[N.G4, 0], [N.F4, 0.22], [N.E4, 0.44], [N.C4, 0.68]].forEach(([freq, at]) => {
      psg({ freq, dur: 0.3, gain: 0.15, duty: 0.25, at, steps: 5 });
    });
    psg({ freq: N.C4, dur: 0.5, gain: 0.12, duty: 0.125, at: 0.98, slide: N.C3, steps: 8 });
  },
};

export function play(name) {
  if (!audioPrefs.sfx) return;
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

// ── BGM: GB 스타일 오리지널 루프 ─────────────────────────────
// 실제 포켓몬 곡을 재현하지 않고, 같은 음원 특성으로 새로 만든 루프를 쓴다.

const BEAT = 0.2; // 약 150 BPM의 8분음표
const LEAD = [
  // [음, 길이(비트)] — 밝고 경쾌한 8마디 루프
  [N.E5, 1], [N.G5, 1], [N.A5, 2], [N.G5, 1], [N.E5, 1], [N.D5, 2],
  [N.C5, 1], [N.E5, 1], [N.G5, 2], [N.E5, 1], [N.D5, 1], [N.C5, 2],
  [N.D5, 1], [N.F5, 1], [N.A5, 2], [N.G5, 1], [N.F5, 1], [N.E5, 2],
  [N.C5, 1], [N.D5, 1], [N.E5, 2], [N.G5, 2], [N.C5, 2],
];
const BASS = [
  [N.C3, 2], [N.G3, 2], [N.A3, 2], [N.E3, 2],
  [N.F3, 2], [N.C3, 2], [N.G3, 2], [N.G3, 2],
  [N.D3, 2], [N.A3, 2], [N.B3, 2], [N.G3, 2],
  [N.C3, 2], [N.G3, 2], [N.C3, 4],
];

let bgmTimer = null;
let bgmBar = 0;

function scheduleBgmChunk() {
  const c = audio();
  if (!c || !audioPrefs.bgm) return;

  const total = LEAD.reduce((sum, [, len]) => sum + len, 0) * BEAT;

  let at = 0;
  for (const [freq, len] of LEAD) {
    const dur = len * BEAT * 0.85;
    psg({ freq, dur, gain: 0.2, duty: 0.5, at, steps: 4, bus: bgmBus });
    at += len * BEAT;
  }

  at = 0;
  for (const [freq, len] of BASS) {
    psg({ freq, dur: len * BEAT * 0.8, gain: 0.26, duty: 0.25, at, steps: 3, bus: bgmBus });
    at += len * BEAT;
  }

  // 노이즈 채널로 찍는 백비트
  for (let beat = 0; beat < total / BEAT; beat += 1) {
    if (beat % 4 === 2) psgNoise({ dur: 0.06, gain: 0.07, hp: 1800, at: beat * BEAT, bus: bgmBus });
    else if (beat % 2 === 0) psgNoise({ dur: 0.025, gain: 0.03, hp: 5000, at: beat * BEAT, bus: bgmBus });
  }

  bgmBar += 1;
  bgmTimer = window.setTimeout(scheduleBgmChunk, total * 1000 - 60);
}

export function startBgm() {
  if (!audioPrefs.bgm || bgmTimer) return;
  const c = audio();
  if (!c) return;
  if (c.state === "suspended") c.resume();
  bgmBar = 0;
  try {
    scheduleBgmChunk();
  } catch {
    bgmTimer = null;
  }
}

export function stopBgm() {
  if (bgmTimer) {
    clearTimeout(bgmTimer);
    bgmTimer = null;
  }
  if (bgmBus && ctx) {
    // 이미 예약된 음을 즉시 잠재운다
    bgmBus.gain.cancelScheduledValues(ctx.currentTime);
    bgmBus.gain.setValueAtTime(0, ctx.currentTime);
    bgmBus.gain.linearRampToValueAtTime(0.075, ctx.currentTime + 0.4);
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
