import type { RngState } from './types.ts';

/** 把字符串/数字种子散列成 uint32 */
export function hashSeed(input: string | number): number {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return (Math.trunc(input) >>> 0) || 0x9e3779b9;
  }
  const text = String(input);
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

/** 生成一个随机种子字符串（用于"完全随机"开局） */
export function createSeed(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 创建 RNG 状态；不传种子时自动生成随机种子 */
export function createRng(seedInput?: string | number): RngState {
  const seed = hashSeed(seedInput ?? createSeed());
  return { seed, value: seed };
}

/**
 * mulberry32：返回 [0, 1) 的伪随机数，并推进状态。
 * 相同 seed + 相同调用次数 => 相同结果（可复现对局）。
 */
export function nextFloat(rng: RngState): number {
  rng.value = (rng.value + 0x6d2b79f5) >>> 0;
  let t = rng.value;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** 返回 [0, maxExclusive) 的整数 */
export function nextInt(rng: RngState, maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new RangeError(`nextInt 的 maxExclusive 必须是正整数，收到 ${maxExclusive}`);
  }
  return Math.floor(nextFloat(rng) * maxExclusive);
}

/** Fisher–Yates 洗牌（返回新数组，不修改入参） */
export function shuffle<T>(items: readonly T[], rng: RngState): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = nextInt(rng, i + 1);
    const current = result[i]!;
    result[i] = result[j]!;
    result[j] = current;
  }
  return result;
}
