import { describe, expect, it } from 'vitest';
import { applyAction, getLegalActions } from '@uno/game-core';
import type { Difficulty, GameState } from '@uno/game-core';
import { decide, sameAction } from '../src/index.ts';
import { decisionRng, draw2, makeChallengeState, makeState, num, wild4 } from './helpers.ts';

function decideFor(
  state: GameState,
  seat: number,
  difficulty: Difficulty = 'realistic',
  seed = 'decide-test',
) {
  return decide(state, seat, { difficulty, rng: decisionRng(seed) });
}

function expectLegalChoice(state: GameState, seat: number, difficulty: Difficulty, seed: string) {
  const decision = decideFor(state, seat, difficulty, seed);
  const legal = getLegalActions(state);
  expect(legal.some((action) => sameAction(action, decision.action))).toBe(true);
  return decision;
}

describe('M2 决策：合法性与确定性', () => {
  it('四档难度在正常回合都只从合法动作里选', () => {
    const state = makeState(
      [
        [num('red', 5), wild4(), num('blue', 3)],
        [num('green', 9), num('yellow', 2)],
      ],
      num('red', 3),
    );
    for (const difficulty of ['casual', 'easy', 'realistic', 'hardcore'] as const) {
      for (let seed = 0; seed < 5; seed += 1) {
        expectLegalChoice(state, 0, difficulty, `legal-${difficulty}-${seed}`);
      }
    }
  });

  it('叠牌响应 / 选色 / 挑战窗口同样只选合法动作', () => {
    const stackState = makeState(
      [
        [draw2('red'), num('blue', 4)],
        [draw2('blue'), num('green', 2)],
      ],
      num('red', 3),
    );
    const played = applyAction(stackState, {
      type: 'PLAY_CARD',
      cardId: stackState.players[0]!.hand[0]!.id,
    });
    const challengeState = makeChallengeState();
    const colorState = makeState(
      [[num('red', 5), num('blue', 3)], [num('green', 9)]],
      num('red', 3),
    );
    colorState.phase = 'choose-color';
    colorState.pendingColorChoiceSeat = 0;
    colorState.currentColor = null;

    for (const difficulty of ['casual', 'easy', 'realistic', 'hardcore'] as const) {
      expectLegalChoice(played.state, 1, difficulty, `stack-${difficulty}`);
      expectLegalChoice(challengeState, 1, difficulty, `challenge-${difficulty}`);
      expectLegalChoice(colorState, 0, difficulty, `color-${difficulty}`);
    }
  });

  it('硬核档零噪声零失误：相同局面必做相同决策', () => {
    const state = makeState(
      [
        [num('red', 5), num('blue', 3), num('red', 7)],
        [num('green', 9), num('yellow', 2)],
      ],
      num('red', 3),
    );
    const first = decideFor(state, 0, 'hardcore', 'det-a');
    const second = decideFor(state, 0, 'hardcore', 'det-b');
    expect(first.action).toEqual(second.action);
    expect(first.candidates.map((candidate) => candidate.id)).toEqual(
      second.candidates.map((candidate) => candidate.id),
    );
  });

  it('同样的随机源 + 同样的局面 → 同样的决策（真实档）', () => {
    const state = makeState(
      [
        [num('red', 5), num('blue', 3), num('green', 7)],
        [num('green', 9), num('yellow', 2)],
      ],
      num('red', 3),
    );
    const first = decideFor(state, 0, 'realistic', 'same-rng');
    const second = decideFor(state, 0, 'realistic', 'same-rng');
    expect(first.action).toEqual(second.action);
    expect(first.reason).toBe(second.reason);
  });

  it('非当前行动者 / 已结束对局不能决策', () => {
    const state = makeState([[num('red', 5)], [num('blue', 2)]], num('red', 3));
    expect(() => decideFor(state, 1)).toThrow();
    const ended = makeState([[num('red', 5)], [num('blue', 2)]], num('red', 3));
    ended.phase = 'round-end';
    expect(() => decideFor(ended, 0)).toThrow();
  });
});

describe('M2 决策：信息隔离（不偷看其他玩家手牌）', () => {
  it('只交换其他玩家手牌内容（数量不变）不影响决策', () => {
    const stateA = makeState(
      [
        [num('red', 5), wild4(), num('blue', 3)],
        [num('green', 9), num('yellow', 2)],
        [num('blue', 7), num('red', 4)],
      ],
      num('red', 3),
    );
    // 用克隆保证自己手牌 id 完全一致，只交换座位 1/2 的手牌内容
    const stateB = structuredClone(stateA);
    const hand1 = stateB.players[1]!.hand;
    stateB.players[1]!.hand = stateB.players[2]!.hand;
    stateB.players[2]!.hand = hand1;

    for (const difficulty of ['easy', 'realistic', 'hardcore'] as const) {
      const decisionA = decideFor(stateA, 0, difficulty, 'isolation');
      const decisionB = decideFor(stateB, 0, difficulty, 'isolation');
      expect(decisionA.action).toEqual(decisionB.action);
      expect(decisionA.candidates.map((candidate) => candidate.id)).toEqual(
        decisionB.candidates.map((candidate) => candidate.id),
      );
    }
  });

  it('决策输出（reason/notes）不包含其他玩家手牌信息', () => {
    const state = makeState(
      [
        [num('red', 5), wild4(), num('blue', 3)],
        [num('green', 9), num('yellow', 2)],
      ],
      num('red', 3),
    );
    const decision = decideFor(state, 0, 'hardcore');
    const serialized = JSON.stringify(decision);
    for (const card of state.players[1]!.hand) {
      expect(serialized).not.toContain(card.id);
    }
  });
});

describe('M2 决策：策略行为', () => {
  it('有牌可出时，真实/骨灰级不会无故抽牌', () => {
    const state = makeState(
      [
        [num('red', 5), num('blue', 9), num('red', 7)],
        [num('green', 2), num('yellow', 4)],
      ],
      num('red', 3),
    );
    for (const difficulty of ['realistic', 'hardcore'] as const) {
      for (let seed = 0; seed < 20; seed += 1) {
        const decision = decideFor(state, 0, difficulty, `play-${seed}`);
        expect(decision.action.type).not.toBe('DRAW');
      }
    }
  });

  it('挑战窗口：估计成功率高时真实/骨灰级选择挑战，低时选择接受', () => {
    const high = makeChallengeState(0);
    const low = makeChallengeState(20);
    for (const difficulty of ['easy', 'realistic', 'hardcore'] as const) {
      expect(decideFor(high, 1, difficulty).action.type).toBe('CHALLENGE_W4');
      expect(decideFor(low, 1, difficulty).action.type).toBe('DECLINE_CHALLENGE');
    }
  });

  it('休闲档乱挑战：约 10% 概率挑战', () => {
    const state = makeChallengeState(0);
    let challenges = 0;
    for (let seed = 0; seed < 300; seed += 1) {
      if (decideFor(state, 1, 'casual', `casual-${seed}`).action.type === 'CHALLENGE_W4') {
        challenges += 1;
      }
    }
    expect(challenges).toBeGreaterThan(5);
    expect(challenges).toBeLessThan(60);
  });

  it('休闲档会犯错：非最优候选也会被选中；骨灰级永远选最优', () => {
    const state = makeState(
      [
        [num('red', 5), num('blue', 3), num('red', 7), num('green', 9), num('yellow', 2)],
        [num('green', 2)],
      ],
      num('red', 3),
    );
    let casualNonBest = 0;
    for (let seed = 0; seed < 200; seed += 1) {
      const decision = decideFor(state, 0, 'casual', `mistake-${seed}`);
      if (decision.candidate.id !== decision.candidates[0]!.id) casualNonBest += 1;
    }
    expect(casualNonBest).toBeGreaterThan(5);

    for (let seed = 0; seed < 20; seed += 1) {
      const decision = decideFor(state, 0, 'hardcore', `mistake-hc-${seed}`);
      expect(decision.candidate.id).toBe(decision.candidates[0]!.id);
    }
  });

  it('候选归一化分数都在 0~1，且 reason 非空', () => {
    const state = makeState(
      [
        [num('red', 5), wild4(), num('blue', 3)],
        [num('green', 9), num('yellow', 2)],
      ],
      num('red', 3),
    );
    const decision = decideFor(state, 0, 'realistic');
    expect(decision.reason.length).toBeGreaterThan(0);
    expect(decision.source).toBe('local');
    for (const candidate of decision.candidates) {
      expect(candidate.score).toBeGreaterThanOrEqual(0);
      expect(candidate.score).toBeLessThanOrEqual(1);
    }
    expect(decision.candidates[0]!.score).toBe(1);
  });
});
