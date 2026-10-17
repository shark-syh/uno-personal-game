/**
 * 候选动作的特征提取（M2 启发式评分的核心）。
 *
 * 所有特征只依赖 `AiView`（公开信息 + 自己手牌）与 `AiMemory`（公开信息统计），
 * 绝不读取其他玩家手牌或 `wild4Info` 等隐藏信息。
 */
import type { Card, Color, EngineAction } from '@uno/game-core';
import type {
  AiMemory,
  AiView,
  CandidateFeatures,
  CandidateKind,
  DifficultyProfile,
} from './types.ts';
import { clamp01, estimatePlayerHasColor, probabilityAtLeastOne } from './memory.ts';
import { nextPlayerSeat } from './view.ts';

/** 候选动作的初始草稿（由 legal action 映射而来） */
export interface CandidateDraft {
  kind: CandidateKind;
  action: EngineAction;
  card: Card | null;
  colorChoice: Color | null;
}

/** 特征提取上下文 */
export interface FeatureContext {
  view: AiView;
  memory: AiMemory;
  profile: DifficultyProfile;
  seat: number;
}

function isAttackCard(card: Card | null): boolean {
  if (!card) return false;
  return (
    card.kind === 'skip' ||
    card.kind === 'reverse' ||
    card.kind === 'draw2' ||
    card.kind === 'wild4'
  );
}

/** 出牌后的有效颜色（万能牌取所选色） */
function resultingColor(draft: CandidateDraft): Color | null {
  return draft.card?.color ?? draft.colorChoice;
}

/** 除指定牌之外的手牌 */
function handWithout(hand: readonly Card[], card: Card | null): Card[] {
  if (!card) return [...hand];
  return hand.filter((item) => item.id !== card.id);
}

/** 某玩家手牌中指定颜色的张数 */
function countColor(cards: readonly Card[], color: Color | null): number {
  if (!color) return 0;
  return cards.reduce((sum, card) => (card.color === color ? sum + 1 : sum), 0);
}

/**
 * 挑战概率校准系数（M2 自对弈实测）：原始超几何估计的均值约 0.71，
 * 但实际挑战成功（对方真违规）率约 0.46。原因是对手"出 +4"这一行为本身带选择偏差
 * （倾向在没有当前颜色牌时把 +4 当攻击牌打出），因此估计值需要向下校准。
 */
export const CHALLENGE_ESTIMATE_CALIBRATION = 0.68;

/**
 * 估计 +4 出牌者"当时手里有当前颜色牌"（即违规、挑战会成功）的概率。
 *
 * 依据：
 * - 公开信息：+4 打出前的颜色（从事件历史重建）、出牌者当前手牌数、各色剩余张数；
 * - 超几何分布：把未知牌（抽牌堆 + 其他手牌）视为均匀分布，出牌者手牌是其子集；
 * - `full-plus` 档额外用行为建模（对手曾被抓诈唬 / 被证明合法的历史）。
 *
 * 注意：这是**概率估计**，不含任何隐藏信息；真实判定由引擎在挑战结算时执行。
 */
export function estimateChallengeIllegalProbability(
  view: AiView,
  memory: AiMemory,
  profile: DifficultyProfile,
): number {
  const strategy = profile.challenge;
  if (profile.memoryLevel === 'none') return clamp01(strategy.priorIllegal);

  const preColor = memory.colorBeforeLastWild4;
  const pending = view.pendingChallenge;
  if (!preColor || !pending) return clamp01(strategy.priorIllegal);

  const target = view.players.find((player) => player.seat === pending.targetSeat);
  const handCount = target?.handCount ?? 0;
  if (handCount <= 0) return 0;

  const remaining = memory.remainingByColor[preColor];
  const unknown = memory.unknownCards;
  if (unknown <= 0) return clamp01(strategy.priorIllegal);

  let probability: number;
  if (profile.memoryLevel === 'colors') {
    const ratio = Math.min(1, remaining / unknown);
    probability = 1 - (1 - ratio) ** handCount;
  } else {
    probability = probabilityAtLeastOne(remaining, unknown, handCount);
  }
  probability *= CHALLENGE_ESTIMATE_CALIBRATION;

  if (profile.memoryLevel === 'full-plus' && target) {
    const targetMemory = memory.players.find((player) => player.seat === target.seat);
    if (targetMemory) {
      probability += 0.12 * Math.min(2, targetMemory.wild4BluffsCaught);
      probability -= 0.1 * Math.min(2, targetMemory.wild4LegalProven);
    }
  }

  const estimated = Number.isFinite(probability) ? probability : strategy.priorIllegal;
  // 留一点先验兜底：极端局面（未知牌很少）也不至于 0% / 100% 绝对化
  return clamp01(0.02 + 0.96 * clamp01(estimated));
}

/** 提取单个候选的全部特征 */
export function extractFeatures(draft: CandidateDraft, context: FeatureContext): CandidateFeatures {
  const { view, memory, profile } = context;
  const isPlay =
    draft.kind === 'play' || draft.kind === 'play-drawn' || draft.kind === 'stack-play';
  const handSize = view.hand.length;
  const handAfter = isPlay ? handSize - 1 : handSize;
  const handAfterCards = handWithout(view.hand, draft.card);
  const resultColor = resultingColor(draft);
  const nextSeat = nextPlayerSeat(view);
  const nextCount = view.players[nextSeat]?.handCount ?? 0;
  const opponentCounts = view.players
    .filter((player) => player.seat !== view.seat)
    .map((player) => player.handCount);
  const minOpponentCount = opponentCounts.length > 0 ? Math.min(...opponentCounts) : handSize;
  const attack = isPlay ? extractAttack(draft, view, nextCount) : 0;

  const features: CandidateFeatures = {
    handReduction: isPlay ? 1 : 0,
    attack,
    colorKeep: isPlay ? extractColorKeep(draft, handAfterCards, resultColor) : 0,
    followUp: isPlay ? extractFollowUp(draft, handAfterCards, resultColor) : 0,
    wildCost: isPlay ? extractWildCost(draft, handSize) : 0,
    endgame: isPlay ? extractEndgame(draft, handAfter, nextCount) : 0,
    threat: isPlay && isAttackCard(draft.card) ? extractThreat(nextCount, minOpponentCount) : 0,
    stackGain: draft.kind === 'stack-play' ? extractStackGain(draft, view, nextCount) : 0,
    drawCost: extractDrawCost(draft, view, memory),
    bluffRisk: extractBluffRisk(draft, view, memory, profile),
    nextPlayerWeakColor: 0,
    colorFit: 0,
    challengeSuccess: 0,
    challengeRisk: 0,
  };

  // 颜色控制 / 下家缺色：出牌（含万能牌选色）与开局选色都要用
  if ((isPlay || draft.kind === 'choose-color') && resultColor) {
    features.colorFit =
      handAfter === 0
        ? 1
        : clamp01(countColor(handAfterCards, resultColor) / Math.max(1, handAfter));
    const pNextHasColor = estimatePlayerHasColor(
      memory,
      nextCount,
      resultColor,
      profile.memoryLevel,
    );
    features.nextPlayerWeakColor = clamp01(1 - pNextHasColor);
  }

  // 挑战窗口：给出成功率估计（具体挑战与否由 decide 按难度策略决定）
  if (draft.kind === 'challenge') {
    const probability = estimateChallengeIllegalProbability(view, memory, profile);
    features.challengeSuccess = probability;
    features.challengeRisk = clamp01(1 - probability);
  }

  return features;
}

function extractAttack(draft: CandidateDraft, view: AiView, nextCount: number): number {
  if (!draft.card) return 0;
  let attack: number;
  switch (draft.card.kind) {
    case 'skip':
      attack = 0.5;
      break;
    case 'reverse':
      // 2 人局 Reverse = 额外一回合，价值更高
      attack = view.players.length === 2 ? 0.75 : 0.45;
      break;
    case 'draw2':
      attack = 0.7;
      break;
    case 'wild4':
      attack = 0.55;
      break;
    case 'wild':
      attack = 0.2;
      break;
    default:
      attack = 0;
  }
  if (isAttackCard(draft.card)) {
    attack += clamp01((3 - nextCount) / 3) * 0.35;
  }
  if (draft.kind === 'stack-play') attack = Math.max(attack, 0.35);
  return clamp01(attack);
}

function extractColorKeep(
  draft: CandidateDraft,
  handAfterCards: readonly Card[],
  resultColor: Color | null,
): number {
  if (!draft.card || !resultColor) return 0;
  const matching = countColor(handAfterCards, resultColor);
  return clamp01(matching / Math.max(1, handAfterCards.length));
}

/**
 * 出牌后自己还剩多少"下一手可出"的牌（不调用引擎，纯公开信息规则推导）。
 *
 * 作用：出牌后桌面顶牌就是自己打出的牌，若手里还有大量能压它的牌，
 * 说明牌型更灵活；相反只剩一堆死牌则后续被动。骨灰级更看重这一点。
 */
function extractFollowUp(
  draft: CandidateDraft,
  handAfterCards: readonly Card[],
  resultColor: Color | null,
): number {
  const card = draft.card;
  if (!card) return 0;
  if (handAfterCards.length === 0) return 1;

  let playable = 0;
  for (const item of handAfterCards) {
    if (item.kind === 'wild' || item.kind === 'wild4') {
      playable += 1;
      continue;
    }
    if (resultColor && item.color === resultColor) {
      playable += 1;
      continue;
    }
    if (card.kind === 'number' && item.kind === 'number' && item.value === card.value) {
      playable += 1;
      continue;
    }
    if (
      (card.kind === 'skip' || card.kind === 'reverse' || card.kind === 'draw2') &&
      item.kind === card.kind
    ) {
      playable += 1;
    }
  }
  return clamp01(playable / handAfterCards.length);
}

function extractWildCost(draft: CandidateDraft, handSize: number): number {
  if (!draft.card) return 0;
  if (draft.card.kind !== 'wild' && draft.card.kind !== 'wild4') return 0;
  const cost = clamp01((handSize - 2) / 8);
  return clamp01(cost + (draft.card.kind === 'wild4' ? 0.1 : 0));
}

function extractEndgame(draft: CandidateDraft, handAfter: number, nextCount: number): number {
  let endgame: number;
  if (handAfter <= 0) endgame = 1;
  else if (handAfter === 1) endgame = 0.6;
  else if (handAfter === 2) endgame = 0.3;
  else endgame = 0;

  if (isAttackCard(draft.card)) {
    if (nextCount <= 1) endgame = Math.max(endgame, 0.9);
    else if (nextCount <= 2) endgame = Math.max(endgame, 0.6);
    if (handAfter <= 2) endgame = Math.max(endgame, 0.5);
  }
  return clamp01(endgame);
}

function extractThreat(nextCount: number, minOpponentCount: number): number {
  const nextThreat = clamp01((3 - nextCount) / 3) * 0.7;
  const leaderThreat = clamp01((3 - minOpponentCount) / 3) * 0.3;
  return clamp01(nextThreat + leaderThreat);
}

function extractStackGain(draft: CandidateDraft, view: AiView, nextCount: number): number {
  if (!draft.card) return 0;
  const power = draft.card.kind === 'draw2' ? 2 : 4;
  const stackTotal = view.stack?.total ?? 0;
  let gain = 0.25 + (power + Math.min(stackTotal, 12) * 0.2) / 12;
  // 下家只剩 1~2 张时，叠牌可能被他用最后一张 +2/+4 反叠并直接赢；略微保守
  if (nextCount <= 2) gain -= 0.1;
  return clamp01(gain);
}

/**
 * 一次「主动摸牌」的期望张数（M3-3 规则变更，见 `docs/开发计划.md` 4.4）：
 * 摸牌会一直摸到出现可打出的牌为止，因此代价不再是固定的 1 张。
 *
 * 只用公开信息估计"随机一张未知牌可打出"的概率 p：
 * - 万能牌（Wild / Wild4）永远可出；
 * - 当前颜色的剩余牌一定可出；
 * - 同数字 / 同图案的跨色匹配无法从公开信息精确拆分，保守忽略（宁可低估 p、高估代价）。
 *
 * 未知牌 = 抽牌堆 + 其他玩家手牌；期望张数 E ≈ 1/p（几何分布），夹在 [1, 12] 防止极端值。
 */
export function estimateExpectedDraws(view: AiView, memory: AiMemory): number {
  const unknown = memory.unknownCards;
  if (unknown <= 0) return 1;
  const currentColor = view.currentColor;
  const colorCards = currentColor ? (memory.remainingByColor[currentColor] ?? 0) : 0;
  const wilds = memory.wildsRemaining + memory.wild4Remaining;
  const playable = Math.min(unknown, wilds + colorCards);
  const probability = Math.max(0.08, playable / unknown);
  return Math.min(12, Math.max(1, 1 / probability));
}

function extractDrawCost(draft: CandidateDraft, view: AiView, memory: AiMemory): number {
  if (draft.kind === 'draw') {
    // 以"期望摸 3 张"为 1 个代价单位（与旧规则 drawCost=1 ≈ 摸 1 张的手感对齐）
    return clamp01(estimateExpectedDraws(view, memory) / 3);
  }
  if (draft.kind === 'stack-decline') {
    return clamp01((view.stack?.total ?? 0) / 12);
  }
  if (draft.kind === 'end-turn') return 0.15;
  return 0;
}

/**
 * 手持当前颜色牌仍出 +4 的"诈唬风险"。
 *
 * 注意：叠牌响应阶段打出的 +4 不开放挑战（引擎 M1-4 规则），因此不计风险。
 * 风险值 = 估计被挑战概率 × 通用风险系数 × (1 - 难度诈唬倾向)。
 */
function extractBluffRisk(
  draft: CandidateDraft,
  view: AiView,
  memory: AiMemory,
  profile: DifficultyProfile,
): number {
  if (draft.kind !== 'play' && draft.kind !== 'play-drawn') return 0;
  if (!draft.card || draft.card.kind !== 'wild4') return 0;

  const currentColor = view.currentColor;
  const rest = handWithout(view.hand, draft.card);
  const hasMatchingColor = currentColor ? rest.some((card) => card.color === currentColor) : false;
  const hasWild = rest.some((card) => card.kind === 'wild');
  const illegal = hasMatchingColor || (view.config.wild4Legality === 'new-version' && hasWild);
  if (!illegal) return 0;

  const attempts = memory.challengeSuccesses + memory.challengeFails;
  const pChallenge = clamp01(0.35 + attempts * 0.04);
  return clamp01(pChallenge * (1 - profile.bluffChance * 0.6) * 0.9);
}
