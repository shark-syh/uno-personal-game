import { describe, expect, it } from 'vitest';
import {
  DIFFICULTY_LABEL,
  DIFFICULTY_ORDER,
  DIFFICULTY_PROFILES,
  getDifficultyProfile,
  UNO_CALL_PROBABILITY,
  UNO_CATCH_PROBABILITY,
} from '../src/index.ts';

describe('M2 难度参数表', () => {
  it('四档难度齐全且顺序固定', () => {
    expect(DIFFICULTY_ORDER).toEqual(['casual', 'easy', 'realistic', 'hardcore']);
    for (const difficulty of DIFFICULTY_ORDER) {
      expect(DIFFICULTY_PROFILES[difficulty].difficulty).toBe(difficulty);
      expect(DIFFICULTY_LABEL[difficulty].length).toBeGreaterThan(0);
    }
    expect(getDifficultyProfile('hardcore')).toBe(DIFFICULTY_PROFILES.hardcore);
  });

  it('未知难度抛错', () => {
    expect(() => getDifficultyProfile('nightmare' as never)).toThrow(RangeError);
  });

  it('难度越高失误率与噪声越低', () => {
    const rates = DIFFICULTY_ORDER.map((difficulty) => DIFFICULTY_PROFILES[difficulty].mistakeRate);
    const noises = DIFFICULTY_ORDER.map((difficulty) => DIFFICULTY_PROFILES[difficulty].noise);
    for (let index = 1; index < rates.length; index += 1) {
      expect(rates[index]!).toBeLessThanOrEqual(rates[index - 1]!);
      expect(noises[index]!).toBeLessThanOrEqual(noises[index - 1]!);
    }
    expect(DIFFICULTY_PROFILES.hardcore.mistakeRate).toBe(0);
    expect(DIFFICULTY_PROFILES.hardcore.noise).toBe(0);
  });

  it('记牌档位随难度提升（none → colors → full → full-plus）', () => {
    expect(
      DIFFICULTY_ORDER.map((difficulty) => DIFFICULTY_PROFILES[difficulty].memoryLevel),
    ).toEqual(['none', 'colors', 'full', 'full-plus']);
  });

  it('挑战策略：休闲乱挑战、其余按阈值且越强越敢挑战', () => {
    expect(DIFFICULTY_PROFILES.casual.challenge.mode).toBe('random');
    expect(DIFFICULTY_PROFILES.casual.challenge.randomChance).toBeCloseTo(0.1, 5);
    expect(DIFFICULTY_PROFILES.easy.challenge.mode).toBe('simple');
    expect(DIFFICULTY_PROFILES.realistic.challenge.mode).toBe('estimate');
    expect(DIFFICULTY_PROFILES.hardcore.challenge.mode).toBe('ev');
    expect(DIFFICULTY_PROFILES.easy.challenge.threshold).toBeGreaterThan(
      DIFFICULTY_PROFILES.realistic.challenge.threshold,
    );
    expect(DIFFICULTY_PROFILES.realistic.challenge.threshold).toBeGreaterThan(
      DIFFICULTY_PROFILES.hardcore.challenge.threshold,
    );
  });

  it('诈唬倾向随难度提高（休闲从不诈唬）', () => {
    expect(DIFFICULTY_PROFILES.casual.bluffChance).toBe(0);
    expect(DIFFICULTY_PROFILES.easy.bluffChance).toBeLessThanOrEqual(
      DIFFICULTY_PROFILES.realistic.bluffChance,
    );
    expect(DIFFICULTY_PROFILES.realistic.bluffChance).toBeLessThanOrEqual(
      DIFFICULTY_PROFILES.hardcore.bluffChance,
    );
  });

  it('关键特征权重随难度增强（攻击/终局/保持牌型/下家缺色/风险）', () => {
    const keys = [
      'attack',
      'endgame',
      'followUp',
      'nextPlayerWeakColor',
      'colorFit',
      'bluffRisk',
      'stackGain',
    ] as const;
    for (const key of keys) {
      expect(DIFFICULTY_PROFILES.hardcore.weights[key]).toBeGreaterThanOrEqual(
        DIFFICULTY_PROFILES.realistic.weights[key],
      );
      expect(DIFFICULTY_PROFILES.realistic.weights[key]).toBeGreaterThanOrEqual(
        DIFFICULTY_PROFILES.easy.weights[key],
      );
    }
    for (const difficulty of DIFFICULTY_ORDER) {
      for (const value of Object.values(DIFFICULTY_PROFILES[difficulty].weights)) {
        expect(value).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('UNO 喊/抓概率与 M1-6 引擎口径一致', () => {
    expect(UNO_CALL_PROBABILITY).toEqual({
      casual: 0.8,
      easy: 0.95,
      realistic: 1,
      hardcore: 1,
    });
    expect(UNO_CATCH_PROBABILITY).toEqual({
      casual: 0.1,
      easy: 0.4,
      realistic: 0.8,
      hardcore: 1,
    });
  });
});
