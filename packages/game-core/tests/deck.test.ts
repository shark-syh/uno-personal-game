import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALL_COLORS, createDeck } from '../src/deck.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

interface Manifest {
  totalCards: number;
  uniqueFaces: number;
  cards: Array<{ code: string; copies: number }>;
}

describe('createDeck', () => {
  it('生成 108 张牌', () => {
    expect(createDeck()).toHaveLength(108);
  });

  it('牌型数量符合原版：76 数字 + 24 动作 + 8 万能', () => {
    const cards = createDeck();
    const count = (kind: string): number => cards.filter((card) => card.kind === kind).length;
    expect(count('number')).toBe(76);
    expect(count('draw2')).toBe(8);
    expect(count('reverse')).toBe(8);
    expect(count('skip')).toBe(8);
    expect(count('wild')).toBe(4);
    expect(count('wild4')).toBe(4);
  });

  it('每种颜色：数字牌 19 张（0 一张 + 1~9 各两张）+ 动作牌 6 张', () => {
    const cards = createDeck();
    for (const color of ALL_COLORS) {
      const ofColor = cards.filter((card) => card.color === color);
      const numbers = ofColor.filter((card) => card.kind === 'number');
      expect(numbers).toHaveLength(19);
      expect(numbers.filter((card) => card.value === 0)).toHaveLength(1);
      expect(ofColor.filter((card) => card.kind !== 'number')).toHaveLength(6);
      for (let value = 1; value <= 9; value += 1) {
        expect(numbers.filter((card) => card.value === value)).toHaveLength(2);
      }
    }
  });

  it('id 全局唯一', () => {
    const cards = createDeck();
    expect(new Set(cards.map((card) => card.id)).size).toBe(108);
  });

  it('与卡面 manifest 完全一致（54 种面、108 张、每种面数量正确）', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(repoRoot, 'apps/web/cards/manifest.json'), 'utf-8'),
    ) as Manifest;

    const deckCounts = new Map<string, number>();
    for (const card of createDeck()) {
      deckCounts.set(card.faceCode, (deckCounts.get(card.faceCode) ?? 0) + 1);
    }

    expect(manifest.cards).toHaveLength(54);
    expect(manifest.totalCards).toBe(108);
    expect(deckCounts.size).toBe(54);
    for (const entry of manifest.cards) {
      expect(deckCounts.get(entry.code), `faceCode ${entry.code} 的数量`).toBe(entry.copies);
    }
  });

  it('数字牌 value 与 faceCode 对应；万能牌 color/value 为 null', () => {
    for (const card of createDeck()) {
      if (card.kind === 'number') {
        expect(card.value).not.toBeNull();
        expect(card.faceCode.endsWith(String(card.value))).toBe(true);
        expect(card.color).not.toBeNull();
      }
      if (card.kind === 'wild' || card.kind === 'wild4') {
        expect(card.color).toBeNull();
        expect(card.value).toBeNull();
      }
    }
  });
});
