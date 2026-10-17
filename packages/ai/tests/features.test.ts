import { describe, expect, it } from 'vitest';
import { applyAction } from '@uno/game-core';
import type { Difficulty, GameState } from '@uno/game-core';
import {
  buildMemory,
  getAiView,
  getDifficultyProfile,
  estimateChallengeIllegalProbability,
} from '../src/index.ts';
import type { AiView } from '../src/index.ts';
import { draw2, makeState, num, wild, wild4 } from './helpers.ts';
import { candidatesFor } from './candidate-helpers.ts';

function featureOf(
  state: GameState,
  seat: number,
  pick: (candidate: ReturnType<typeof candidatesFor>[number]) => boolean,
  difficulty: Difficulty = 'realistic',
) {
  const candidate = candidatesFor(state, seat, difficulty).find(pick);
  if (!candidate) throw new Error('测试候选不存在');
  return candidate.features;
}

describe('M2 特征提取：出牌价值', () => {
  it('手牌越多，此刻打出万能牌的浪费代价越大', () => {
    const bigHand = makeState(
      [
        [
          wild(),
          num('red', 5),
          num('red', 6),
          num('red', 7),
          num('blue', 2),
          num('blue', 3),
          num('green', 4),
        ],
        [num('green', 9)],
      ],
      num('red', 3),
    );
    const smallHand = makeState([[wild(), num('red', 5)], [num('green', 9)]], num('red', 3));

    const bigWildCost = featureOf(
      bigHand,
      0,
      (candidate) => candidate.card?.kind === 'wild',
    ).wildCost;
    const smallWildCost = featureOf(
      smallHand,
      0,
      (candidate) => candidate.card?.kind === 'wild',
    ).wildCost;
    expect(bigWildCost).toBeGreaterThan(0.5);
    expect(smallWildCost).toBe(0);
  });

  it('出牌后剩多少可出的牌：打红的牌保留红 7 的收益高于打蓝 3 把牌打死', () => {
    const state = makeState(
      [[num('red', 5), num('red', 7), num('blue', 3), num('green', 9)], [num('green', 2)]],
      num('red', 3),
    );
    const candidates = candidatesFor(state, 0);
    const red5 = candidates.find(
      (candidate) => candidate.kind === 'play' && candidate.card?.value === 5,
    )!;
    const blue3 = candidates.find(
      (candidate) => candidate.kind === 'play' && candidate.card?.value === 3,
    )!;
    expect(red5.features.followUp).toBeGreaterThan(blue3.features.followUp);
    expect(blue3.features.followUp).toBe(0);
  });

  it('终局特征：最后一张牌打出后 endgame 最高', () => {
    const state = makeState([[num('red', 5)], [num('green', 2), num('blue', 4)]], num('red', 3));
    const features = featureOf(
      state,
      0,
      (candidate) => candidate.kind === 'play' && candidate.card?.kind === 'number',
    );
    expect(features.handReduction).toBe(1);
    expect(features.endgame).toBe(1);
    expect(features.followUp).toBe(1);
  });
});

describe('M2 特征提取：风险与颜色', () => {
  it('手持当前颜色牌仍出 +4 时记诈唬风险；没有同色牌则无风险', () => {
    const bluffState = makeState(
      [[wild4(), num('red', 5), num('blue', 7)], [num('green', 2)]],
      num('red', 3),
    );
    const safeState = makeState(
      [[wild4(), num('blue', 5), num('green', 7)], [num('green', 2)]],
      num('red', 3),
    );
    const bluffRisk = featureOf(
      bluffState,
      0,
      (candidate) => candidate.card?.kind === 'wild4',
    ).bluffRisk;
    const safeRisk = featureOf(
      safeState,
      0,
      (candidate) => candidate.card?.kind === 'wild4',
    ).bluffRisk;
    expect(bluffRisk).toBeGreaterThan(0);
    expect(safeRisk).toBe(0);
  });

  it('叠牌链中打出的 +4 不开放挑战，因此不计诈唬风险', () => {
    const state = makeState(
      [
        [draw2('red'), num('blue', 4)],
        [wild4(), num('red', 5)],
        [num('green', 2), num('green', 3)],
      ],
      num('red', 3),
    );
    const played = applyAction(state, {
      type: 'PLAY_CARD',
      cardId: state.players[0]!.hand[0]!.id,
    });
    expect(played.state.phase).toBe('stack-response');

    const candidates = candidatesFor(played.state, 1);
    const stackWild4 = candidates.find(
      (candidate) => candidate.kind === 'stack-play' && candidate.card?.kind === 'wild4',
    )!;
    expect(stackWild4.features.bluffRisk).toBe(0);
    expect(stackWild4.features.stackGain).toBeGreaterThan(0);
  });

  it('万能牌选色：下家越可能缺的颜色，nextPlayerWeakColor 越高', () => {
    const state = makeState([[wild(), num('red', 5)], [num('blue', 2)]], num('red', 3), {
      discardPile: [
        num('red', 3),
        ...Array.from({ length: 20 }, (_, index) => num('green', index % 10)),
      ],
    });
    const candidates = candidatesFor(state, 0, 'realistic');
    const redChoice = candidates.find(
      (candidate) => candidate.card?.kind === 'wild' && candidate.colorChoice === 'red',
    )!;
    const greenChoice = candidates.find(
      (candidate) => candidate.card?.kind === 'wild' && candidate.colorChoice === 'green',
    )!;
    // 绿色几乎都出完了（剩余少）→ 下家更可能缺绿
    expect(greenChoice.features.nextPlayerWeakColor).toBeGreaterThan(
      redChoice.features.nextPlayerWeakColor,
    );
  });

  it('所有特征值都在 0~1 区间', () => {
    const state = makeState(
      [[num('red', 5), wild(), wild4(), draw2('red')], [num('green', 9)]],
      num('red', 3),
    );
    for (const candidate of candidatesFor(state, 0)) {
      for (const value of Object.values(candidate.features)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('M2 特征提取：挑战概率估计', () => {
  function challengeView(extraSeenRed: number): AiView {
    const state = makeState(
      [
        [wild4(), num('red', 5)],
        [num('green', 9), num('blue', 2)],
      ],
      num('red', 3),
      {
        discardPile: [
          num('red', 3),
          ...Array.from({ length: extraSeenRed }, (_, index) => num('red', index % 10)),
        ],
      },
    );
    state.history = [{ type: 'START_CARD', card: state.discardPile[0]! }];
    const played = applyAction(state, {
      type: 'PLAY_CARD',
      cardId: state.players[0]!.hand[0]!.id,
      colorChoice: 'blue',
    });
    const declined = applyAction(played.state, { type: 'STACK_DECLINE' });
    return getAiView(declined.state, 1);
  }

  it('已见红牌越多（剩余越少）→ 估计对手违规概率越低', () => {
    const profile = getDifficultyProfile('realistic');
    const highView = challengeView(0);
    const lowView = challengeView(20);
    const high = estimateChallengeIllegalProbability(highView, buildMemory(highView), profile);
    const low = estimateChallengeIllegalProbability(lowView, buildMemory(lowView), profile);
    expect(high).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(0.4);
    expect(low).toBeLessThan(0.4);
  });

  it('休闲档不记牌，挑战估计恒为固定先验', () => {
    const profile = getDifficultyProfile('casual');
    const view = challengeView(20);
    expect(estimateChallengeIllegalProbability(view, buildMemory(view), profile)).toBeCloseTo(
      profile.challenge.priorIllegal,
      5,
    );
  });
});
