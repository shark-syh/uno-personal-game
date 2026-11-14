/**
 * M3 联机：mode 透传、友尽新动作协议、按座位视图隔离、AI 补位不卡死。
 * 不依赖网络，直接跑 RoomManager + 协议 + 本地 AI 决策。
 */
import { describe, expect, it } from 'vitest';
import { decide } from '@uno/ai';
import { countCards, createInitialGame, createRng } from '@uno/game-core';
import type { GameState } from '@uno/game-core';
import { isPlayableMode, parseClientMessage, parseEngineAction } from '../src/net/protocol.ts';
import { RoomManager, toRoomSnapshot } from '../src/net/rooms.ts';

function makeRoomWithPlayers(manager: RoomManager, names: string[]) {
  const { room } = manager.createRoom(names[0]!);
  for (const name of names.slice(1)) manager.joinRoom(room.code, name);
  return room;
}

/**
 * 精确取出视图序列化后的卡牌 id。
 * 不能直接用 `not.toContain(card.id)`：友尽牌表里 `one-yellow#0` 是
 * `skip-everyone-yellow#0` 的子串，子串匹配会误报成"泄露了别人的手牌"。
 */
function idsIn(value: unknown): string[] {
  return [...JSON.stringify(value).matchAll(/"id":"([^"]+)"/g)].map((match) => match[1]!);
}

describe('M3 协议：start-game 透传 mode', () => {
  it('不传 mode 保持 classic；mercy 合法；flip / 非法值一律 BAD_MESSAGE', () => {
    expect(parseClientMessage(JSON.stringify({ type: 'start-game', aiCount: 1 }))).toEqual({
      type: 'start-game',
      aiCount: 1,
    });
    expect(
      parseClientMessage(JSON.stringify({ type: 'start-game', aiCount: 0, mode: 'mercy' })),
    ).toEqual({ type: 'start-game', aiCount: 0, mode: 'mercy' });
    expect(parseClientMessage(JSON.stringify({ type: 'start-game', mode: 'flip' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: 'start-game', mode: 'whatever' }))).toBeNull();
    expect(isPlayableMode('classic')).toBe(true);
    expect(isPlayableMode('mercy')).toBe(true);
    expect(isPlayableMode('flip')).toBe(false);
  });

  it('M2 两个新动作可被解析；非法座位 / 颜色 / 未知动作被拒', () => {
    expect(
      parseEngineAction({ type: 'SWAP_HANDS', targetSeat: 2 }),
    ).toEqual({ type: 'SWAP_HANDS', targetSeat: 2 });
    expect(
      parseEngineAction({ type: 'CHOOSE_ROULETTE_COLOR', color: 'green' }),
    ).toEqual({ type: 'CHOOSE_ROULETTE_COLOR', color: 'green' });
    expect(parseEngineAction({ type: 'SWAP_HANDS', targetSeat: -1 })).toBeNull();
    expect(parseEngineAction({ type: 'SWAP_HANDS', targetSeat: 10 })).toBeNull();
    expect(parseEngineAction({ type: 'SWAP_HANDS', targetSeat: '2' })).toBeNull();
    expect(parseEngineAction({ type: 'CHOOSE_ROULETTE_COLOR', color: 'purple' })).toBeNull();
    expect(parseEngineAction({ type: 'NOT_AN_ACTION' })).toBeNull();

    const message = parseClientMessage(
      JSON.stringify({ type: 'action', action: { type: 'SWAP_HANDS', targetSeat: 1 } }),
    );
    expect(message).toEqual({ type: 'action', action: { type: 'SWAP_HANDS', targetSeat: 1 } });
  });
});

describe('M3 房间：mode 透传到引擎配置与房间快照', () => {
  it('startGame(..., mercy) 建 168 张友尽局，config 自动 official / 关挑战', () => {
    const manager = new RoomManager();
    const room = makeRoomWithPlayers(manager, ['A', 'B', 'C']);
    expect(room.mode).toBe('classic');
    expect(toRoomSnapshot(room).mode).toBe('classic');

    const state = manager.startGame(room, 0, 0, 'mercy');
    expect(room.mode).toBe('mercy');
    expect(toRoomSnapshot(room).mode).toBe('mercy');
    expect(state.config.mode).toBe('mercy');
    expect(state.config.stacking).toBe('official');
    expect(state.config.challengeWild4).toBe(false);
    expect(countCards(state)).toBe(168);
  });

  it('不传 mode 沿用 classic（108 张）；非法 mode 明确抛 BAD_MESSAGE', () => {
    const manager = new RoomManager();
    const room = makeRoomWithPlayers(manager, ['A', 'B']);
    const state = manager.startGame(room, 0);
    expect(state.config.mode).toBe('classic');
    expect(countCards(state)).toBe(108);

    const flipRoom = makeRoomWithPlayers(manager, ['C', 'D']);
    expect(() => manager.startGame(flipRoom, 0, 0, 'flip')).toThrowError(
      expect.objectContaining({ code: 'BAD_MESSAGE' }) as Error,
    );
    expect(flipRoom.mode).toBe('classic');
    expect(flipRoom.status).toBe('lobby');
  });

  it('rematch 沿用房间模式，不回退到 classic', () => {
    const manager = new RoomManager();
    const room = makeRoomWithPlayers(manager, ['A', 'B']);
    manager.startGame(room, 0, 1, 'mercy');
    room.status = 'ended';
    const state = manager.rematch(room, 0);
    expect(state.config.mode).toBe('mercy');
    expect(countCards(state)).toBe(168);
    expect(toRoomSnapshot(room).mode).toBe('mercy');
  });

  it('getSeatViews 按座位脱敏：每个视图带 mode=mercy，且不含其他座位手牌牌面', () => {
    const manager = new RoomManager();
    const room = makeRoomWithPlayers(manager, ['A', 'B']);
    const state = manager.startGame(room, 0, 0, 'mercy');
    const views = manager.getSeatViews(room);
    expect(views).toHaveLength(2);
    for (const { seat, view } of views) {
      expect(view.mode).toBe('mercy');
      expect(view.mercy).not.toBeNull();
      expect(view.players.every((player) => typeof player.eliminated === 'boolean')).toBe(true);
      expect(view.human.hand.map((card) => card.id)).toEqual(
        state.players[seat]!.hand.map((card) => card.id),
      );
      const visibleIds = idsIn(view);
      for (const other of state.players.filter((player) => player.seat !== seat)) {
        for (const card of other.hand) {
          expect(visibleIds).not.toContain(card.id);
        }
      }
    }
  });
});

describe('M3 服务端权威：友尽新动作可从联机链路执行', () => {
  it('7 换手：座位权限校验放行发起者，非发起者被拒', () => {
    const manager = new RoomManager();
    const room = makeRoomWithPlayers(manager, ['A', 'B', 'C']);
    const state = manager.startGame(room, 0, 0, 'mercy');
    state.phase = 'choose-swap-target';
    state.currentSeat = 0;
    state.pendingSwap = { initiatorSeat: 0 };

    expect(() =>
      manager.applyPlayerAction(room, 1, { type: 'SWAP_HANDS', targetSeat: 2 }),
    ).toThrowError(expect.objectContaining({ code: 'NOT_YOUR_TURN' }) as Error);

    const applied = manager.applyPlayerAction(room, 0, { type: 'SWAP_HANDS', targetSeat: 1 });
    expect(applied.phase).not.toBe('choose-swap-target');
    expect(applied.pendingSwap).toBeNull();
  });

  it('颜色轮盘：下家选色动作放行并结算，非选色者被拒', () => {
    const manager = new RoomManager();
    const room = makeRoomWithPlayers(manager, ['A', 'B', 'C']);
    const state = manager.startGame(room, 0, 0, 'mercy');
    state.phase = 'choose-roulette-color';
    state.currentSeat = 1;
    state.roulette = { initiatorSeat: 0, chooserSeat: 1, targetColor: null };

    expect(() =>
      manager.applyPlayerAction(room, 0, { type: 'CHOOSE_ROULETTE_COLOR', color: 'red' }),
    ).toThrowError(expect.objectContaining({ code: 'NOT_YOUR_TURN' }) as Error);

    const applied = manager.applyPlayerAction(room, 1, {
      type: 'CHOOSE_ROULETTE_COLOR',
      color: 'red',
    });
    expect(applied.roulette).toBeNull();
    expect(applied.phase).toBe('await-play');
    expect(applied.currentColor).toBe('red');
  });
});

describe('M3 AI 补位：友尽新阶段不抛错、不卡死对局', () => {
  function mercyState(): GameState {
    return createInitialGame({
      mode: 'mercy',
      playerCount: 3,
      seed: 'm3-ai-mercy',
      names: ['A', 'B', 'C'],
      autoCallUno: true,
    });
  }

  it('choose-swap-target 阶段产出 SWAP_HANDS 候选', () => {
    const state = mercyState();
    state.phase = 'choose-swap-target';
    state.currentSeat = 0;
    state.pendingSwap = { initiatorSeat: 0 };
    const decision = decide(state, 0, {
      difficulty: 'realistic',
      rng: createRng('m3-ai-swap'),
    });
    expect(decision.action.type).toBe('SWAP_HANDS');
    expect(decision.candidates.length).toBeGreaterThan(0);
    expect(new Set(decision.candidates.map((item) => item.id)).size).toBe(
      decision.candidates.length,
    );
    expect(decision.candidate.note).toContain('换手');
  });

  it('choose-roulette-color 阶段产出 4 个颜色候选且 id 唯一', () => {
    const state = mercyState();
    state.phase = 'choose-roulette-color';
    state.currentSeat = 1;
    state.roulette = { initiatorSeat: 0, chooserSeat: 1, targetColor: null };
    const decision = decide(state, 1, {
      difficulty: 'hardcore',
      rng: createRng('m3-ai-roulette'),
    });
    expect(decision.action.type).toBe('CHOOSE_ROULETTE_COLOR');
    expect(decision.candidates).toHaveLength(4);
    expect(new Set(decision.candidates.map((item) => item.id)).size).toBe(4);
    expect(decision.candidate.note).toContain('轮盘');
  });
});
