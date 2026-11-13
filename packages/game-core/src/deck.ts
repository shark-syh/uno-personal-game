import type { Card, CardKind, Color, GameConfig } from './types.ts';

/** 固定颜色顺序（红→黄→绿→蓝），用于生成牌组与显示 */
export const ALL_COLORS: readonly Color[] = ['red', 'yellow', 'green', 'blue'];

/** 颜色 → 卡面资源码前缀 */
export const COLOR_CODE: Record<Color, string> = {
  red: 'R',
  yellow: 'Y',
  green: 'G',
  blue: 'B',
};

/** 颜色 → 中文名（UI/演示用） */
export const COLOR_NAME: Record<Color, string> = {
  red: '红',
  yellow: '黄',
  green: '绿',
  blue: '蓝',
};

/** 全部牌型（基础 6 种 + 友尽新增 7 种），供 AI 统计表零值初始化，避免手写常量漂移 */
export const ALL_CARD_KINDS: readonly CardKind[] = [
  'number',
  'skip',
  'reverse',
  'draw2',
  'wild',
  'wild4',
  'draw4',
  'skipEveryone',
  'discardAll',
  'draw6',
  'draw10',
  'wildReverseDraw4',
  'wildColorRoulette',
];

/**
 * 友尽版数字牌卡面词，与 B 版资源 `research/open-mercy/cards-webp/` 的文件名一致。
 * 7 的资源名带换手标记（seven-swap），0 带传手符号但文件名仍为 zero。
 */
const MERCY_NUMBER_WORD: readonly string[] = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven-swap', 'eight', 'nine',
];

/** 各模式的牌堆张数（flip 尚未实现，见 expectedDeckSize） */
export const DECK_SIZE: Record<'classic' | 'mercy', number> = {
  classic: 108,
  mercy: 168,
};

/** 取某模式的牌堆总张数；flip 明确抛错，避免静默回退到基础牌堆 */
export function expectedDeckSize(config: Partial<GameConfig> = {}): number {
  const mode = config.mode ?? 'classic';
  if (mode === 'flip') {
    throw new Error('UNO Flip 牌堆尚未实现（后续阶段）');
  }
  return DECK_SIZE[mode];
}

/** 生成带全局唯一 id 的牌组收集器 */
function createPusher(): {
  cards: Card[];
  push: (kind: CardKind, color: Color | null, value: number | null, faceCode: string) => void;
} {
  const cards: Card[] = [];
  const counters = new Map<string, number>();
  const push = (kind: CardKind, color: Color | null, value: number | null, faceCode: string): void => {
    const index = counters.get(faceCode) ?? 0;
    counters.set(faceCode, index + 1);
    cards.push({ id: `${faceCode}#${index}`, kind, color, value, faceCode });
  };
  return { cards, push };
}

/** 标准 UNO 牌组：108 张（M1 之前的行为，逐字保留） */
function createClassicDeck(): Card[] {
  const { cards, push } = createPusher();

  for (const color of ALL_COLORS) {
    const prefix = COLOR_CODE[color];

    // 数字牌：0 一张；1~9 各两张 => 19 张/色
    push('number', color, 0, `${prefix}0`);
    for (let value = 1; value <= 9; value += 1) {
      for (let copy = 0; copy < 2; copy += 1) {
        push('number', color, value, `${prefix}${value}`);
      }
    }

    // 动作牌：每种颜色 +2 / 反转 / 跳过 各两张 => 6 张/色
    for (let copy = 0; copy < 2; copy += 1) {
      push('draw2', color, null, `${prefix}A2`);
      push('reverse', color, null, `${prefix}R`);
      push('skip', color, null, `${prefix}S`);
    }
  }

  // 万能牌：Wild 4 张、Wild Draw Four 4 张
  for (let copy = 0; copy < 4; copy += 1) {
    push('wild', null, null, 'WC');
    push('wild4', null, null, 'W4');
  }

  if (cards.length !== DECK_SIZE.classic) {
    throw new Error(`牌组生成错误：期望 ${DECK_SIZE.classic} 张，实际 ${cards.length} 张`);
  }
  return cards;
}

/**
 * 友尽版（UNO Show 'Em No Mercy）牌组：168 张 / 68 个唯一卡面。
 *
 * 官方盒装牌表（research/open-mercy/shared/engine/deck.ts、Fandom、Wikibooks）：
 * - 数字 0~9 各色 2 张 => 80
 * - Skip / Reverse / Draw 2 / Discard All 各色 3 张 => 48
 * - Draw 4 / Skip Everyone 各色 2 张 => 16
 * - Wild Reverse Draw 4 ×8、Wild Color Roulette ×8、Wild Draw 6 ×4、Wild Draw 10 ×4 => 24
 * 无普通 Wild / Wild +4。faceCode 直接采用 B 版卡面文件名，供后续阶段切资源目录。
 */
function createMercyDeck(): Card[] {
  const { cards, push } = createPusher();

  for (const color of ALL_COLORS) {
    for (let value = 0; value <= 9; value += 1) {
      const face = `${MERCY_NUMBER_WORD[value]}-${color}`;
      for (let copy = 0; copy < 2; copy += 1) {
        push('number', color, value, face);
      }
    }

    for (let copy = 0; copy < 3; copy += 1) {
      push('draw2', color, null, `two-draw-${color}`);
      push('skip', color, null, `skip-${color}`);
      push('reverse', color, null, `reverse-${color}`);
      push('discardAll', color, null, `discard-all-${color}`);
    }

    for (let copy = 0; copy < 2; copy += 1) {
      push('draw4', color, null, `four-draw-${color}`);
      push('skipEveryone', color, null, `skip-everyone-${color}`);
    }
  }

  for (let copy = 0; copy < 8; copy += 1) {
    push('wildReverseDraw4', null, null, 'wild-reverse-four-draw');
    push('wildColorRoulette', null, null, 'wild-roulette');
  }
  for (let copy = 0; copy < 4; copy += 1) {
    push('draw6', null, null, 'wild-draw-six');
    push('draw10', null, null, 'wild-ten-draw');
  }

  if (cards.length !== DECK_SIZE.mercy) {
    throw new Error(`牌组生成错误：期望 ${DECK_SIZE.mercy} 张，实际 ${cards.length} 张`);
  }
  return cards;
}

/**
 * 按玩法模式生成牌组。
 * 不传参数 / 不传 mode 时保持 classic（108 张），确保既有调用零改动。
 */
export function createDeck(config: Partial<GameConfig> = {}): Card[] {
  const mode = config.mode ?? 'classic';
  switch (mode) {
    case 'classic':
      return createClassicDeck();
    case 'mercy':
      return createMercyDeck();
    case 'flip':
      throw new Error('UNO Flip 牌堆尚未实现（后续阶段）');
    default:
      throw new Error(`未知玩法模式：${mode satisfies never}`);
  }
}

/** 牌面中文标签，如 "红7" / "蓝+2" / "Wild+4" / "Wild+10" */
export function cardLabel(card: Card): string {
  const color = card.color ? COLOR_NAME[card.color] : '';
  switch (card.kind) {
    case 'number':
      return `${color}${card.value ?? ''}`;
    case 'draw2':
      return `${color}+2`;
    case 'draw4':
      return `${color}+4`;
    case 'reverse':
      return `${color}反转`;
    case 'skip':
      return `${color}跳过`;
    case 'skipEveryone':
      return `${color}全员跳过`;
    case 'discardAll':
      return `${color}全弃`;
    case 'wild':
      return 'Wild';
    case 'wild4':
      return 'Wild+4';
    case 'draw6':
      return 'Wild+6';
    case 'draw10':
      return 'Wild+10';
    case 'wildReverseDraw4':
      return 'Wild 反转+4';
    case 'wildColorRoulette':
      return 'Wild 颜色轮盘';
    default:
      return card.faceCode;
  }
}
