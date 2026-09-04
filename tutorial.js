// Interactive Step-by-Step Tutorial & Rulebook for Pokémon Splendor

export const TUTORIAL_STEPS = [
  {
    step: 1,
    title: "게임의 목표와 구성",
    badge: "1 / 10 목표",
    lead: "명성 점수 18점을 먼저 달성하는 트레이너가 승리합니다!",
    desc: `스플렌더: 포켓몬은 포켓볼을 모으고, 포켓몬을 포획하여 점수를 높이는 엔진 빌딩 보드게임입니다.<br>
포켓몬을 잡을수록 <strong>영구적인 볼 할인 보너스</strong>가 쌓여 더 강력한 2·3단계 및 전설의 포켓몬을 잡을 수 있게 됩니다.`,
    highlights: [
      { label: "🏁 승리 조건", text: "누군가 18점 이상 획득 시 최종 라운드 진행" },
      { label: "🃏 카드 구성", text: "1단계 35장 · 2단계 30장 · 3단계 15장 + 희귀 5장 + 전설 5장" },
      { label: "⚪ 볼 토큰", text: "몬스터/슈퍼/하이퍼/힐/퀵볼 각 7개 + 마스터볼 7개" }
    ],
    visualType: "overview"
  },
  {
    step: 2,
    title: "행동 1: 볼 토큰 가져오기",
    badge: "2 / 10 볼 획득",
    lead: "내 차례에 할 수 있는 첫 번째 행동은 볼 토큰을 가져오는 것입니다.",
    desc: `공급처에서 다음 2가지 방법 중 하나로 볼을 가져옵니다:<br>
① <strong>서로 다른 종류의 볼 3개</strong> 가져오기 (남은 종류가 2개 이하면 2개 또는 1개만 가능)<br>
② <strong>공급처에 4개 이상 남은 같은 색 볼 2개</strong> 가져오기<br>
<span class="warn-badge">⚠️ 주의</span> <strong>마스터볼(보라색)은 볼 가져오기 행동으로 획득할 수 없습니다!</strong>`,
    highlights: [
      { label: "3색 볼 1개씩", text: "몬스터볼 + 슈퍼볼 + 퀵볼 등 서로 다른 색 3개 선택" },
      { label: "동색 볼 2개", text: "해당 볼이 공급처에 4개 이상 있을 때만 2개 획득 가능" },
      { label: "마스터볼 금지", text: "마스터볼은 카드 보관 시에만 획득 가능" }
    ],
    visualType: "tokens"
  },
  {
    step: 3,
    title: "행동 2: 포켓몬 포획 & 영구 보너스",
    badge: "3 / 10 포획 & 할인",
    lead: "볼을 지불하여 포켓몬을 잡고 영구적인 할인 보너스를 획득하세요!",
    desc: `카드 좌측에 표시된 <strong>'잡기' 비용</strong>만큼 내 볼 토큰을 지불하면 포켓몬을 획득합니다.<br>
잡은 포켓몬은 카드 우측 상단의 <strong>해당 색상 볼 1개의 영구 할인 보너스</strong>를 제공합니다.<br>
보너스가 쌓이면 볼 토큰을 지불하지 않고도 <strong>무료로 포켓몬을 포획</strong>할 수 있습니다!`,
    highlights: [
      { label: "영구 할인", text: "잡은 포켓몬은 영구적으로 해당 볼 1개 할인 역할" },
      { label: "비용 차감", text: "요구 비용에서 내 보너스를 뺀 나머지 볼만 토큰으로 지불" },
      { label: "마스터볼 용도", text: "마스터볼은 희귀·전설 포획에만 사용 (일반 포켓몬 결제 불가)" }
    ],
    visualType: "card"
  },
  {
    step: 4,
    title: "행동 3: 손에 보관 & 마스터볼 획득",
    badge: "4 / 10 손에 보관",
    lead: "원하는 카드를 손에 찜하고, 귀중한 마스터볼을 1개 획득하세요!",
    desc: `공개된 카드 또는 1·2·3단계 비공개 덱 맨 위 카드를 <strong>내 손에 보관(최대 3장)</strong>할 수 있습니다.<br>
카드를 보관하면 공급처에서 <strong>🟣 마스터볼 1개</strong>를 보너스로 받습니다 (공급처에 마스터볼이 있을 때).<br>
손에 보관한 카드는 나중에 내 차례에 정식으로 비용을 지불하고 잡을 수 있습니다.<br>
<span class="warn-badge">⚠️ 주의</span> <strong>희귀 카드와 전설·환상 카드는 손에 보관할 수 없습니다!</strong>`,
    highlights: [
      { label: "최대 3장", text: "손에 3장이 차 있으면 추가 보관 불가" },
      { label: "마스터볼 지급", text: "보관할 때마다 전설 포획용 마스터볼 1개 획득" },
      { label: "특수 카드 제한", text: "희귀/전설 카드는 보관 불가 (즉시 포획만 가능)" }
    ],
    visualType: "reserve"
  },
  {
    step: 5,
    title: "희귀 & 전설·환상 포켓몬",
    badge: "5 / 10 특수 포켓몬",
    lead: "중앙 최상단에 각 1장씩 공개되는 강력한 포켓몬들입니다.",
    desc: `뮤, 뮤츠, 썬더, 프리져, 루기아 등 희귀 및 전설 포켓몬은 특별한 혜택을 줍니다:<br>
① <strong>대량의 명성 점수</strong>: 4~5점의 높은 점수를 즉시 획득합니다.<br>
② <strong>더블 보너스</strong>: 일반 포켓몬과 달리 <strong>영구 볼 보너스를 2개</strong>나 제공합니다!<br>
③ <strong>포획 조건</strong>: 포획 비용에 <strong>반드시 마스터볼 1개 이상 지불</strong>이 필요합니다.`,
    highlights: [
      { label: "마스터볼 전용", text: "마스터볼은 일반 포켓몬 구매에 쓸 수 없습니다. 카드를 손에 보관해 미리 모아두세요!" },
      { label: "더블 보너스", text: "포획 시 해당 볼 2개 영구 할인 혜택" },
      { label: "고득점", text: "18점 승리로 가는 가장 빠른 지름길" }
    ],
    visualType: "special"
  },
  {
    step: 6,
    title: "볼 토큰 10개 한도 & 반납",
    badge: "6 / 10 토큰 제한",
    lead: "내 차례 종료 시 가지고 있을 수 있는 볼 토큰은 최대 10개입니다.",
    desc: `마스터볼을 포함하여 보유한 볼 토큰의 총합이 <strong>10개를 초과</strong>하면,<br>
차례를 마치기 전에 <strong>초과된 수량만큼 원하는 볼을 공급처로 반납</strong>해야 합니다.<br>
토큰을 너무 많이 모으기보다는 제때 포켓몬을 잡아 보너스로 전환하는 것이 유리합니다.`,
    highlights: [
      { label: "최대 10개", text: "일반 볼 5종 + 마스터볼 합산 10개 한도" },
      { label: "초과 반납", text: "11개 이상 보유 시 초과분만큼 반납 전까지 턴 진행 불가" }
    ],
    visualType: "limit"
  },
  {
    step: 7,
    title: "트레이너 카드 (고유 특전)",
    badge: "7 / 10 트레이너",
    lead: "게임 시작 시 트레이너를 한 명 고르면, 그 트레이너만의 특전과 시작 보너스를 얻습니다.",
    desc: `지우·이슬이·웅이·민화·강연·나츠메·그린·마티스 중 한 명을 선택합니다.<br>
모든 트레이너는 <strong>고유 색 보너스 1개를 가지고 시작</strong>하며, 판을 바꾸는 <strong>특전 1가지</strong>를 지닙니다.<br>
같은 판에서 트레이너는 중복되지 않으므로, 상대의 특전을 읽고 견제하는 것도 중요합니다.`,
    highlights: [
      { label: "🧢 지우", text: "손에 보관할 때 마스터볼을 2개 받습니다 (전설 러시)" },
      { label: "💧 이슬이", text: "같은 색 2개를 공급처에 3개만 남아도 가져옵니다" },
      { label: "🪨 웅이", text: "포켓볼을 12개까지 보유할 수 있습니다" },
      { label: "🌿 민화", text: "진화 비용이 모든 색 2개씩 할인됩니다" },
      { label: "🔥 강연", text: "희귀·전설의 색 비용이 모든 색 1개씩 줄어듭니다" },
      { label: "🔮 나츠메", text: "손에 4장까지 보관할 수 있습니다" },
      { label: "😎 그린", text: "3단계 포켓몬을 잡을 때마다 ★1을 더 받습니다" },
      { label: "⚡ 마티스", text: "체육관 배지 조건이 모든 색 1개씩 낮아집니다" }
    ],
    visualType: "trainer"
  },
  {
    step: 8,
    title: "체육관 배지 (선점 경쟁!)",
    badge: "8 / 10 체육관 배지",
    lead: "보드 위 배지의 보너스 조건을 먼저 채우면 자동으로 배지를 가져갑니다. 각 ★3점!",
    desc: `플레이어 수 + 1개의 체육관 배지가 공개됩니다.<br>
배지는 <strong>포켓볼이 아니라 영구 보너스</strong>로만 조건을 채웁니다. (예: 하이퍼볼 4 · 몬스터볼 3)<br>
차례를 마칠 때 조건을 만족하면 <strong>자동으로 즉시 획득</strong>하며, <strong>먼저 채운 한 명만</strong> 가져갈 수 있습니다.<br>
⚠️ 배지는 포켓몬 카드 3~4장 값어치라, 배지를 무시하고 점수만 모으면 순식간에 뒤집힙니다!`,
    highlights: [
      { label: "★3점", text: "배지 1개 = 3단계 포켓몬 1장과 맞먹는 점수" },
      { label: "선점제", text: "같은 배지를 두 명이 가져갈 수 없음 — 한 발 빠른 쪽이 독식" },
      { label: "보너스만 계산", text: "보유한 볼 토큰은 계산에 들어가지 않음 (영구 보너스 전용)" },
      { label: "동점 2순위", text: "점수가 같으면 배지가 많은 트레이너가 우선 승리" }
    ],
    visualType: "gymbadge"
  },
  {
    step: 9,
    title: "차례 후 진화 (1턴 1회 - 핵심 승리 열쇠!)",
    badge: "9 / 10 진화 시스템",
    lead: "행동을 마친 뒤, 내 포켓몬을 다음 단계로 진화시킬 수 있습니다!",
    desc: `스플렌더: 포켓몬만의 고유 규칙입니다!<br>
내 차례의 행동(볼 획득/포획/보관)을 끝낸 후, 조건이 맞다면 <strong>1→2단계 또는 2→3단계로 1회 진화</strong>할 수 있습니다.<br>
• <strong>진화 조건</strong>: 이전 단계 포켓몬을 보유하고 있어야 합니다.<br>
• <strong>진화 할인</strong>: 진화 비용은 <strong>모든 색이 1개씩 할인</strong>되며, 남은 부족분은 볼 토큰으로 지불합니다.<br>
• <strong>진화 보상</strong>: 일반 포획과 똑같이 <strong>명성 점수와 영구 보너스를 그대로 획득</strong>합니다!<br>
⭐ 행동 1회로 카드 2장을 얻는 셈이라, 진화 라인을 미리 깔아두는 것이 최강 전략입니다. 동점 시에도 1순위 승리!`,
    highlights: [
      { label: "할인 포획", text: "모든 색 1개 할인 + 점수·보너스 정상 획득 (행동을 소모하지 않음)" },
      { label: "1턴 1회 제한", text: "차례 마무리 단계에서 최대 1회만 진화 가능" },
      { label: "동점 1순위 승리", text: "동점 시 진화 카드가 많은 트레이너가 최종 챔피언!" }
    ],
    visualType: "evolution"
  },
  {
    step: 10,
    title: "게임 종료 및 최종 승자 판정",
    badge: "10 / 10 최종 판정",
    lead: "18점 도달 시 마지막 라운드 진행 후 정밀한 승자 판정이 이뤄집니다.",
    desc: `어떤 트레이너가 <strong>18점 이상</strong>을 달성하면, 시작 플레이어 직전 플레이어까지 진행하여<br>
모든 플레이어가 동일한 횟수의 차례를 마칠 때 게임이 공식 종료됩니다.<br><br>
🏆 <strong>최종 승자 결정 우선순위</strong>:<br>
1️⃣ <strong>총 명성 점수</strong>가 가장 높은 트레이너 승리!<br>
2️⃣ 동점일 경우 <strong>체육관 배지가 더 많은 트레이너</strong> 승리!<br>
3️⃣ 그래도 동점이면 <strong>진화 카드 수</strong>, 마지막으로 <strong>포획한 카드 수</strong>로 가립니다.`,
    highlights: [
      { label: "18점 종료 라운드", text: "모든 플레이어가 공평하게 턴을 마치도록 라운드 끝까지 진행" },
      { label: "1순위: 명성 점수", text: "최고 점수 획득자 우선" },
      { label: "동점 1순위: 체육관 배지", text: "점수가 같으면 배지를 많이 모은 플레이어 승리" },
      { label: "동점 2순위: 진화 카드", text: "배지도 같으면 진화를 많이 시킨 플레이어 승리" },
      { label: "동점 2순위: 포획 카드", text: "진화 수도 같으면 보유한 포켓몬 총 카드 수 비교" }
    ],
    visualType: "victory"
  }
];

export function renderTutorialModal(currentStepIndex = 0) {
  const step = TUTORIAL_STEPS[currentStepIndex];
  const isFirst = currentStepIndex === 0;
  const isLast = currentStepIndex === TUTORIAL_STEPS.length - 1;

  const visualMarkup = () => {
    switch (step.visualType) {
      case "overview":
        return `
          <div class="tut-visual-row">
            <div class="tut-chip-pile">
              <span class="chip red"><span class="chip-ball"></span></span>
              <span class="chip blue"><span class="chip-ball"></span></span>
              <span class="chip yellow"><span class="chip-ball"></span></span>
              <span class="chip green"><span class="chip-ball"></span></span>
              <span class="chip black"><span class="chip-ball"></span></span>
              <span class="chip wild"><span class="chip-ball"></span></span>
            </div>
            <div class="tut-arrow">➔</div>
            <div class="tut-card-preview normal">
              <div class="tut-card-top"><b>★1</b><span>🔴</span></div>
              <img src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/25.png" alt="피카츄" />
              <div class="tut-card-bot"><span>피카츄</span></div>
            </div>
            <div class="tut-arrow">➔</div>
            <div class="tut-badge-large">★ 18점 승리!</div>
          </div>
        `;
      case "tokens":
        return `
          <div class="tut-rule-box">
            <div class="tut-choice">
              <strong>선택 A: 서로 다른 3색 볼</strong>
              <div class="tut-chips">
                <span class="chip red"></span> + <span class="chip blue"></span> + <span class="chip yellow"></span>
              </div>
            </div>
            <div class="tut-or">또는</div>
            <div class="tut-choice">
              <strong>선택 B: 같은 색 볼 2개 (4개 이상 남았을 때)</strong>
              <div class="tut-chips">
                <span class="chip blue"></span> + <span class="chip blue"></span> (공급처 4개 이상)
              </div>
            </div>
          </div>
        `;
      case "card":
        return `
          <div class="tut-visual-card-demo">
            <div class="tut-card-explained">
              <div class="tut-label-top">상단: 점수 ★ & 영구 할인 보너스 볼</div>
              <div class="tut-card-main">
                <div class="tut-cost-col">
                  <small>잡기</small>
                  <span class="small-chip red">2</span>
                  <span class="small-chip blue">1</span>
                </div>
                <img src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/4.png" alt="파이리" />
                <div class="tut-name-tag">파이리</div>
              </div>
              <div class="tut-label-bot">좌측: 잡기(포획) 요구 볼 비용</div>
            </div>
          </div>
        `;
      case "reserve":
        return `
          <div class="tut-visual-row">
            <div class="tut-reserve-box">
              <div class="tut-reserve-title">내 손 (최대 3장)</div>
              <div class="tut-slots">
                <span class="slot filled">카드 1</span>
                <span class="slot filled">카드 2</span>
                <span class="slot empty">빈자리</span>
              </div>
            </div>
            <div class="tut-plus">+</div>
            <div class="tut-master-box">
              <span class="chip wild"><span class="chip-ball"></span></span>
              <span>마스터볼 1개 획득!</span>
            </div>
          </div>
        `;
      case "special":
        return `
          <div class="tut-visual-row">
            <div class="tut-card-preview special-card rare">
              <div class="tut-card-top"><b>★4</b><span>🔴🔴 더블!</span></div>
              <img src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/151.png" alt="뮤" />
              <div class="tut-card-bot"><span>뮤 (희귀)</span></div>
            </div>
            <div class="tut-card-preview special-card legend">
              <div class="tut-card-top"><b>★5</b><span>🔵🔵 더블!</span></div>
              <img src="https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/150.png" alt="뮤츠" />
              <div class="tut-card-bot"><span>뮤츠 (전설)</span></div>
            </div>
          </div>
        `;
      case "limit":
        return `
          <div class="tut-token-limit-demo">
            <div class="tut-limit-bar">
              <span class="tut-count-label">내 보유 토큰: <b>10개</b> 한도</span>
              <div class="tut-token-slots">
                <span class="slot-dot">●</span><span class="slot-dot">●</span><span class="slot-dot">●</span><span class="slot-dot">●</span><span class="slot-dot">●</span>
                <span class="slot-dot">●</span><span class="slot-dot">●</span><span class="slot-dot">●</span><span class="slot-dot">●</span><span class="slot-dot">●</span>
              </div>
            </div>
            <p class="tut-limit-tip">11개 이상이 되면 즉시 반납 팝업이 뜨며, 10개가 될 때까지 반납해야 합니다.</p>
          </div>
        `;
      case "evolution":
        return `
          <div class="tut-visual-row evolution-chain">
            <div class="tut-evo-step">
              <div class="tut-card-mini">1단계: 꼬부기</div>
              <span class="tut-evo-desc">내 필드에 보유</span>
            </div>
            <div class="tut-arrow">➔</div>
            <div class="tut-evo-step highlight">
              <div class="tut-card-mini">2단계: 어니부기</div>
              <span class="tut-evo-desc">보너스 충족 시 진화!</span>
            </div>
            <div class="tut-arrow">➔</div>
            <div class="tut-evo-result">
              <span>트레이너 타일 밑으로 보관</span>
              <strong>동점 판정 1순위 승리!</strong>
            </div>
          </div>
        `;
      case "trainer":
        return `
          <div class="tut-trainer-row">
            ${[["🧢", "지우", "마스터볼 2개"], ["💧", "이슬이", "같은 색 완화"], ["🪨", "웅이", "보유 12개"], ["🌿", "민화", "진화 2할인"]]
              .map(
                ([icon, name, perk]) => `
              <div class="tut-trainer-chip">
                <span class="tut-trainer-icon">${icon}</span>
                <b>${name}</b>
                <small>${perk}</small>
              </div>`
              )
              .join("")}
          </div>
        `;
      case "gymbadge":
        return `
          <div class="tut-visual-row">
            <div class="tut-badge-demo">
              <span class="tut-badge-icon">🪨</span>
              <b>그레이배지</b>
              <div class="tut-badge-need">
                <span class="chip black"></span>×4 + <span class="chip red"></span>×3
              </div>
              <small>영구 보너스로만 계산</small>
            </div>
            <div class="tut-arrow">➔</div>
            <div class="tut-badge-large">★ 3점 즉시 획득</div>
          </div>
        `;
      case "victory":
        return `
          <div class="tut-victory-podium">
            <div class="podium-step first">
              <div class="badge">1순위</div>
              <strong>명성 점수 최고점 (★ 18점+)</strong>
            </div>
            <div class="podium-step second">
              <div class="badge">동점 1순위</div>
              <strong>진화 카드 수 많은 사람</strong>
            </div>
            <div class="podium-step third">
              <div class="badge">동점 2순위</div>
              <strong>포획 포켓몬 수 많은 사람</strong>
            </div>
          </div>
        `;
      default:
        return "";
    }
  };

  return `
    <div class="tut-modal-overlay" id="tut-overlay">
      <div class="tut-modal" role="dialog" aria-modal="true" aria-labelledby="tut-title">
        <header class="tut-header">
          <div class="tut-progress-wrap">
            <span class="tut-step-badge">${step.badge}</span>
            <div class="tut-step-dots">
              ${TUTORIAL_STEPS.map((_, i) => `<button class="tut-dot ${i === currentStepIndex ? "active" : i < currentStepIndex ? "done" : ""}" data-step="${i}" aria-label="${i + 1}단계"></button>`).join("")}
            </div>
          </div>
          <button class="tut-close" id="tut-close" aria-label="닫기">✕</button>
        </header>

        <main class="tut-body">
          <h2 id="tut-title" class="tut-title">${step.title}</h2>
          <p class="tut-lead">${step.lead}</p>

          <div class="tut-visual-box">
            ${visualMarkup()}
          </div>

          <div class="tut-desc">${step.desc}</div>

          <div class="tut-highlights">
            ${step.highlights.map((h) => `
              <div class="tut-highlight-item">
                <span class="tut-hl-label">${h.label}</span>
                <span class="tut-hl-text">${h.text}</span>
              </div>
            `).join("")}
          </div>
        </main>

        <footer class="tut-footer">
          <div class="tut-footer-left">
            <button class="tut-nav-btn secondary" id="tut-prev" ${isFirst ? "disabled" : ""}>◀ 이전</button>
          </div>
          <div class="tut-footer-right">
            ${!isLast ? `
              <button class="tut-nav-btn primary" id="tut-next">다음 단계 ▶</button>
            ` : `
              <button class="tut-nav-btn finish" id="tut-finish">🎮 솔로 게임 시작하기</button>
            `}
          </div>
        </footer>
      </div>
    </div>
  `;
}
