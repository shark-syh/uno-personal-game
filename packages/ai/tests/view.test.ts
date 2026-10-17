import { describe, expect, it } from 'vitest';
import { applyAction } from '@uno/game-core';
import { colorBeforeLastWild4, getAiView } from '../src/index.ts';
import { draw2, makeState, num, wild4 } from './helpers.ts';

describe('M2 AI 公开视图：信息隔离', () => {
  it('只包含自己的手牌，不泄露其他玩家手牌内容 / wild4Info', () => {
    const state = makeState(
      [[num('red', 5), wild4()], [num('green', 9), draw2('blue')], [num('yellow', 7)]],
      num('red', 3),
    );
    const opponentCards = state.players[1]!.hand.concat(state.players[2]!.hand);
    const view = getAiView(state, 0);

    expect(view.hand.map((card) => card.id)).toEqual(state.players[0]!.hand.map((card) => card.id));
    expect(view.players.map((player) => player.handCount)).toEqual([2, 2, 1]);
    expect(view.players[1]).not.toHaveProperty('hand');

    const serialized = JSON.stringify(view);
    for (const card of opponentCards) {
      expect(serialized).not.toContain(card.id);
    }
    expect(serialized).not.toContain('wild4Info');
    expect(serialized).not.toContain('wasLegal');
  });

  it('事件历史脱敏：他人摸牌不带牌面，挑战成功不带被挑战者手牌', () => {
    const state = makeState([[num('red', 5)], [num('blue', 2)]], num('red', 1));
    const opponentDraw = [num('green', 4), num('yellow', 6)];
    const ownDraw = num('red', 8);
    const challengeHand = [num('blue', 9)];

    state.players[1]!.hand.push(...opponentDraw);
    state.history = [
      { type: 'DRAW', seat: 1, count: 2, cards: opponentDraw },
      { type: 'DRAW', seat: 0, count: 1, cards: [ownDraw] },
      { type: 'CHALLENGE_SUCCESS', challenger: 1, target: 0, hand: challengeHand },
    ];

    const view = getAiView(state, 0);
    expect(view.history[0]).toEqual({ type: 'DRAW', seat: 1, count: 2, cards: [] });
    expect(view.history[1]).toEqual({ type: 'DRAW', seat: 0, count: 1, cards: [ownDraw] });
    expect(view.history[2]).toEqual({
      type: 'CHALLENGE_SUCCESS',
      challenger: 1,
      target: 0,
    });

    const serialized = JSON.stringify(view.history);
    for (const card of [...opponentDraw, ...challengeHand]) {
      expect(serialized).not.toContain(card.id);
    }
    expect(serialized).toContain(ownDraw.id);
  });

  it('本回合刚抽到的牌只对当前行动者可见', () => {
    const state = makeState([[num('red', 5)], [num('blue', 2)]], num('red', 1));
    const drawn = num('red', 7);
    state.players[0]!.hand.push(drawn);
    state.drawnThisTurn = drawn;

    expect(getAiView(state, 0).drawnThisTurn?.id).toBe(drawn.id);
    expect(getAiView(state, 1).drawnThisTurn).toBeNull();
  });

  it('视图与引擎状态解耦：修改视图不影响引擎（深拷贝关键字段）', () => {
    const state = makeState([[num('red', 5), wild4()], [num('blue', 2)]], num('red', 1));
    const originalTopFace = state.discardPile[0]!.faceCode;
    const view = getAiView(state, 0);
    view.hand[0]!.value = 99;
    view.discardPile[0]!.faceCode = 'HACK';
    view.players[1]!.handCount = 99;
    expect(state.players[0]!.hand[0]!.value).toBe(5);
    expect(state.discardPile[0]!.faceCode).toBe(originalTopFace);
    expect(state.players[1]!.hand).toHaveLength(1);
  });
});

describe('M2 AI 公开视图：+4 前颜色重建', () => {
  it('从事件历史重建 +4 打出前的颜色（挑战概率估计的公开依据）', () => {
    const state = makeState([[wild4(), num('red', 5)], [num('green', 9)]], num('red', 3));
    // 补上起手牌事件（真实对局历史从 START_CARD 开始；测试局面 history 被清空）
    state.history = [{ type: 'START_CARD', card: state.discardPile[0]! }];

    const cardId = state.players[0]!.hand[0]!.id;
    const played = applyAction(state, { type: 'PLAY_CARD', cardId, colorChoice: 'blue' });
    const view = getAiView(played.state, 1);

    // +4 打出前的颜色是红色（顶牌 R3），不是 +4 选择的蓝色
    expect(view.currentColor).toBe('blue');
    expect(colorBeforeLastWild4(view.history)).toBe('red');
  });

  it('没有 +4 历史时返回 null', () => {
    const state = makeState([[num('red', 5)], [num('blue', 2)]], num('red', 1));
    state.history = [{ type: 'START_CARD', card: state.discardPile[0]! }];
    expect(colorBeforeLastWild4(getAiView(state, 0).history)).toBeNull();
  });
});
