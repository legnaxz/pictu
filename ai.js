import { COLORS, WIN_SCORE, badgeRequirement, effectiveCost } from "./rules.js";

export const AI_PROFILES = {
  beginner: {
    id: "beginner",
    name: "로이 & 로사",
    title: "초보 루키",
    avatar: "🎒",
    difficulty: "beginner",
    difficultyLabel: "초보",
    desc: "기초적인 포켓몬 포획 위주로 플레이하며 수 계산이 단순한 상대입니다.",
    weights: {
      turnEfficiency: 0.8,
      points: 2.0,
      bonus: 1.5,
      evolution: 1.2,
      legendary: 1.0,
      blocking: 0.0,
      reservePreference: 0.3,
      randomFactor: 0.35,
    },
  },
  brock: {
    id: "brock",
    name: "웅이",
    title: "바위 체육관 관장",
    avatar: "🌿",
    difficulty: "intermediate",
    difficultyLabel: "중급",
    desc: "1단계 포켓몬으로 탄탄한 기반을 쌓고 무료 진화 체인을 노리는 진화 마스터입니다.",
    weights: {
      turnEfficiency: 1.8,
      points: 2.5,
      bonus: 2.2,
      evolution: 3.8, // 진화에 매우 높은 가중치
      legendary: 1.5,
      blocking: 0.5,
      reservePreference: 0.7,
      randomFactor: 0.1,
    },
  },
  blue: {
    id: "blue",
    name: "그린",
    title: "전 라이벌 챔피언",
    avatar: "🔥",
    difficulty: "advanced",
    difficultyLabel: "고급",
    desc: "마스터볼을 빠르게 확보하여 희귀·전설 포켓몬과 고득점 3단계를 저격하는 하이리스크 러셔입니다.",
    weights: {
      turnEfficiency: 2.5,
      points: 3.8,
      bonus: 1.2,
      evolution: 1.5,
      legendary: 4.2, // 희귀/전설 러시에 최고 가중치
      blocking: 1.2,
      reservePreference: 1.6, // 마스터볼을 얻기 위한 잦은 예약
      randomFactor: 0.05,
    },
  },
  oak: {
    id: "oak",
    name: "오박사",
    title: "포켓몬 연구의 권위자",
    avatar: "⚡",
    difficulty: "advanced",
    difficultyLabel: "고급",
    desc: "상대의 전략과 진화 트리를 분석하여 핵심 포켓몬을 가로채고 볼 공급을 차단하는 전술가입니다.",
    weights: {
      turnEfficiency: 2.4,
      points: 3.0,
      bonus: 2.0,
      evolution: 2.2,
      legendary: 2.0,
      blocking: 4.0, // 강력한 상대 방해 및 선점
      reservePreference: 1.5,
      randomFactor: 0.05,
    },
  },
  cynthia: {
    id: "cynthia",
    name: "난천",
    title: "신오지방 챔피언",
    avatar: "👑",
    difficulty: "advanced",
    difficultyLabel: "고급",
    desc: "정밀한 수 계산으로 턴당 점수 효율과 색상 밸런스를 극대화하는 최상급 올라운더입니다.",
    weights: {
      turnEfficiency: 3.6, // 완벽에 가까운 턴당 점수 효율 계산
      points: 3.5,
      bonus: 2.4,
      evolution: 2.8,
      legendary: 3.0,
      blocking: 2.5,
      reservePreference: 1.2,
      randomFactor: 0.0,
    },
  },
};

export const DIFFICULTY_PRESETS = [
  { id: "beginner", label: "초보 (로이&로사)", profileId: "beginner", desc: "규칙을 익히며 가볍게 즐길 수 있는 난이도" },
  { id: "intermediate", label: "중급 (웅이)", profileId: "brock", desc: "진화 체인을 능숙하게 활용하는 난이도" },
  { id: "advanced", label: "고급 (난천)", profileId: "cynthia", desc: "정밀한 수 계산과 전술을 펼치는 챔피언 난이도" },
];

/**
 * 특정 카드를 구매하기 위한 부족분과 소요 턴 수 계산
 */
export function analyzeCardCost(player, card) {
  let netDeficit = 0;
  const missingByColor = {};

  const priced = effectiveCost(player, card);
  for (const c of COLORS) {
    const cost = priced[c] || 0;
    const bonus = player.bonuses[c] || 0;
    const token = player.tokens[c] || 0;
    const required = Math.max(0, cost - bonus);
    const deficit = Math.max(0, required - token);
    missingByColor[c] = deficit;
    netDeficit += deficit;
  }

  // 와일드(마스터볼) 적용
  // 마스터볼은 희귀·전설 포획에만 사용할 수 있다
  let availableWild = card.masterRequired ? player.tokens.wild || 0 : 0;
  let masterSatisfied = true;

  if (card.masterRequired) {
    if (availableWild >= 1) {
      availableWild -= 1; // 특수 포획용으로 1개 소모
    } else {
      masterSatisfied = false;
    }
  }

  const wildShortage = Math.max(0, netDeficit - availableWild);
  const canAffordNow = wildShortage === 0 && masterSatisfied;

  // 최소 몇 턴의 토큰 수집이 필요한가?
  let turnsNeeded = 0;
  if (!canAffordNow) {
    const totalMissing = wildShortage + (masterSatisfied ? 0 : 1);
    turnsNeeded = Math.ceil(totalMissing / 2.5);
  }

  return {
    canAffordNow,
    turnsNeeded,
    netDeficit,
    missingByColor,
    masterSatisfied,
  };
}

/**
 * 카드의 전략적 가치 평가 (점수, 보너스, 진화 연계 등)
 */
export function evaluateCardValue(game, seat, card, profile) {
  const player = game.players[seat];
  const costAnalysis = analyzeCardCost(player, card);
  const weights = profile.weights;

  // 1. 기본 점수 가치
  let scoreValue = card.points * weights.points;

  // 2. 영구 보너스 가치
  const gameProgress = Math.min(1.0, player.score / WIN_SCORE);
  const bonusMultiplier = (1.0 - gameProgress * 0.5) * (card.bonusCount || 1);
  let bonusValue = weights.bonus * bonusMultiplier;

  // 2-b. 체육관 배지 진척 가치: 이 카드의 보너스가 미공개 배지 달성을 앞당기는가?
  let badgeValue = 0;
  for (const badge of game.badges || []) {
    if (badge.owner !== null) continue;
    const need = badgeRequirement(player, badge);
    const before = COLORS.reduce((sum, c) => sum + Math.max(0, need[c] - player.bonuses[c]), 0);
    if (before === 0) continue;
    const after = COLORS.reduce(
      (sum, c) => sum + Math.max(0, need[c] - (player.bonuses[c] + (c === card.bonus ? card.bonusCount || 1 : 0))),
      0
    );
    const progress = before - after;
    if (progress <= 0) continue;
    // 배지 완성이 가까울수록 가치가 급격히 오른다
    badgeValue += progress * (after === 0 ? badge.points * 2.5 : 1.6 / Math.max(1, after));
  }
  badgeValue *= weights.points;

  // 3. 진화 연계성 가치 (Evolution Synergy)
  let evolutionSynergy = 0;
  const owned = player.cards.concat(player.evolutions);

  if (card.kind === "normal") {
    if (card.stage === 1) {
      const market2Choices = game.market[2].filter((m) => m.line === card.line);
      if (market2Choices.length > 0) {
        evolutionSynergy += 3.5 * weights.evolution;
      }
    } else if (card.stage > 1) {
      const hasPre = owned.some((o) => o.line === card.line && o.stage === card.stage - 1);
      if (hasPre) {
        evolutionSynergy += 5.0 * weights.evolution;
      }
    }
  }

  // 4. 희귀/전설 보너스
  let legendaryBonus = 0;
  if (card.kind === "rare" || card.kind === "legend") {
    legendaryBonus = (card.points + 2) * weights.legendary;
  }

  // 5. 총 잠재 가치
  const rawValue = scoreValue + bonusValue + badgeValue + evolutionSynergy + legendaryBonus;

  // 6. 소요 턴 수에 따른 효율성 (Action Efficiency)
  const efficiency = rawValue / Math.pow(costAnalysis.turnsNeeded + 1, weights.turnEfficiency);

  // 랜덤 노이즈
  const noise = weights.randomFactor > 0 ? (Math.random() - 0.5) * weights.randomFactor * rawValue : 0;

  return {
    card,
    rawValue,
    efficiency: Math.max(0.01, efficiency + noise),
    costAnalysis,
  };
}

/**
 * 은행에서 가져올 수 있는 합법적인 토큰 조합 탐색
 */
export function getLegalTokenChoices(bank) {
  const availableColors = COLORS.filter((c) => bank[c] > 0);
  const choices = [];

  // 같은 색 2개 (4개 이상 남은 색상)
  for (const c of COLORS) {
    if (bank[c] >= 4) {
      choices.push([c, c]);
    }
  }

  // 서로 다른 색상 조합
  if (availableColors.length >= 3) {
    for (let i = 0; i < availableColors.length; i++) {
      for (let j = i + 1; j < availableColors.length; j++) {
        for (let k = j + 1; k < availableColors.length; k++) {
          choices.push([availableColors[i], availableColors[j], availableColors[k]]);
        }
      }
    }
  } else if (availableColors.length > 0) {
    choices.push([...availableColors]);
  }

  return choices;
}

/**
 * 상대 플레이어의 위협 및 가로채기(Blocking) 대상 분석
 */
export function analyzeOpponentThreats(game, mySeat, profile) {
  if (profile.weights.blocking <= 0) return null;

  const threats = [];
  const opponents = game.players.filter((p) => p.seat !== mySeat);

  for (const opp of opponents) {
    const isCloseToWin = opp.score >= 13;
    const allMarket = Object.values(game.market).flat();

    for (const card of allMarket) {
      const oppCost = analyzeCardCost(opp, card);
      if (oppCost.canAffordNow || (oppCost.turnsNeeded <= 1 && isCloseToWin)) {
        let threatScore = card.points * 2.0;
        if (card.points >= 3) threatScore += 5.0;
        if (opp.score + card.points >= WIN_SCORE) threatScore += 20.0;
        for (const badge of game.badges || []) {
          if (badge.owner !== null) continue;
          const need = badgeRequirement(opp, badge);
          const after = COLORS.reduce(
            (sum, c) => sum + Math.max(0, need[c] - (opp.bonuses[c] + (c === card.bonus ? card.bonusCount || 1 : 0))),
            0
          );
          if (after === 0) threatScore += 12.0;
        }

        threats.push({
          card,
          opponent: opp,
          threatScore: threatScore * profile.weights.blocking,
        });
      }
    }
  }

  threats.sort((a, b) => b.threatScore - a.threatScore);
  return threats.length > 0 ? threats[0] : null;
}

/**
 * CPU의 턴 의사결정 (최적의 행동 선택)
 */
export function chooseCpuAction(game, seat, profileId) {
  const profile = AI_PROFILES[profileId] || AI_PROFILES.cynthia;
  const player = game.players[seat];

  // 1. 진화 기회가 걸려 있는 경우
  if (game.pending?.type === "evolution" && game.pending.player === seat) {
    return chooseEvolutionAction(game, seat, profile);
  }

  // 2. 토큰 반납이 걸려 있는 경우
  if (game.pending?.type === "return" && game.pending.player === seat) {
    return chooseReturnAction(game, seat, profile);
  }

  const allAvailableCards = [
    ...Object.values(game.market).flat(),
    ...player.reserved,
  ];

  const evaluatedCards = allAvailableCards.map((card) =>
    evaluateCardValue(game, seat, card, profile)
  );

  const affordableCards = evaluatedCards
    .filter((ec) => ec.costAnalysis.canAffordNow)
    .sort((a, b) => b.efficiency - a.efficiency);

  const topTarget = [...evaluatedCards].sort((a, b) => b.efficiency - a.efficiency)[0];
  const topThreat = analyzeOpponentThreats(game, seat, profile);

  // A. 승리 결정타 또는 고효율 카드가 있으면 즉시 구매
  if (affordableCards.length > 0) {
    const winningCard = affordableCards.find((ec) => player.score + ec.card.points >= WIN_SCORE);
    if (winningCard) {
      return {
        action: "buy",
        cardId: winningCard.card.id,
        reason: `${winningCard.card.name} 포획으로 ${WIN_SCORE}점 달성 노림`,
      };
    }

    const bestAffordable = affordableCards[0];
    if (bestAffordable.efficiency >= (topTarget?.efficiency || 0) * 0.75 || bestAffordable.card.points > 0) {
      return {
        action: "buy",
        cardId: bestAffordable.card.id,
        reason: `${bestAffordable.card.name} 포획 (★${bestAffordable.card.points})`,
      };
    }
  }

  // A-2. 전설·희귀 포획을 위한 마스터볼 확보
  //      색 비용은 거의 갖췄는데 마스터볼이 없어 막힌 경우, 예약해서 마스터볼을 확보한다
  if (player.reserved.length < 3 && game.bank.wild > 0) {
    const specials = game.market.rare.concat(game.market.legend);
    const reachable = specials.some((card) => {
      const colorDeficit = COLORS.reduce(
        (sum, c) => sum + Math.max(0, card.cost[c] - player.bonuses[c] - player.tokens[c]),
        0
      );
      return colorDeficit <= 2 && player.tokens.wild < colorDeficit + 1;
    });
    if (reachable) {
      const pick = [3, 2, 1].find((tier) => game.market[tier].length > 0);
      if (pick) {
        return {
          action: "reserve",
          tier: pick,
          cardId: game.market[pick][0].id,
          reason: "전설 포획을 위한 마스터볼 확보",
        };
      }
    }
  }

  // B. 견제 예약 (Denial Reservation)
  if (
    topThreat &&
    topThreat.threatScore >= 15 &&
    player.reserved.length < 3 &&
    [1, 2, 3].includes(Number(topThreat.card.tier))
  ) {
    return {
      action: "reserve",
      tier: Number(topThreat.card.tier),
      cardId: topThreat.card.id,
      reason: `${topThreat.opponent.name}의 ${topThreat.card.name} 견제 및 마스터볼 확보`,
    };
  }

  // C. 내 최고 목표 카드 예약
  if (
    player.reserved.length < 3 &&
    game.bank.wild > 0 &&
    topTarget &&
    [1, 2, 3].includes(Number(topTarget.card.tier)) &&
    (topTarget.card.points >= 3 || (profile.weights.reservePreference > 1.2 && Math.random() < 0.4))
  ) {
    const isAlreadyReserved = player.reserved.some((c) => c.id === topTarget.card.id);
    if (!isAlreadyReserved) {
      return {
        action: "reserve",
        tier: Number(topTarget.card.tier),
        cardId: topTarget.card.id,
        reason: `핵심 포켓몬 ${topTarget.card.name} 예약 및 마스터볼 획득`,
      };
    }
  }

  // D. 토큰 가져오기 (목표 카드를 위한 최적의 볼 수집)
  const tokenChoices = getLegalTokenChoices(game.bank);
  if (tokenChoices.length > 0) {
    const neededColors = topTarget?.costAnalysis.missingByColor || {};

    let bestChoice = tokenChoices[0];
    let bestScore = -999;

    for (const choice of tokenChoices) {
      let score = 0;

      for (const color of choice) {
        if ((neededColors[color] || 0) > 0) {
          score += 3.0;
        }
      }

      if (choice.length === 2 && choice[0] === choice[1]) {
        if ((neededColors[choice[0]] || 0) >= 2) {
          score += 2.5;
        } else {
          score -= 1.0;
        }
      }

      if (topThreat && topThreat.card.cost[choice[0]] > 0) {
        score += 1.0 * profile.weights.blocking;
      }

      const currentTokenCount = Object.values(player.tokens).reduce((s, v) => s + v, 0);
      if (currentTokenCount + choice.length > 10) {
        score -= (currentTokenCount + choice.length - 10) * 1.5;
      }

      if (score > bestScore) {
        bestScore = score;
        bestChoice = choice;
      }
    }

    return {
      action: "take",
      colors: bestChoice,
      reason: `${bestChoice.join(", ")} 볼 수집 (${topTarget ? topTarget.card.name : "목표"} 준비)`,
    };
  }

  // E. 예약 시도
  if (player.reserved.length < 3) {
    for (const tier of [2, 1, 3]) {
      if (game.decks[tier].length > 0) {
        return {
          action: "reserve",
          tier,
          cardId: null,
          reason: `${tier}단계 덱 예약 및 마스터볼 획득`,
        };
      }
    }
  }

  // F. 구매 가능한 카드 구매
  if (affordableCards.length > 0) {
    return {
      action: "buy",
      cardId: affordableCards[0].card.id,
      reason: `${affordableCards[0].card.name} 포획`,
    };
  }

  return { action: "pass", reason: "대기" };
}

/**
 * 진화 선택
 */
export function chooseEvolutionAction(game, seat, profile) {
  const choices = game.pending.choices;
  if (!choices || choices.length === 0) {
    return { action: "evolve", cardId: null, reason: "진화 건너뛰기" };
  }

  const allCards = Object.values(game.market).flat().concat(game.players[seat].reserved);
  const eligibleCards = allCards.filter((c) => choices.includes(c.id));

  eligibleCards.sort((a, b) => b.points - a.points || (b.bonusCount || 1) - (a.bonusCount || 1));

  const best = eligibleCards[0];
  return {
    action: "evolve",
    cardId: best.id,
    reason: `${best.name} (★${best.points}) 진화`,
  };
}

/**
 * 10개 초과 토큰 반납 선택
 */
export function chooseReturnAction(game, seat, profile) {
  const player = game.players[seat];
  const countToReturn = game.pending.count;
  const returnSelection = {};

  const colorPriorities = [...COLORS, "wild"].map((color) => {
    const currentTokens = player.tokens[color] || 0;
    const bonus = player.bonuses[color] || 0;
    const keepScore = color === "wild" ? 100 : currentTokens - bonus * 0.5;
    return { color, keepScore, count: currentTokens };
  });

  colorPriorities.sort((a, b) => a.keepScore - b.keepScore);

  let returned = 0;
  while (returned < countToReturn) {
    let candidate = colorPriorities.find((cp) => (player.tokens[cp.color] || 0) - (returnSelection[cp.color] || 0) > 0);
    if (!candidate) candidate = colorPriorities[0];

    returnSelection[candidate.color] = (returnSelection[candidate.color] || 0) + 1;
    returned++;
  }

  return {
    action: "return",
    tokens: returnSelection,
    reason: `초과 볼 반납`,
  };
}
