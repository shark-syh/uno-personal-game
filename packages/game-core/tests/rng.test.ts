import { describe, expect, it } from 'vitest';
import { createRng, hashSeed, nextFloat, nextInt, shuffle } from '../src/rng.ts';

describe('rng / 可复现随机', () => {
  it('相同种子产生相同序列', () => {
    const a = createRng('hello');
    const b = createRng('hello');
    const seqA = Array.from({ length: 20 }, () => nextFloat(a));
    const seqB = Array.from({ length: 20 }, () => nextFloat(b));
    expect(seqA).toEqual(seqB);
  });

  it('不同种子产生不同序列', () => {
    const a = createRng('seed-a');
    const b = createRng('seed-b');
    expect(Array.from({ length: 10 }, () => nextFloat(a))).not.toEqual(
      Array.from({ length: 10 }, () => nextFloat(b)),
    );
  });

  it('nextFloat 始终落在 [0, 1)', () => {
    const rng = createRng('range');
    for (let i = 0; i < 1000; i += 1) {
      const value = nextFloat(rng);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('nextInt 返回值在范围内，非法参数抛错', () => {
    const rng = createRng('int');
    for (let i = 0; i < 500; i += 1) {
      const value = nextInt(rng, 10);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(10);
    }
    expect(() => nextInt(rng, 0)).toThrow(RangeError);
    expect(() => nextInt(rng, 2.5)).toThrow(RangeError);
  });

  it('字符串与数字种子都能稳定散列', () => {
    expect(hashSeed('abc')).toBe(hashSeed('abc'));
    expect(hashSeed(42)).toBe(hashSeed(42));
    expect(hashSeed('abc')).not.toBe(hashSeed('abd'));
  });

  it('洗牌：相同种子结果一致、不丢牌不重复、顺序确实被打乱', () => {
    const items = Array.from({ length: 108 }, (_, index) => index);
    const shuffledA = shuffle(items, createRng('shuffle-seed'));
    const shuffledB = shuffle(items, createRng('shuffle-seed'));

    expect(shuffledA).toEqual(shuffledB);
    expect(shuffledA).not.toEqual(items);
    expect([...shuffledA].sort((left, right) => left - right)).toEqual(items);
    expect(items).toEqual(Array.from({ length: 108 }, (_, index) => index)); // 不修改入参
  });
});
