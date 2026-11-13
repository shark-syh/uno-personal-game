import { describe, expect, it } from 'vitest';
import { DEFAULT_GAME_CONFIG, normalizeGameConfig } from '../src/config.ts';
import { ALL_COLORS, cardLabel, createDeck, expectedDeckSize } from '../src/deck.ts';
import { countCards, createInitialGame, getTopCard } from '../src/setup.ts';

/** 与 B 版卡面资源 `research/open-mercy/cards-webp/` 文件名一一对应 */
const MERCY_NUMBER_WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven-swap', 'eight', 'nine',
];
const MERCY_ACTION_WORDS = [
  'two-draw', 'four-draw', 'skip', 'reverse', 'skip-everyone', 'discard-all',
];
const MERCY_WILD_CODES = [
  'wild-draw-six', 'wild-ten-draw', 'wild-reverse-four-draw', 'wild-roulette',
];

function expectedMercyFaces(): Set<string> {
  const faces = new Set<string>();
  for (const color of ALL_COLORS) {
    for (const word of MERCY_NUMBER_WORDS) faces.add(`${word}-${color}`);
    for (const word of MERCY_ACTION_WORDS) faces.add(`${word}-${color}`);
  }
  for (const code of MERCY_WILD_CODES) faces.add(code);
  return faces;
}

describe('M1 三模式数据层 · 配置', () => {
  it('默认 mode 为 classic，既有配置字段一个不少', () => {
    expect(DEFAULT_GAME_CONFIG.mode).toBe('classic');
    expect(normalizeGameConfig().mode).toBe('classic');
    expect(normalizeGameConfig({ mode: 'mercy' }).mode).toBe('mercy');
  });

  it('未知 mode 明确抛 RangeError', () => {
    expect(() => normalizeGameConfig({ mode: 'nope' as never })).toThrow(RangeError);
  });

  it('牌堆张数：classic 108 / mercy 168，flip 明确抛错', () => {
    expect(expectedDeckSize()).toBe(108);
    expect(expectedDeckSize({ mode: 'mercy' })).toBe(168);
    expect(() => expectedDeckSize({ mode: 'flip' })).toThrow(/尚未实现/);
  });
});

describe('M1 三模式数据层 · 牌堆', () => {
  it('createDeck() 无参仍是标准 108 张（既有行为零改动）', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(108);
    expect(new Set(deck.map((card) => card.faceCode)).size).toBe(54);
    expect(deck.filter((card) => card.kind === 'wild4')).toHaveLength(4);
  });

  it('createDeck({ mode: "mercy" }) 生成 168 张、68 个唯一卡面', () => {
    const deck = createDeck({ mode: 'mercy' });
    expect(deck).toHaveLength(168);
    expect(new Set(deck.map((card) => card.id)).size).toBe(168);
    expect(new Set(deck.map((card) => card.faceCode)).size).toBe(68);
  });

  it('友尽版 faceCode 与 B 版 68 个资源文件名完全一致', () => {
    const expected = expectedMercyFaces();
    expect(expected.size).toBe(68);
    const actual = new Set(createDeck({ mode: 'mercy' }).map((card) => card.faceCode));
    expect([...actual].sort()).toEqual([...expected].sort());
  });

  it('友尽版牌型数量符合官方 168 张牌表，且不含普通 Wild / Wild+4', () => {
    const deck = createDeck({ mode: 'mercy' });
    const count = (kind: string): number => deck.filter((card) => card.kind === kind).length;
    expect(count('number')).toBe(80);
    expect(count('draw2')).toBe(12);
    expect(count('skip')).toBe(12);
    expect(count('reverse')).toBe(12);
    expect(count('discardAll')).toBe(12);
    expect(count('draw4')).toBe(8);
    expect(count('skipEveryone')).toBe(8);
    expect(count('wildReverseDraw4')).toBe(8);
    expect(count('wildColorRoulette')).toBe(8);
    expect(count('draw6')).toBe(4);
    expect(count('draw10')).toBe(4);
    expect(count('wild')).toBe(0);
    expect(count('wild4')).toBe(0);
  });

  it('友尽版数字 0~9 每色各 2 张；万能牌 color/value 为 null', () => {
    const deck = createDeck({ mode: 'mercy' });
    for (const color of ALL_COLORS) {
      const numbers = deck.filter((card) => card.color === color && card.kind === 'number');
      expect(numbers).toHaveLength(20);
      for (let value = 0; value <= 9; value += 1) {
        expect(numbers.filter((card) => card.value === value)).toHaveLength(2);
      }
    }
    for (const card of deck) {
      if (card.color === null) {
        expect(card.value).toBeNull();
        expect(MERCY_WILD_CODES).toContain(card.faceCode);
      }
    }
  });

  it('flip 牌堆明确抛错，不静默回退到基础牌堆', () => {
    expect(() => createDeck({ mode: 'flip' })).toThrow(/尚未实现/);
  });

  it('cardLabel 覆盖友尽版全部新牌型', () => {
    const deck = createDeck({ mode: 'mercy' });
    for (const card of deck) {
      expect(cardLabel(card)).not.toBe(card.faceCode);
      expect(cardLabel(card).length).toBeGreaterThan(0);
    }
    expect(cardLabel(deck.find((card) => card.kind === 'draw10')!)).toBe('Wild+10');
    expect(cardLabel(deck.find((card) => card.kind === 'skipEveryone')!)).toBe('红全员跳过');
  });
});

describe('M1 三模式数据层 · 开局', () => {
  it('createInitialGame() 默认 classic：总牌数 108 守恒', () => {
    const state = createInitialGame({ seed: 'm1-classic' });
    expect(state.config.mode).toBe('classic');
    expect(countCards(state)).toBe(108);
    for (const player of state.players) expect(player.hand).toHaveLength(7);
  });

  it('createInitialGame({ mode: "mercy" }) 能开局：总牌数 168 守恒、起手必为数字牌', () => {
    const state = createInitialGame({ mode: 'mercy', seed: 'm1-mercy' });
    expect(state.config.mode).toBe('mercy');
    expect(countCards(state)).toBe(168);
    for (const player of state.players) expect(player.hand).toHaveLength(7);
    expect(getTopCard(state).kind).toBe('number');
    expect(state.currentColor).not.toBeNull();
    expect(state.phase).toBe('await-play');
  });

  it('友尽开局在多个种子下都守恒且起手为数字牌', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const state = createInitialGame({ mode: 'mercy', seed });
      expect(countCards(state), `seed ${seed}`).toBe(168);
      expect(getTopCard(state).kind, `seed ${seed}`).toBe('number');
    }
  });
});
