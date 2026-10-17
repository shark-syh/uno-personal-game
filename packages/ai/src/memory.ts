/**
 * AI 记牌器（M2）：只根据公开信息 + 自己的手牌统计"每个颜色还剩多少张"。
 *
 * 牌组构成（108 张，由 game-core 的 `createDeck()` 推导，避免手写常量漂移）：
 * - 每种颜色 25 张（数字 19 + 动作 6），共 100 张；
 * - Wild 4 张、Wild+4 4 张。
 *
 * 难度档位通过 `memoryLevel` 决定特征使用哪一档信息：
 * - `none`：完全不记（挑战估计用先验，下家缺色用 0.5 均匀值）；
 * - `colors`：只记颜色剩余数量（简单比例推断）；
 * - `full`：全部已出牌（超几何分布精确推断）；
 * - `full-plus`：在 full 基础上增加行为建模（对手诈唬/挑战历史）。
 */
import { createDeck } from '@uno/game-core';
import type { Card, CardKind, Color, GameEvent } from '@uno/game-core';
import type { AiMemory, AiView, MemoryLevel, PlayerMemory } from './types.ts';
import { colorBeforeLastWild4 } from './view.ts';

/** 用引擎牌组推导初始张数，避免与引擎口径不一致 */
const INITIAL = (() => {
  const deck = createDeck();
  const colors: Record<Color, number> = { red: 0, yellow: 0, green: 0, blue: 0 };
  const kinds: Record<CardKind, number> = {
    number: 0,
    skip: 0,
    reverse: 0,
    draw2: 0,
    wild: 0,
    wild4: 0,
  };
  for (const card of deck) {
    if (card.color) colors[card.color] += 1;
    kinds[card.kind] += 1;
  }
  return { colors, kinds };
})();

/** 初始牌组各颜色张数（25/色） */
export const INITIAL_COLOR_COUNTS: Readonly<Record<Color, number>> = INITIAL.colors;

/** 初始牌组各牌型张数 */
export const INITIAL_KIND_COUNTS: Readonly<Record<CardKind, number>> = INITIAL.kinds;

function emptyColorRecord(): Record<Color, number> {
  return { red: 0, yellow: 0, green: 0, blue: 0 };
}

/** 把"已公开的牌"（弃牌堆 + 自己手牌）按颜色/牌型计数 */
function countSeen(cards: readonly Card[]): {
  colors: Record<Color, number>;
  kinds: Record<CardKind, number>;
} {
  const colors = emptyColorRecord();
  const kinds: Record<CardKind, number> = {
    number: 0,
    skip: 0,
    reverse: 0,
    draw2: 0,
    wild: 0,
    wild4: 0,
  };
  for (const card of cards) {
    if (card.color) colors[card.color] += 1;
    kinds[card.kind] += 1;
  }
  return { colors, kinds };
}

function buildPlayerMemories(view: AiView): PlayerMemory[] {
  const players: PlayerMemory[] = view.players.map((item) => ({
    seat: item.seat,
    isHuman: item.isHuman,
    handCount: item.handCount,
    saidUno: item.saidUno,
    colorsPlayed: emptyColorRecord(),
    actionCardsPlayed: 0,
    wild4Played: 0,
    plays: 0,
    draws: 0,
    wild4BluffsCaught: 0,
    wild4LegalProven: 0,
  }));

  const bySeat = new Map<number, PlayerMemory>();
  for (const player of players) bySeat.set(player.seat, player);

  for (const event of view.history) {
    applyPublicEvent(event, bySeat);
  }

  return players;
}

/** 把一条公开事件记到对应玩家的统计里 */
function applyPublicEvent(event: GameEvent, bySeat: Map<number, PlayerMemory>): void {
  switch (event.type) {
    case 'PLAY': {
      const player = bySeat.get(event.seat);
      if (!player) return;
      player.plays += 1;
      if (event.card.color) player.colorsPlayed[event.card.color] += 1;
      if (event.card.kind !== 'number') player.actionCardsPlayed += 1;
      if (event.card.kind === 'wild4') player.wild4Played += 1;
      return;
    }
    case 'DRAW': {
      const player = bySeat.get(event.seat);
      if (player) player.draws += event.count;
      return;
    }
    case 'CHALLENGE_SUCCESS': {
      const target = bySeat.get(event.target);
      if (target) target.wild4BluffsCaught += 1;
      return;
    }
    case 'CHALLENGE_FAIL': {
      const target = bySeat.get(event.target);
      if (target) target.wild4LegalProven += 1;
      return;
    }
    default:
      return;
  }
}

/** 构造记牌器（纯函数：只读公开视图） */
export function buildMemory(view: AiView): AiMemory {
  const seen = countSeen([...view.discardPile, ...view.hand]);
  const remainingByColor = emptyColorRecord();
  for (const color of ['red', 'yellow', 'green', 'blue'] as const) {
    remainingByColor[color] = Math.max(0, INITIAL.colors[color] - seen.colors[color]);
  }

  const otherHandCount = view.players.reduce(
    (sum, player) => (player.seat === view.seat ? sum : sum + player.handCount),
    0,
  );

  return {
    seat: view.seat,
    remainingByColor,
    wildsRemaining: Math.max(0, INITIAL.kinds.wild - seen.kinds.wild),
    wild4Remaining: Math.max(0, INITIAL.kinds.wild4 - seen.kinds.wild4),
    draw2Remaining: Math.max(0, INITIAL.kinds.draw2 - seen.kinds.draw2),
    skipRemaining: Math.max(0, INITIAL.kinds.skip - seen.kinds.skip),
    reverseRemaining: Math.max(0, INITIAL.kinds.reverse - seen.kinds.reverse),
    unknownCards: view.drawPileCount + otherHandCount,
    seenCards: view.discardPile.length + view.hand.length,
    players: buildPlayerMemories(view),
    challengeSuccesses: view.history.filter((event) => event.type === 'CHALLENGE_SUCCESS').length,
    challengeFails: view.history.filter((event) => event.type === 'CHALLENGE_FAIL').length,
    colorBeforeLastWild4: colorBeforeLastWild4(view.history),
  };
}

/**
 * 超几何分布：从 `unknownCards` 张未知牌中抽 `draws` 张，至少抽到 1 张目标牌的概率。
 * 目标牌共 `successCards` 张。
 */
export function probabilityAtLeastOne(
  successCards: number,
  unknownCards: number,
  draws: number,
): number {
  if (draws <= 0 || successCards <= 0) return 0;
  if (unknownCards <= 0) return 0;
  if (successCards >= unknownCards) return 1;

  let pNone = 1;
  for (let index = 0; index < draws; index += 1) {
    const remainingUnknown = unknownCards - index;
    if (remainingUnknown <= 0) break;
    const remainingMiss = unknownCards - successCards - index;
    if (remainingMiss <= 0) return 1;
    pNone *= remainingMiss / remainingUnknown;
  }
  return 1 - pNone;
}

/**
 * 估计某玩家手里至少有 1 张指定颜色牌的概率（按记牌档位使用不同精度）。
 * 只依赖公开信息：未知牌总数、该色剩余数量、该玩家手牌数。
 */
export function estimatePlayerHasColor(
  memory: AiMemory,
  handCount: number,
  color: Color,
  level: MemoryLevel,
): number {
  if (handCount <= 0) return 0;
  if (level === 'none') return 0.5;

  const remaining = memory.remainingByColor[color];
  const unknown = memory.unknownCards;
  if (unknown <= 0) return 0.5;

  if (level === 'colors') {
    const ratio = Math.min(1, remaining / unknown);
    return clamp01(1 - (1 - ratio) ** handCount);
  }
  return clamp01(probabilityAtLeastOne(remaining, unknown, handCount));
}

/** 把数值夹到 [0, 1] */
export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
