import type {
  Card,
  Color,
  Direction,
  GameConfig,
  GameEvent,
  GamePhase,
  GameState,
  PlayerState,
} from './types.ts';
import { normalizeGameConfig } from './config.ts';
import { createDeck } from './deck.ts';
import { createRng, nextInt, shuffle } from './rng.ts';

/** AI 默认名字池（最多 9 个 AI） */
const AI_NAME_POOL = ['老王', '小美', '阿强', '阿珍', '大熊', '小七', '阿黄', '豆豆', '铁蛋'];

/** 顺时针/逆时针的下一位 */
export function nextSeat(seat: number, playerCount: number, direction: Direction): number {
  return (seat + direction + playerCount) % playerCount;
}

/** 上一位（用于 Reverse 起手：原版由庄家先手） */
export function prevSeat(seat: number, playerCount: number): number {
  return (seat - 1 + playerCount) % playerCount;
}

/** 生成玩家名字：人类固定叫"你"，AI 从名字池顺序取 */
export function buildPlayerNames(config: GameConfig): string[] {
  const names: string[] = [];
  let aiIndex = 0;
  for (let seat = 0; seat < config.playerCount; seat += 1) {
    if (seat === config.humanSeat) {
      names.push('你');
    } else {
      names.push(AI_NAME_POOL[aiIndex % AI_NAME_POOL.length]!);
      aiIndex += 1;
    }
  }
  return names;
}

/** 统计全牌数量（手牌 + 抽牌堆 + 弃牌堆），必须恒等于 108 */
export function countCards(state: GameState): number {
  return (
    state.players.reduce((sum, player) => sum + player.hand.length, 0) +
    state.drawPile.length +
    state.discardPile.length
  );
}

/**
 * 创建一局新游戏并完成发牌与起手翻牌。
 *
 * 规则依据 `docs/开发计划.md` 第 4 章：
 * - 每人 7 张，随机庄家，庄家左手边先手；
 * - 起手数字牌：确定当前颜色；
 * - 起手 Wild：首位玩家选色（phase = choose-color）；
 * - 起手 Wild+4：放回洗牌重新翻（classic 规则）；
 * - 起手 Skip / Reverse / +2：由首位玩家承受效果；
 * - ignore-action 模式：跳过动作牌继续翻（Wild 仍保留，由首位玩家选色）。
 */
export function createInitialGame(partial: Partial<GameConfig> = {}): GameState {
  const config = normalizeGameConfig(partial);
  const rng = createRng(config.seed);
  const events: GameEvent[] = [];

  const players: PlayerState[] = buildPlayerNames(config).map((name, seat) => ({
    seat,
    name,
    isHuman: seat === config.humanSeat,
    hand: [],
    saidUno: false,
  }));

  let drawPile = shuffle(createDeck(), rng);

  const drawCard = (): Card => {
    const card = drawPile.pop();
    if (!card) throw new Error('抽牌堆已耗尽（开局阶段不应发生）');
    return card;
  };

  // 发牌：轮流发，每人 7 张
  for (let round = 0; round < 7; round += 1) {
    for (const player of players) {
      player.hand.push(drawCard());
    }
  }
  for (const player of players) {
    events.push({ type: 'DEAL', seat: player.seat, count: player.hand.length });
  }

  // 先手：随机（等价于随机庄家后庄家左手边先手）/ 强制人类先手
  const nominalFirst =
    config.startingPlayer === 'human' ? config.humanSeat : nextInt(rng, config.playerCount);
  const dealerSeat = prevSeat(nominalFirst, config.playerCount);

  // 起手翻牌：处理 Wild+4 重翻 / ignore-action 忽略动作牌
  const ignoredCards: Card[] = [];
  let startCard: Card | null = null;
  let guard = 0;
  while (!startCard) {
    guard += 1;
    if (guard > 216) throw new Error('起手翻牌异常：超过重翻上限');

    const candidate = drawCard();
    if (candidate.kind === 'wild4') {
      // 原版：放回牌堆、洗牌、重新翻
      drawPile.push(candidate);
      drawPile = shuffle(drawPile, rng);
      events.push({ type: 'PILE_RESHUFFLE', reason: 'wild4-start' });
      continue;
    }
    if (
      config.startCardRule === 'ignore-action' &&
      (candidate.kind === 'skip' || candidate.kind === 'reverse' || candidate.kind === 'draw2')
    ) {
      ignoredCards.push(candidate);
      events.push({ type: 'START_CARD_IGNORED', card: candidate });
      continue;
    }
    startCard = candidate;
  }
  // 被忽略的动作牌放回抽牌堆底部，保证 108 张始终守恒
  if (ignoredCards.length > 0) {
    drawPile = [...ignoredCards, ...drawPile];
    events.push({ type: 'PILE_RESHUFFLE', reason: 'ignore-action' });
  }

  const discardPile: Card[] = [startCard];
  events.push({ type: 'START_CARD', card: startCard });

  let direction: Direction = 1;
  let currentSeat = nominalFirst;
  let currentColor: Color | null = null;
  let pendingColorChoiceSeat: number | null = null;
  let phase: GamePhase = 'await-play';

  switch (startCard.kind) {
    case 'number': {
      currentColor = startCard.color;
      break;
    }
    case 'wild': {
      // 首位玩家选择颜色，选完才能出牌
      phase = 'choose-color';
      pendingColorChoiceSeat = nominalFirst;
      currentSeat = nominalFirst;
      break;
    }
    case 'skip': {
      currentColor = startCard.color;
      events.push({ type: 'SKIP', seat: nominalFirst });
      currentSeat = nextSeat(nominalFirst, config.playerCount, direction);
      break;
    }
    case 'reverse': {
      currentColor = startCard.color;
      direction = -1;
      events.push({ type: 'REVERSE', direction });
      currentSeat = prevSeat(nominalFirst, config.playerCount);
      break;
    }
    case 'draw2': {
      currentColor = startCard.color;
      const drawn = [drawCard(), drawCard()];
      players[nominalFirst]!.hand.push(...drawn);
      events.push({ type: 'DRAW', seat: nominalFirst, count: drawn.length, cards: drawn });
      currentSeat = nextSeat(nominalFirst, config.playerCount, direction);
      break;
    }
    case 'wild4': {
      // 上面的循环已保证起手不可能是 wild4
      throw new Error('起手牌不应该是 Wild+4');
    }
  }

  return {
    config,
    phase,
    players,
    drawPile,
    discardPile,
    currentColor,
    currentSeat,
    direction,
    dealerSeat,
    pendingColorChoiceSeat,
    drawnThisTurn: null,
    stack: null,
    wild4Info: null,
    pendingChallenge: null,
    unoWindow: null,
    turnCount: 0,
    actionCount: 0,
    winnerSeat: null,
    endReason: null,
    events,
    history: [...events],
    rng,
  };
}

/** 取弃牌堆顶牌 */
export function getTopCard(state: GameState): Card {
  const top = state.discardPile[state.discardPile.length - 1];
  if (!top) throw new Error('弃牌堆为空');
  return top;
}
