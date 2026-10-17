import type { Card, CardKind, Color } from './types.ts';

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

/** 标准 UNO 牌组：108 张 */
export function createDeck(): Card[] {
  const cards: Card[] = [];
  const counters = new Map<string, number>();

  const push = (kind: CardKind, color: Color | null, value: number | null, faceCode: string): void => {
    const index = counters.get(faceCode) ?? 0;
    counters.set(faceCode, index + 1);
    cards.push({ id: `${faceCode}#${index}`, kind, color, value, faceCode });
  };

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

  if (cards.length !== 108) {
    throw new Error(`牌组生成错误：期望 108 张，实际 ${cards.length} 张`);
  }
  return cards;
}

/** 牌面中文标签，如 "红7" / "蓝+2" / "Wild+4" */
export function cardLabel(card: Card): string {
  if (card.kind === 'wild') return 'Wild';
  if (card.kind === 'wild4') return 'Wild+4';
  const color = card.color ? COLOR_NAME[card.color] : '';
  switch (card.kind) {
    case 'number':
      return `${color}${card.value ?? ''}`;
    case 'draw2':
      return `${color}+2`;
    case 'reverse':
      return `${color}反转`;
    case 'skip':
      return `${color}跳过`;
  }
}
