import { describe, expect, it } from 'vitest';
import { applyAction, getLegalActions } from '@uno/game-core';
import { sameAction } from '../src/index.ts';
import { draw2, makeState, num, wild, wild4 } from './helpers.ts';
import { candidatesFor } from './candidate-helpers.ts';

describe('M2 候选生成：正常回合', () => {
  it('候选与合法动作一一对应（Wild 展开为 4 个颜色候选）', () => {
    const state = makeState(
      [[num('red', 5), wild(), num('blue', 3)], [num('green', 9)]],
      num('red', 3),
    );
    const legal = getLegalActions(state).filter(
      (action) => action.type !== 'CALL_UNO' && action.type !== 'CATCH_UNO',
    );
    const candidates = candidatesFor(state, 0);

    expect(candidates).toHaveLength(legal.length);
    for (const candidate of candidates) {
      expect(legal.some((action) => sameAction(action, candidate.action))).toBe(true);
    }
    // 红 5（颜色匹配）+ 蓝 3（数字匹配顶牌红 3）+ Wild 四色 = 6 个出牌候选 + 抽牌
    expect(candidates.filter((candidate) => candidate.kind === 'play')).toHaveLength(6);
    expect(candidates.filter((candidate) => candidate.kind === 'draw')).toHaveLength(1);
    const wildCandidates = candidates.filter((candidate) => candidate.card?.kind === 'wild');
    expect(wildCandidates).toHaveLength(4);
    expect(new Set(wildCandidates.map((candidate) => candidate.colorChoice))).toEqual(
      new Set(['red', 'yellow', 'green', 'blue']),
    );
  });

  it('候选 id 唯一、理由非空、只引用自己的手牌、分数有限', () => {
    const state = makeState(
      [[num('red', 5), wild4(), num('blue', 3)], [num('green', 9)]],
      num('red', 3),
    );
    const ownHandIds = new Set(state.players[0]!.hand.map((card) => card.id));
    const candidates = candidatesFor(state, 0);

    expect(new Set(candidates.map((candidate) => candidate.id)).size).toBe(candidates.length);
    for (const candidate of candidates) {
      expect(candidate.note.length).toBeGreaterThan(0);
      expect(Number.isFinite(candidate.rawScore)).toBe(true);
      expect(candidate.score).toBe(0); // decide() 里才做归一化
      if (candidate.card) expect(ownHandIds.has(candidate.card.id)).toBe(true);
    }
  });
});

describe('M2 候选生成：特殊阶段', () => {
  it('choice-color：开局 Wild 只有 4 个选色候选', () => {
    const state = makeState([[num('red', 5), num('blue', 3)], [num('green', 9)]], num('red', 3));
    state.phase = 'choose-color';
    state.pendingColorChoiceSeat = 0;
    state.currentColor = null;

    const candidates = candidatesFor(state, 0);
    expect(candidates).toHaveLength(4);
    expect(candidates.every((candidate) => candidate.kind === 'choose-color')).toBe(true);
    expect(new Set(candidates.map((candidate) => candidate.colorChoice))).toEqual(
      new Set(['red', 'yellow', 'green', 'blue']),
    );
  });

  it('stack-response：只有叠牌（+2/+4）与弃权候选', () => {
    const state = makeState(
      [
        [draw2('red'), num('blue', 4)],
        [draw2('blue'), num('green', 2)],
      ],
      num('red', 3),
    );
    const played = applyAction(state, {
      type: 'PLAY_CARD',
      cardId: state.players[0]!.hand[0]!.id,
    });
    expect(played.state.phase).toBe('stack-response');
    expect(played.state.currentSeat).toBe(1);

    const candidates = candidatesFor(played.state, 1);
    expect(new Set(candidates.map((candidate) => candidate.kind))).toEqual(
      new Set(['stack-play', 'stack-decline']),
    );
    expect(candidates.filter((candidate) => candidate.kind === 'stack-play')).toHaveLength(1);
    expect(candidates.filter((candidate) => candidate.kind === 'stack-decline')).toHaveLength(1);
  });

  it('challenge-decide：只有「挑战 / 接受摸 4」两个候选', () => {
    const state = makeState(
      [
        [wild4(), num('red', 5)],
        [num('green', 9), num('blue', 2)],
      ],
      num('red', 3),
    );
    state.history = [{ type: 'START_CARD', card: state.discardPile[0]! }];
    const played = applyAction(state, {
      type: 'PLAY_CARD',
      cardId: state.players[0]!.hand[0]!.id,
      colorChoice: 'blue',
    });
    const declined = applyAction(played.state, { type: 'STACK_DECLINE' });
    expect(declined.state.phase).toBe('challenge-decide');

    const candidates = candidatesFor(declined.state, 1);
    expect(candidates).toHaveLength(2);
    expect(new Set(candidates.map((candidate) => candidate.kind))).toEqual(
      new Set(['challenge', 'decline-challenge']),
    );
  });

  it('uno-window：过滤掉属于人类 UI 的 CALL_UNO / CATCH_UNO 窗口动作', () => {
    const state = makeState(
      [
        [num('red', 5), num('blue', 2)],
        [num('green', 9), num('yellow', 4)],
      ],
      num('red', 3),
    );
    state.phase = 'uno-window';
    state.currentSeat = 0;
    state.unoWindow = {
      seat: 1,
      canCall: false,
      canCatch: [1],
      pendingPhase: 'await-play',
    };
    const legal = getLegalActions(state);
    expect(legal.some((action) => action.type === 'CATCH_UNO')).toBe(true);

    const candidates = candidatesFor(state, 0);
    expect(
      candidates.every(
        (candidate) =>
          candidate.action.type !== 'CALL_UNO' && candidate.action.type !== 'CATCH_UNO',
      ),
    ).toBe(true);
    expect(candidates.some((candidate) => candidate.kind === 'play')).toBe(true);
  });

  it('对局已结束 / 无合法动作时抛错', () => {
    const state = makeState([[num('red', 5)], [num('blue', 2)]], num('red', 3));
    state.phase = 'round-end';
    expect(() => candidatesFor(state, 0)).toThrow();
  });
});
