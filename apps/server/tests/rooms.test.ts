/**
 * M8-01/M8-02 房间与服务端权威循环单元测试（不依赖网络）。
 * 重点：房间生命周期、座位权限校验、按座位视图隔离。
 */
import { describe, expect, it } from 'vitest';
import type { Card, GameState } from '@uno/game-core';
import { RoomError, RoomManager } from '../src/net/rooms.ts';

function makeRoomWithPlayers(manager: RoomManager, names: string[]) {
  const { room } = manager.createRoom(names[0]!);
  for (const name of names.slice(1)) manager.joinRoom(room.code, name);
  return room;
}

function startedState(room: { state: GameState | null }): GameState {
  if (!room.state) throw new Error('对局未开始');
  return room.state;
}

describe('房间生命周期', () => {
  it('创建房间：创建者坐 0 号位并成为房主', () => {
    const manager = new RoomManager();
    const { room, player } = manager.createRoom('小明');
    expect(room.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(room.status).toBe('lobby');
    expect(room.hostSeat).toBe(0);
    expect(player.seat).toBe(0);
    expect(player.token).toHaveLength(32);
  });

  it('加入房间按顺序分配座位；房间码不存在 / 对局已开始会报错', () => {
    const manager = new RoomManager();
    const { room } = manager.createRoom('A');
    const joined = manager.joinRoom(room.code, 'B');
    expect(joined.player.seat).toBe(1);
    expect(() => manager.joinRoom('ZZZZZZ', 'C')).toThrowError(RoomError);
    manager.startGame(room, 0);
    expect(() => manager.joinRoom(room.code, 'C')).toThrowError(
      expect.objectContaining({ code: 'ROOM_ALREADY_PLAYING' }) as Error,
    );
  });

  it('开始游戏：只有房主能开始、至少 2 人、开始后所有座位都是人类', () => {
    const manager = new RoomManager();
    const solo = manager.createRoom('A').room;
    expect(() => manager.startGame(solo, 0)).toThrowError(
      expect.objectContaining({ code: 'NOT_ENOUGH_PLAYERS' }) as Error,
    );

    const room = makeRoomWithPlayers(manager, ['A', 'B', 'C']);
    expect(() => manager.startGame(room, 1)).toThrowError(
      expect.objectContaining({ code: 'NOT_HOST' }) as Error,
    );
    const state = manager.startGame(room, 0);
    expect(room.status).toBe('playing');
    expect(state.players).toHaveLength(3);
    expect(state.players.map((player) => player.name)).toEqual(['A', 'B', 'C']);
    expect(state.players.every((player) => player.isHuman)).toBe(true);
    // 起手效果（如开局翻 +2）由首位玩家承受，其手牌会多于 7 张
    expect(state.players.every((player) => player.hand.length >= 7)).toBe(true);
  });

  it('大厅阶段离开：移除座位并重排；最后一人离开销毁房间', () => {
    const manager = new RoomManager();
    const room = makeRoomWithPlayers(manager, ['A', 'B', 'C']);
    manager.leaveRoom(room, 1);
    expect(room.players.map((player) => player.name)).toEqual(['A', 'C']);
    expect(room.players.map((player) => player.seat)).toEqual([0, 1]);
    expect(room.hostSeat).toBe(0);
    manager.leaveRoom(room, 0);
    expect(room.hostSeat).toBe(0);
    const result = manager.leaveRoom(room, 0);
    expect(result.closed).toBe(true);
    expect(() => manager.getRoom(room.code)).toThrowError(
      expect.objectContaining({ code: 'ROOM_NOT_FOUND' }) as Error,
    );
  });
});

describe('服务端权威动作校验', () => {
  it('非当前行动座位的动作一律 NOT_YOUR_TURN', () => {
    const manager = new RoomManager();
    const room = makeRoomWithPlayers(manager, ['A', 'B']);
    const state = manager.startGame(room, 0);
    const other = state.currentSeat === 0 ? 1 : 0;
    expect(() => manager.applyPlayerAction(room, other, { type: 'DRAW' })).toThrowError(
      expect.objectContaining({ code: 'NOT_YOUR_TURN' }) as Error,
    );
  });

  it('UNO 喊/抓按窗口状态校验座位：窗口外喊 UNO、窗口内无关座位抓人都会被拒', () => {
    const manager = new RoomManager();
    const room = makeRoomWithPlayers(manager, ['A', 'B', 'C']);
    const state = manager.startGame(room, 0);

    // 非 uno-window 阶段喊 UNO → 拒绝
    expect(() => manager.applyPlayerAction(room, 0, { type: 'CALL_UNO' })).toThrowError(
      expect.objectContaining({ code: 'NOT_YOUR_TURN' }) as Error,
    );

    // 构造 uno-window（按引擎真实形状：canCatch=[窗口主人]，语义是「可被抓的目标」）
    state.phase = 'uno-window';
    state.unoWindow = { seat: 1, canCatch: [1], canCall: true, pendingPhase: 'await-play' };
    // 窗口外座位喊 UNO → 拒绝
    expect(() => manager.applyPlayerAction(room, 0, { type: 'CALL_UNO' })).toThrowError(
      expect.objectContaining({ code: 'NOT_YOUR_TURN' }) as Error,
    );
    // 窗口主人抓自己 → 拒绝
    expect(() =>
      manager.applyPlayerAction(room, 1, { type: 'CATCH_UNO', targetSeat: 1 }),
    ).toThrowError(expect.objectContaining({ code: 'NOT_YOUR_TURN' }) as Error);
    // 抓错目标 → 拒绝
    expect(() =>
      manager.applyPlayerAction(room, 0, { type: 'CATCH_UNO', targetSeat: 2 }),
    ).toThrowError(expect.objectContaining({ code: 'NOT_YOUR_TURN' }) as Error);
    // 其他人抓窗口主人 → 允许（引擎裁决并罚牌）
    const before = state.players[1]!.hand.length;
    manager.applyPlayerAction(room, 0, { type: 'CATCH_UNO', targetSeat: 1 });
    expect(startedState(room).players[1]!.hand.length).toBeGreaterThan(before);
  });

  it('引擎拒绝的非法动作映射为 ILLEGAL_ACTION，且状态不被修改', () => {
    const manager = new RoomManager();
    const room = makeRoomWithPlayers(manager, ['A', 'B']);
    const state = manager.startGame(room, 0);
    const before = room.state;
    const current = state.currentSeat;
    expect(() =>
      manager.applyPlayerAction(room, current, { type: 'PLAY_CARD', cardId: 'ZZ#9' }),
    ).toThrowError(expect.objectContaining({ code: 'ILLEGAL_ACTION' }) as Error);
    expect(room.state).toBe(before);
  });
});

describe('按座位视图隔离', () => {
  it('每个座位只看到自己的手牌；他人只有 handCount，没有手牌字段', () => {
    const manager = new RoomManager();
    const room = makeRoomWithPlayers(manager, ['A', 'B']);
    manager.startGame(room, 0);
    const views = manager.getSeatViews(room);
    expect(views).toHaveLength(2);
    const state = startedState(room);
    for (const { seat, view } of views) {
      expect(view.human.seat).toBe(seat);
      expect(view.human.hand.map((card) => card.id)).toEqual(
        state.players[seat]!.hand.map((card) => card.id),
      );
      const raw = JSON.stringify(view);
      // 他人手牌的 id 不得出现在本座位视图里
      for (const player of state.players) {
        if (player.seat === seat) continue;
        for (const card of player.hand) expect(raw).not.toContain(card.id);
      }
      for (const player of view.players) {
        expect(player).not.toHaveProperty('hand');
        expect(typeof player.handCount).toBe('number');
      }
    }
  });

  it('房间内改名：更新玩家名并做长度清洗', () => {
    const manager = new RoomManager();
    const room = makeRoomWithPlayers(manager, ['A', 'B']);
    manager.renamePlayer(room, 1, '  阿明  ');
    expect(room.players[1]!.name).toBe('阿明');
    // 超长名字截断到 MAX_NAME_LENGTH（12）
    manager.renamePlayer(room, 1, '一二三四五六七八九十一十二十三十四');
    expect(room.players[1]!.name).toHaveLength(12);
    // 空名字拒绝且不改原名
    expect(() => manager.renamePlayer(room, 1, '   ')).toThrowError(
      expect.objectContaining({ code: 'BAD_MESSAGE' }) as Error,
    );
    expect(room.players[1]!.name).toHaveLength(12);
  });

  it('对局中改名：GameState 的玩家名同步刷新', () => {
    const manager = new RoomManager();
    const room = makeRoomWithPlayers(manager, ['A', 'B']);
    manager.startGame(room, 0);
    manager.renamePlayer(room, 1, '阿明');
    expect(startedState(room).players[1]!.name).toBe('阿明');
  });

  it('事件按座位脱敏：他人摸牌只带 count 不带牌面，本人保留牌面', () => {
    const manager = new RoomManager();
    const room = makeRoomWithPlayers(manager, ['A', 'B']);
    const state = manager.startGame(room, 0);
    const drawn: Card = { id: 'R7#0', kind: 'number', color: 'red', value: 7, faceCode: 'R7' };
    state.events = [{ type: 'DRAW', seat: 0, count: 1, cards: [drawn] }];
    const views = new Map(manager.getSeatViews(room).map((entry) => [entry.seat, entry.view]));
    const own = views.get(0)!.events[0]!;
    const other = views.get(1)!.events[0]!;
    expect(own).toMatchObject({ type: 'DRAW', seat: 0, count: 1, cards: [drawn] });
    expect(other).toMatchObject({ type: 'DRAW', seat: 0, count: 1, cards: [] });
  });
});

describe('M8-04 AI 补位', () => {
  it('真人 + AI 开局：真人座位 isHuman=true 且用房间名，AI 座位 isHuman=false', () => {
    const manager = new RoomManager();
    const room = manager.createRoom('房主').room;
    expect(() => manager.startGame(room, 0)).toThrowError(
      expect.objectContaining({ code: 'NOT_ENOUGH_PLAYERS' }) as Error,
    );
    const state = manager.startGame(room, 0, 2);
    expect(state.players).toHaveLength(3);
    expect(state.players[0]!.isHuman).toBe(true);
    expect(state.players[0]!.name).toBe('房主');
    expect(state.players[1]!.isHuman).toBe(false);
    expect(state.players[2]!.isHuman).toBe(false);
    expect(room.aiRng).not.toBeNull();
  });

  it('真人 + AI 超过 10 人会被拒绝', () => {
    const manager = new RoomManager();
    const room = makeRoomWithPlayers(manager, ['A', 'B']);
    expect(() => manager.startGame(room, 0, 9)).toThrowError(
      expect.objectContaining({ code: 'BAD_MESSAGE' }) as Error,
    );
  });
});

describe('M8-03 再来一局', () => {
  it('对局未结束 / 非房主不能再来一局；结束后按原阵容重开并刷新名字', () => {
    const manager = new RoomManager();
    const room = makeRoomWithPlayers(manager, ['A', 'B']);
    manager.startGame(room, 0, 1);
    expect(() => manager.rematch(room, 1)).toThrowError(
      expect.objectContaining({ code: 'NOT_HOST' }) as Error,
    );
    expect(() => manager.rematch(room, 0)).toThrowError(
      expect.objectContaining({ code: 'BAD_MESSAGE' }) as Error,
    );
    room.status = 'ended';
    manager.renamePlayer(room, 1, '阿明');
    const fresh = manager.rematch(room, 0);
    expect(room.status).toBe('playing');
    expect(fresh.players).toHaveLength(3); // 2 真人 + 1 AI 阵容保留
    // 起手 +2 等效果由首位玩家承受，手牌可能 >7；改为校验新局牌数守恒（完整重发）
    const total =
      fresh.players.reduce((sum, player) => sum + player.hand.length, 0) +
      fresh.drawPile.length +
      fresh.discardPile.length;
    expect(total).toBe(108);
    expect(fresh.players[1]!.name).toBe('阿明');
    expect(fresh.players[2]!.isHuman).toBe(false);
  });
});

describe('M8-06 重连与清理', () => {
  it('rejoin：凭 token 恢复座位并标记在线；错 token 拒绝', () => {
    const manager = new RoomManager();
    const room = makeRoomWithPlayers(manager, ['A', 'B']);
    const token = room.players[1]!.token;
    manager.markDisconnected(room, 1);
    expect(room.players[1]!.connected).toBe(false);
    const rejoined = manager.rejoin(room.code, token);
    expect(rejoined.player.seat).toBe(1);
    expect(room.players[1]!.connected).toBe(true);
    expect(() => manager.rejoin(room.code, '0'.repeat(32))).toThrowError(
      expect.objectContaining({ code: 'BAD_MESSAGE' }) as Error,
    );
  });

  it('sweep：无人连接超 5 分钟或结束超 30 分钟的房间被销毁，活跃房间保留', () => {
    const manager = new RoomManager();
    // 全员断线且超时的对局中房间 → 销毁
    const stale = makeRoomWithPlayers(manager, ['A', 'B']);
    manager.startGame(stale, 0);
    manager.markDisconnected(stale, 0);
    manager.markDisconnected(stale, 1);
    stale.lastActivityAt = Date.now() - 6 * 60 * 1000;
    // 结束很久的房间 → 销毁
    const ended = makeRoomWithPlayers(manager, ['C', 'D']);
    manager.startGame(ended, 0);
    ended.status = 'ended';
    ended.lastActivityAt = Date.now() - 31 * 60 * 1000;
    // 活跃房间 → 保留
    const active = makeRoomWithPlayers(manager, ['E', 'F']);
    manager.startGame(active, 0);

    const deleted = manager.sweep();
    expect(deleted).toContain(stale.code);
    expect(deleted).toContain(ended.code);
    expect(deleted).not.toContain(active.code);
    expect(() => manager.getRoom(stale.code)).toThrowError(RoomError);
    expect(() => manager.getRoom(active.code)).not.toThrowError();
  });
});
