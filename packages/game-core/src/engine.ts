import { ALL_COLORS } from './deck.ts';
import { isColor, isPlayable, isWild4Legal } from './legal.ts';
import { nextFloat, shuffle } from './rng.ts';
import { nextSeat } from './setup.ts';
import type {
  Card,
  Color,
  Difficulty,
  EngineAction,
  GameEvent,
  GameState,
  UnoWindowState,
} from './types.ts';

/** AI 喊 UNO 概率（按难度，见 `开发计划.md` 4.7）；真实/骨灰级永远会喊 */
const AI_UNO_CALL_CHANCE: Record<Difficulty, number> = {
  casual: 0.8,
  easy: 0.95,
  realistic: 1,
  hardcore: 1,
};

/** AI 抓 UNO 概率（按难度，见 `开发计划.md` 4.7） */
const AI_UNO_CATCH_CHANCE: Record<Difficulty, number> = {
  casual: 0.1,
  easy: 0.4,
  realistic: 0.8,
  hardcore: 1,
};

export interface ApplyActionResult {
  state: GameState;
  /** 本次动作产生的事件（同时已追加进 state.history） */
  events: GameEvent[];
}

function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

function requirePlayer(state: GameState, seat: number) {
  const player = state.players[seat];
  if (!player) throw new Error(`座位 ${seat} 不存在`);
  return player;
}

/** 抽牌堆空了：把弃牌堆（保留顶牌）洗回抽牌堆。返回是否可以继续抽牌 */
function replenishDrawPile(state: GameState, events: GameEvent[]): boolean {
  if (state.drawPile.length > 0) return true;
  if (state.discardPile.length <= 1) return false;

  const top = state.discardPile[state.discardPile.length - 1]!;
  const recyclable = state.discardPile.slice(0, -1);
  state.drawPile = shuffle(recyclable, state.rng);
  state.discardPile = [top];
  events.push({ type: 'PILE_RESHUFFLE', reason: 'draw' });
  return state.drawPile.length > 0;
}

/**
 * 牌堆是否还能供一张牌（不结算本局），见 prepareDraw。
 * 抽牌堆非空 → 可摸；`allowRoundEnd=false` → 能洗就洗；`end-by-fewest` → 一空即不可摸；
 * 默认 reshuffle → 把弃牌堆除顶牌外洗回。
 */
function canProvideDraw(state: GameState, events: GameEvent[], allowRoundEnd: boolean): boolean {
  if (state.drawPile.length > 0) return true;
  if (!allowRoundEnd) return replenishDrawPile(state, events);
  if (state.config.deckExhaustion === 'end-by-fewest') return false;
  return replenishDrawPile(state, events);
}

/**
 * 摸牌前准备一张可摸的牌（M1-7，见 `开发计划.md` 4.9）。
 * - 抽牌堆非空：直接可摸；
 * - `deckExhaustion='end-by-fewest'`：抽牌堆一空即结束本局（按手牌最少者/平局），不洗回；
 * - 默认 `'reshuffle'`：把弃牌堆除顶牌外洗回；若弃牌堆也无法提供牌，按手牌最少者结束；
 * - `allowRoundEnd=false`：胜负已定后的仪式性摸牌，能洗就洗、洗不出来就少摸，不再改胜负。
 */
function prepareDraw(state: GameState, events: GameEvent[], allowRoundEnd = true): boolean {
  if (canProvideDraw(state, events, allowRoundEnd)) return true;
  if (!allowRoundEnd) return false;
  endRoundByFewestCards(state, events);
  return false;
}

/**
 * 给某玩家摸 n 张牌；牌堆耗尽时按规则结束本局（见 prepareDraw）。
 *
 * `until` 供 BUG-01 的主动摸牌规则使用：每摸到一张牌（已进入手牌）判定一次，
 * 命中即提前停止；无论摸了几张，本次摸牌仍聚合为一条 DRAW 事件。
 * `deferRoundEnd`：牌堆耗尽时先返回、由调用方在发出 DRAW 事件后再结算本局，
 * 保证 history 顺序为 …DRAW → ROUND_END。
 */
function drawTo(
  state: GameState,
  seat: number,
  count: number,
  events: GameEvent[],
  options: {
    allowRoundEnd?: boolean;
    until?: (card: Card) => boolean;
    deferRoundEnd?: boolean;
  } = {},
): Card[] {
  const allowRoundEnd = options.allowRoundEnd !== false;
  const drawn: Card[] = [];
  let exhausted = false;
  for (let index = 0; index < count; index += 1) {
    const canDraw = options.deferRoundEnd
      ? canProvideDraw(state, events, allowRoundEnd)
      : prepareDraw(state, events, allowRoundEnd);
    if (!canDraw) {
      exhausted = options.deferRoundEnd === true && allowRoundEnd;
      break;
    }
    const card = state.drawPile.pop()!;
    requirePlayer(state, seat).hand.push(card);
    drawn.push(card);
    if (options.until?.(card)) break;
  }
  if (drawn.length > 0) {
    events.push({ type: 'DRAW', seat, count: drawn.length, cards: drawn });
    // 手牌多于 1 张时 UNO 状态失效：下次再出到 1 张需要重新喊（M1-6）
    if (requirePlayer(state, seat).hand.length > 1) requirePlayer(state, seat).saidUno = false;
  }
  if (exhausted) endRoundByFewestCards(state, events);
  return drawn;
}

/** 结束本局（有人出完手牌） */
function endRound(state: GameState, winnerSeat: number, events: GameEvent[]): void {
  state.phase = 'round-end';
  state.winnerSeat = winnerSeat;
  state.endReason = 'empty-hand';
  state.pendingColorChoiceSeat = null;
  state.drawnThisTurn = null;
  state.stack = null;
  state.wild4Info = null;
  state.pendingChallenge = null;
  state.unoWindow = null;
  events.push({ type: 'PLAYER_OUT', seat: winnerSeat });
  events.push({ type: 'ROUND_END', winnerSeat, reason: 'empty-hand' });
}

/**
 * 牌堆耗尽结束本局（M1-7，见 `开发计划.md` 4.9）：手牌最少者获胜；
 * 若并列最少则平局（winnerSeat = null）。事件 reason='deck-empty' 作为日志标注。
 */
function endRoundByFewestCards(state: GameState, events: GameEvent[]): void {
  let minCount = Number.POSITIVE_INFINITY;
  for (const player of state.players) minCount = Math.min(minCount, player.hand.length);
  const fewest = state.players.filter((player) => player.hand.length === minCount);
  const winnerSeat = fewest.length === 1 ? fewest[0]!.seat : null;

  state.phase = 'round-end';
  state.winnerSeat = winnerSeat;
  state.endReason = 'deck-empty';
  state.pendingColorChoiceSeat = null;
  state.drawnThisTurn = null;
  state.stack = null;
  state.wild4Info = null;
  state.pendingChallenge = null;
  state.unoWindow = null;
  events.push({ type: 'ROUND_END', winnerSeat, reason: 'deck-empty' });
}

/** 回合推进（skipNext=true 表示下一位玩家被跳过） */
function advanceTurn(state: GameState, skipNext = false): void {
  const playerCount = state.players.length;
  let next = nextSeat(state.currentSeat, playerCount, state.direction);
  if (skipNext) next = nextSeat(next, playerCount, state.direction);

  state.currentSeat = next;
  state.phase = 'await-play';
  state.drawnThisTurn = null;
  state.pendingChallenge = null;
  state.unoWindow = null;
  state.turnCount += 1;
}

/** 叠牌链是否启用：仅 `stacking: 'none'` 关闭；`classic` 本期未单独定义，按宽松叠法处理 */
function isStackingEnabled(state: GameState): boolean {
  return state.config.stacking !== 'none';
}

/**
 * 打出的 +2/+4 创建叠牌链，等待下一位玩家选择"叠牌或弃权"。
 * 调用前牌已进入弃牌堆、颜色已结算（`currentColor` 为链顶颜色）。
 */
function startStack(state: GameState, card: Card, events: GameEvent[]): void {
  const actor = state.currentSeat;
  const topColor = state.currentColor;
  if (!topColor) throw new Error('叠牌链需要已经确定的颜色');
  const awaitingSeat = nextSeat(actor, state.players.length, state.direction);

  state.stack = {
    total: card.kind === 'draw2' ? 2 : 4,
    chain: [card],
    lastPlayer: actor,
    topColor,
    awaitingSeat,
  };
  state.phase = 'stack-response';
  state.currentSeat = awaitingSeat;
  state.drawnThisTurn = null;
  events.push({ type: 'STACK_PUSH', seat: actor, card, total: state.stack.total });
}

/**
 * 叠牌链结算：响应者弃权，摸累计张数并失去回合。
 * 多人模式下轮到摸牌者的下一位；2 人模式下下一位恰好是最后出叠牌者（连动规则自然成立）。
 * 牌堆耗尽导致对局结束时不再推进回合。
 */
function resolveStackDraw(state: GameState, events: GameEvent[]): void {
  const stack = state.stack;
  if (!stack) throw new Error('当前没有叠牌链');
  const drawerSeat = stack.awaitingSeat;
  const total = stack.total;

  state.stack = null;
  events.push({ type: 'STACK_RESOLVE', seat: drawerSeat, total });
  drawTo(state, drawerSeat, total, events);
  // 叠牌链已结算（链中 +4 不开放挑战），清掉可能残留的 +4 隐藏信息
  state.wild4Info = null;
  if (state.phase === 'round-end') return;

  state.currentSeat = nextSeat(drawerSeat, state.players.length, state.direction);
  state.phase = 'await-play';
  state.drawnThisTurn = null;
  state.turnCount += 1;
}

/**
 * 弃权叠牌时是否开放 +4 挑战（M1-5，见 `开发计划.md` 4.6）。
 * 只有"普通回合打出的单张 +4"满足条件：
 * - 叠牌链中已有叠牌（+2/+4 续过链）→ 不开放（4.5 明确决定）；
 * - `challengeWild4=false` → 不开放；
 * - 链中 +4 的 `wild4Info.challengeable` 为 false（理论上链长 >1 时才会出现）。
 */
function shouldOfferChallenge(state: GameState): boolean {
  if (!state.config.challengeWild4) return false;
  const stack = state.stack;
  const info = state.wild4Info;
  if (!stack || !info || stack.chain.length !== 1) return false;
  if (stack.chain[0]?.kind !== 'wild4') return false;
  return info.challengeable && info.seat === stack.lastPlayer;
}

/**
 * 进入 +4 挑战窗口：把叠牌链换成"挑战/接受摸 4"二选一，挑战者暂不摸牌。
 * 挑战者的手牌展示、挑战判定所需信息仍在隐藏的 `wild4Info` 中，结算时才清空。
 */
function enterChallengeDecide(state: GameState): void {
  const stack = state.stack;
  if (!stack) throw new Error('当前没有叠牌链');
  const challengerSeat = stack.awaitingSeat;
  const targetSeat = stack.lastPlayer;

  state.stack = null;
  state.pendingChallenge = { challengerSeat, targetSeat, total: 4 };
  state.phase = 'challenge-decide';
  state.currentSeat = challengerSeat;
  state.drawnThisTurn = null;
}

/**
 * 挑战成功：出牌者（target）违规，罚摸 4 张；挑战者不摸牌，按 +4 所选颜色继续自己的回合。
 */
function resolveChallengeSuccess(state: GameState, events: GameEvent[]): void {
  const pending = state.pendingChallenge;
  if (!pending) throw new Error('当前没有 +4 挑战窗口');
  const challenger = requirePlayer(state, pending.challengerSeat);
  const target = requirePlayer(state, pending.targetSeat);

  // 手牌展示只给"人类挑战者"：AI 挑战时事件里不携带目标手牌（隐藏信息），
  // 人类挑战 AI 时携带完整手牌快照供 UI 展示 2~3 秒。
  const hand = challenger.isHuman ? target.hand.map((card) => ({ ...card })) : undefined;
  events.push({
    type: 'CHALLENGE_SUCCESS',
    challenger: pending.challengerSeat,
    target: pending.targetSeat,
    ...(hand ? { hand } : {}),
  });

  state.pendingChallenge = null;
  state.wild4Info = null;
  state.drawnThisTurn = null;
  drawTo(state, pending.targetSeat, 4, events);
  if (state.phase === 'round-end') return;

  // 挑战者不摸牌，继续自己的回合（currentSeat 保持挑战者，颜色沿用 +4 所选颜色）
  state.phase = 'await-play';
  state.currentSeat = pending.challengerSeat;
  state.turnCount += 1;
}

/**
 * 挑战失败：出牌者合法，挑战者罚摸 6 张（4+2）并失去回合，轮到挑战者的下一位。
 */
function resolveChallengeFail(state: GameState, events: GameEvent[]): void {
  const pending = state.pendingChallenge;
  if (!pending) throw new Error('当前没有 +4 挑战窗口');
  const penalty = 6;

  events.push({
    type: 'CHALLENGE_FAIL',
    challenger: pending.challengerSeat,
    target: pending.targetSeat,
    penalty,
  });

  state.pendingChallenge = null;
  state.wild4Info = null;
  state.drawnThisTurn = null;
  drawTo(state, pending.challengerSeat, penalty, events);
  if (state.phase === 'round-end') return;

  state.phase = 'await-play';
  state.currentSeat = nextSeat(pending.challengerSeat, state.players.length, state.direction);
  state.turnCount += 1;
}

/**
 * 接受 +4（不挑战）：挑战者摸 4 张并失去回合，轮到挑战者的下一位。
 */
function resolveChallengeDecline(state: GameState, events: GameEvent[]): void {
  const pending = state.pendingChallenge;
  if (!pending) throw new Error('当前没有 +4 挑战窗口');

  state.pendingChallenge = null;
  state.wild4Info = null;
  state.drawnThisTurn = null;
  drawTo(state, pending.challengerSeat, pending.total, events);
  if (state.phase === 'round-end') return;

  state.phase = 'await-play';
  state.currentSeat = nextSeat(pending.challengerSeat, state.players.length, state.direction);
  state.turnCount += 1;
}

/**
 * 打开 UNO 窗口（M1-6）：某玩家出牌后恰好剩 1 张且还没喊 UNO，暂停在下一步行动之前。
 * - 人类忘记喊：窗口内可以点 CALL_UNO；
 * - AI 忘记喊：窗口内其他玩家（人类点按钮、AI 在窗口关闭时按难度掷概率）可以抓；
 * - 下一位玩家一行动窗口就关闭（`pendingPhase` 记录要恢复的阶段）。
 */
function openUnoWindow(
  state: GameState,
  seat: number,
  pendingPhase: UnoWindowState['pendingPhase'],
): void {
  const player = requirePlayer(state, seat);
  state.unoWindow = {
    seat,
    canCatch: seat === state.config.humanSeat ? [] : [seat],
    canCall: player.isHuman && !state.config.autoCallUno,
    pendingPhase,
  };
  state.phase = 'uno-window';
}

/**
 * 出牌后的 UNO 判定：手牌恰好剩 1 张时——
 * - 人类 + 未开自动喊：开窗口等人类点 UNO；
 * - AI（或 autoCallUno=true）：按难度概率立即决定是否喊，忘喊才开窗口给其他人抓。
 */
function handleUnoAfterPlay(
  state: GameState,
  actor: number,
  pendingPhase: UnoWindowState['pendingPhase'],
  events: GameEvent[],
): void {
  const player = requirePlayer(state, actor);
  if (player.hand.length !== 1) return;
  player.saidUno = false;

  if (player.isHuman && !state.config.autoCallUno) {
    openUnoWindow(state, actor, pendingPhase);
    return;
  }

  const callChance = state.config.autoCallUno ? 1 : AI_UNO_CALL_CHANCE[state.config.aiDifficulty];
  // 概率为 1 时直接喊，不消耗随机数（保证 --seed 演示可复现）
  if (callChance >= 1 || nextFloat(state.rng) < callChance) {
    player.saidUno = true;
    events.push({ type: 'UNO_CALLED', seat: actor });
    return;
  }
  openUnoWindow(state, actor, pendingPhase);
}

/** UNO 罚牌：被抓者摸 `unoPenalty` 张并清除 UNO 状态 */
function penalizeUno(state: GameState, seat: number, events: GameEvent[]): void {
  const penalty = state.config.unoPenalty;
  events.push({ type: 'UNO_CAUGHT', seat, penalty });
  drawTo(state, seat, penalty, events);
  requirePlayer(state, seat).saidUno = false;
}

/**
 * 关闭 UNO 窗口并恢复到 `pendingPhase`，关闭时结算 AI 抓人概率。
 * 人类抓人不会被自动结算——人类需要在窗口关闭前主动点 CATCH_UNO。
 * 多人可抓时按座位顺序（沿当前方向）先到先得，只处罚一次。
 */
function closeUnoWindow(state: GameState, events: GameEvent[]): void {
  const win = state.unoWindow;
  if (!win) return;
  state.unoWindow = null;
  state.phase = win.pendingPhase;

  const target = requirePlayer(state, win.seat);
  if (target.saidUno) return; // 已喊过 UNO，不再被抓

  const catchChance = AI_UNO_CATCH_CHANCE[state.config.aiDifficulty];
  let catcherSeat = win.seat;
  for (let step = 1; step < state.players.length; step += 1) {
    catcherSeat = nextSeat(catcherSeat, state.players.length, state.direction);
    const catcher = requirePlayer(state, catcherSeat);
    if (catcher.isHuman) continue; // 人类抓人由 UI 按钮触发，不做自动判定
    if (catchChance >= 1 || nextFloat(state.rng) < catchChance) {
      penalizeUno(state, win.seat, events);
      return;
    }
  }
}

/**
 * 叠牌响应：打出一张 +2/+4 延续叠牌链（宽松叠法下不看颜色，+2/+4 可任意互叠）。
 * - +2：颜色变为该 +2 的颜色；
 * - +4：出牌者选色；叠牌链中的 +4 不开放挑战（`wild4Info.challengeable = false`）；
 * - 若这张牌出完手牌：立即获胜，下一位仍摸累计张数（仪式感），链不再继续。
 */
function playStackCard(
  state: GameState,
  card: Card,
  colorChoice: string | undefined,
  events: GameEvent[],
): void {
  const stack = state.stack;
  if (!stack) throw new Error('当前没有叠牌链');
  const actor = state.currentSeat;
  if (actor !== stack.awaitingSeat) throw new Error('还没轮到该玩家响应叠牌');
  const player = requirePlayer(state, actor);

  const isWild4Card = card.kind === 'wild4';
  let chosenColor: Color | null = null;
  if (isWild4Card) {
    if (!isColor(colorChoice)) throw new Error('Wild+4 叠牌必须选择一个合法颜色');
    chosenColor = colorChoice;
  }

  const previousColor = state.currentColor;
  const wild4WasLegal = isWild4Card ? isWild4Legal(state, actor) : true;

  const handIndex = player.hand.findIndex((item) => item.id === card.id);
  if (handIndex < 0) throw new Error('手牌中没有这张牌');
  player.hand.splice(handIndex, 1);
  state.discardPile.push(card);
  events.push({ type: 'PLAY', seat: actor, card });

  if (isWild4Card && chosenColor) {
    state.currentColor = chosenColor;
    events.push({ type: 'COLOR_SET', seat: actor, color: chosenColor });
    // 隐藏信息：叠牌链中的 +4 不开放挑战（M1-5 只对普通回合打出的 +4 开放挑战）
    state.wild4Info = {
      seat: actor,
      wasLegal: wild4WasLegal,
      previousColor,
      challengeable: false,
      turn: state.turnCount,
    };
  } else if (card.color) {
    state.currentColor = card.color;
  }

  stack.total += card.kind === 'draw2' ? 2 : 4;
  stack.chain.push(card);
  stack.lastPlayer = actor;
  if (!state.currentColor) throw new Error('叠牌链颜色异常');
  stack.topColor = state.currentColor;

  const next = nextSeat(actor, state.players.length, state.direction);
  stack.awaitingSeat = next;
  state.currentSeat = next;
  events.push({ type: 'STACK_PUSH', seat: actor, card, total: stack.total });

  if (player.hand.length === 0) {
    // 最后一张是叠牌：立即获胜；下一位仍摸累计张数（仪式感），链不再继续
    const victimSeat = next;
    const total = stack.total;
    state.stack = null;
    events.push({ type: 'STACK_RESOLVE', seat: victimSeat, total });
    drawTo(state, victimSeat, total, events, { allowRoundEnd: false });
    endRound(state, actor, events);
    return;
  }
  // 叠牌过程中出牌者剩 1 张：UNO 窗口压在叠牌响应之上（喊/抓后继续响应叠牌）
  if (player.hand.length === 1) handleUnoAfterPlay(state, actor, 'stack-response', events);
}

/**
 * 打出一张牌并结算基础效果（数字 / Skip / Reverse / +2 / Wild / +4）。
 * M1-4 起：正常回合打出的 +2/+4 会创建叠牌链（宽松叠法），等待下家响应；
 * `stacking: 'none'` 时回退为 M1-3 的"立即让下家摸牌并跳过"。
 */
function playCard(
  state: GameState,
  card: Card,
  colorChoice: string | undefined,
  events: GameEvent[],
): void {
  const actor = state.currentSeat;
  const player = requirePlayer(state, actor);
  const previousColor = state.currentColor;
  // Wild+4 的合法性是隐藏信息：只在打出时记录，用于 M1-5 挑战结算（原版允许诈唬）
  const wild4WasLegal = card.kind === 'wild4' ? isWild4Legal(state, actor) : true;

  const handIndex = player.hand.findIndex((item) => item.id === card.id);
  if (handIndex < 0) throw new Error('手牌中没有这张牌');
  player.hand.splice(handIndex, 1);
  state.discardPile.push(card);
  events.push({ type: 'PLAY', seat: actor, card });

  if (card.kind === 'wild' || card.kind === 'wild4') {
    if (!isColor(colorChoice)) throw new Error('Wild 牌必须选择一个合法颜色');
    state.currentColor = colorChoice;
    events.push({ type: 'COLOR_SET', seat: actor, color: colorChoice });
  } else if (card.color) {
    state.currentColor = card.color;
  }

  if (card.kind === 'wild4') {
    state.wild4Info = {
      seat: actor,
      wasLegal: wild4WasLegal,
      previousColor,
      challengeable: true,
      turn: state.turnCount,
    };
  }

  const victim = nextSeat(actor, state.players.length, state.direction);
  let skipNext = false;

  switch (card.kind) {
    case 'number':
    case 'wild': {
      break;
    }
    case 'skip': {
      events.push({ type: 'SKIP', seat: victim });
      skipNext = true;
      break;
    }
    case 'reverse': {
      state.direction = state.direction === 1 ? -1 : 1;
      events.push({ type: 'REVERSE', direction: state.direction });
      // 2 人特殊规则：Reverse 等同 Skip，出牌者立即继续行动
      if (state.players.length === 2 && state.config.twoPlayerRules) {
        events.push({ type: 'SKIP', seat: victim });
        skipNext = true;
      }
      break;
    }
    case 'draw2': {
      if (isStackingEnabled(state)) {
        startStack(state, card, events);
      } else {
        drawTo(state, victim, 2, events);
        events.push({ type: 'SKIP', seat: victim });
        skipNext = true;
      }
      break;
    }
    case 'wild4': {
      if (isStackingEnabled(state)) {
        startStack(state, card, events);
      } else if (state.config.challengeWild4 && player.hand.length > 0) {
        // 叠牌关闭（stacking='none'）时，普通回合 +4 仍按原版给下家"摸 4 / 挑战"二选一
        state.pendingChallenge = {
          challengerSeat: victim,
          targetSeat: actor,
          total: 4,
        };
        state.phase = 'challenge-decide';
        state.currentSeat = victim;
        state.drawnThisTurn = null;
      } else {
        drawTo(state, victim, 4, events);
        events.push({ type: 'SKIP', seat: victim });
        skipNext = true;
      }
      break;
    }
  }

  // 出完手牌：本局立即结束（M1-7 再补计分/边界）
  if (state.phase === 'round-end') return;
  if (player.hand.length === 0) {
    // 最后一张是 +2/+4：立即获胜；叠牌链不再结算，
    // 但下家仍摸累计张数（仪式感，不影响胜负）
    if (state.stack) {
      const pending = state.stack;
      const victimSeat = pending.awaitingSeat;
      const total = pending.total;
      state.stack = null;
      events.push({ type: 'STACK_RESOLVE', seat: victimSeat, total });
      drawTo(state, victimSeat, total, events, { allowRoundEnd: false });
    }
    endRound(state, actor, events);
    return;
  }
  // 叠牌链已创建：等待下一位玩家响应，当前回合不结束；出牌者剩 1 张则先开 UNO 窗口
  if (state.phase === 'stack-response') {
    handleUnoAfterPlay(state, actor, 'stack-response', events);
    return;
  }
  // +4 挑战窗口已打开（仅 stacking='none' 时出现）：等待挑战者二选一，出牌者剩 1 张则先开 UNO 窗口
  if (state.phase === 'challenge-decide') {
    handleUnoAfterPlay(state, actor, 'challenge-decide', events);
    return;
  }
  advanceTurn(state, skipNext);
  // 出牌后恰好剩 1 张：进入 UNO 窗口（人类手动喊 / AI 按难度概率自动喊）
  handleUnoAfterPlay(state, actor, 'await-play', events);
}

/**
 * 执行一个动作，返回新状态与本次事件。
 * 纯函数：不修改传入 state（内部 structuredClone）。
 */
export function applyAction(state: GameState, action: EngineAction): ApplyActionResult {
  const next = cloneState(state);
  const events: GameEvent[] = [];
  next.events = events;

  if (next.phase === 'round-end') {
    throw new Error('对局已结束，不能再执行动作');
  }

  // 已成功执行的动作计数（getResult 结算统计用）
  next.actionCount += 1;

  // M1-6：UNO 窗口是"下一步行动之前"的反应窗口；除窗口自身的喊/抓外，
  // 任何动作都会先关闭窗口（并按难度结算 AI 抓人），再在 pendingPhase 下正常执行。
  if (
    next.phase === 'uno-window' &&
    next.unoWindow &&
    action.type !== 'CALL_UNO' &&
    action.type !== 'CATCH_UNO'
  ) {
    closeUnoWindow(next, events);
    // 抓人罚牌可能因牌堆耗尽直接结束本局（含平局 endReason 非 null），此时不再执行原动作
    if (next.endReason !== null) {
      next.history.push(...events);
      return { state: next, events };
    }
  }

  switch (action.type) {
    case 'CHOOSE_COLOR': {
      if (next.phase !== 'choose-color' || next.pendingColorChoiceSeat !== next.currentSeat) {
        throw new Error('当前不需要选择颜色');
      }
      if (!isColor(action.color)) throw new Error('非法颜色');
      next.currentColor = action.color;
      next.pendingColorChoiceSeat = null;
      next.phase = 'await-play';
      events.push({ type: 'COLOR_SET', seat: next.currentSeat, color: action.color });
      break;
    }

    case 'DRAW': {
      if (next.phase !== 'await-play') throw new Error('当前阶段不能抽牌');
      if (next.drawnThisTurn) throw new Error('本回合已经抽过牌，请打出抽到的牌或结束回合');

      const seat = next.currentSeat;
      // BUG-01（见 `开发计划.md` 4.4）：主动摸牌改为「持续摸牌，直到摸到第一张当前可打出的牌」。
      // 过程中摸到的其余牌留在手里；停下的那张记为 drawnThisTurn，合法动作只剩打出它或结束回合。
      //
      // 终止性：每次成功摸牌都会让「抽牌堆 + 弃牌堆」总张数减 1（洗回只是把弃牌堆搬到
      // 抽牌堆，不增加总张数），所以循环次数上界是两堆张数之和 + 1；谓词始终不满足时，
      // prepareDraw 会在两堆都无法供牌时按 4.9 结束本局（round-end）并返回 false。
      const maxDraws = next.drawPile.length + next.discardPile.length + 1;
      const drawn = drawTo(next, seat, maxDraws, events, {
        until: (card) => isPlayable(next, card),
        // 先聚合 DRAW 事件，再由 drawTo 在返回前结算本局：history 顺序保持 …DRAW → ROUND_END
        deferRoundEnd: true,
      });
      // 摸牌过程中牌堆耗尽 → 本局已按 4.9 结算（可能平局）：保持 round-end / endReason，
      // 不推进回合、不设置 drawnThisTurn，避免破坏结算。
      if (isGameOver(next) || drawn.length === 0) break;

      next.drawnThisTurn = drawn[drawn.length - 1]!; // 停下的最后一张必为当前可出牌
      next.phase = 'await-play';
      break;
    }

    case 'PLAY_CARD': {
      if (next.phase !== 'await-play') throw new Error('当前阶段不能出牌');
      if (next.drawnThisTurn) throw new Error('已抽牌：只能打出刚抽到的牌或结束回合');

      const player = requirePlayer(next, next.currentSeat);
      const card = player.hand.find((item) => item.id === action.cardId);
      if (!card) throw new Error('手牌中没有这张牌');
      if (!isPlayable(next, card)) throw new Error('这张牌当前不可出');
      if (
        (card.kind === 'wild' || card.kind === 'wild4') &&
        (!isColor(action.colorChoice) || !ALL_COLORS.includes(action.colorChoice))
      ) {
        throw new Error('出万能牌必须选择颜色');
      }

      playCard(next, card, action.colorChoice, events);
      break;
    }

    case 'PLAY_DRAWN': {
      if (next.phase !== 'await-play' || !next.drawnThisTurn) {
        throw new Error('当前没有可打出的抽牌');
      }
      const card = next.drawnThisTurn;
      if (card.id !== action.cardId) throw new Error('只能打出刚抽到的那张牌');
      if (!isPlayable(next, card)) throw new Error('刚抽到的牌当前不可出');
      if (
        (card.kind === 'wild' || card.kind === 'wild4') &&
        (!isColor(action.colorChoice) || !ALL_COLORS.includes(action.colorChoice))
      ) {
        throw new Error('出万能牌必须选择颜色');
      }
      next.drawnThisTurn = null;
      playCard(next, card, action.colorChoice, events);
      break;
    }

    case 'END_TURN': {
      if (next.phase !== 'await-play') throw new Error('当前阶段不能结束回合');
      if (!next.drawnThisTurn) throw new Error('本回合没有抽牌，不能结束回合');
      next.drawnThisTurn = null;
      advanceTurn(next);
      break;
    }

    case 'STACK_PLAY': {
      if (next.phase !== 'stack-response' || !next.stack) {
        throw new Error('当前不是叠牌响应阶段');
      }
      const player = requirePlayer(next, next.currentSeat);
      const card = player.hand.find((item) => item.id === action.cardId);
      if (!card) throw new Error('手牌中没有这张牌');
      if (card.kind !== 'draw2' && card.kind !== 'wild4') {
        throw new Error('叠牌响应阶段只能打出 +2 或 +4');
      }
      playStackCard(next, card, action.colorChoice, events);
      break;
    }

    case 'STACK_DECLINE': {
      if (next.phase !== 'stack-response' || !next.stack) {
        throw new Error('当前不是叠牌响应阶段');
      }
      // M1-5：普通回合的单张 +4 被弃权叠牌时，先给挑战窗口；其余情况直接摸累计牌
      if (shouldOfferChallenge(next)) {
        enterChallengeDecide(next);
      } else {
        resolveStackDraw(next, events);
      }
      break;
    }

    case 'CHALLENGE_W4': {
      if (next.phase !== 'challenge-decide' || !next.pendingChallenge) {
        throw new Error('当前不是 +4 挑战窗口');
      }
      if (next.currentSeat !== next.pendingChallenge.challengerSeat) {
        throw new Error('不是你的挑战回合');
      }
      const info = next.wild4Info;
      if (!info || !info.challengeable || info.seat !== next.pendingChallenge.targetSeat) {
        throw new Error('当前没有可挑战的 Wild+4');
      }
      if (info.wasLegal) {
        resolveChallengeFail(next, events);
      } else {
        resolveChallengeSuccess(next, events);
      }
      break;
    }

    case 'DECLINE_CHALLENGE': {
      if (next.phase !== 'challenge-decide' || !next.pendingChallenge) {
        throw new Error('当前不是 +4 挑战窗口');
      }
      if (next.currentSeat !== next.pendingChallenge.challengerSeat) {
        throw new Error('不是你的挑战回合');
      }
      resolveChallengeDecline(next, events);
      break;
    }

    case 'CALL_UNO': {
      const win = next.unoWindow;
      if (next.phase !== 'uno-window' || !win) throw new Error('当前不是 UNO 窗口');
      if (!win.canCall) throw new Error('当前不能喊 UNO');
      const player = requirePlayer(next, win.seat);
      if (player.saidUno) throw new Error('已经喊过 UNO');
      player.saidUno = true;
      events.push({ type: 'UNO_CALLED', seat: win.seat });
      next.unoWindow = null;
      next.phase = win.pendingPhase;
      break;
    }

    case 'CATCH_UNO': {
      const win = next.unoWindow;
      if (next.phase !== 'uno-window' || !win) throw new Error('当前不是 UNO 窗口');
      if (action.targetSeat !== win.seat) throw new Error('只能抓当前忘喊 UNO 的玩家');
      if (win.seat === next.config.humanSeat) throw new Error('不能抓自己');
      const target = requirePlayer(next, win.seat);
      if (target.saidUno) throw new Error('该玩家已经喊过 UNO');
      penalizeUno(next, win.seat, events);
      // 抓人不消耗行动：窗口关闭后仍轮到原来的下一位玩家行动（牌堆耗尽结束本局时除外）
      next.unoWindow = null;
      if (next.endReason === null) next.phase = win.pendingPhase;
      break;
    }

    default: {
      throw new Error(`未知动作类型: ${(action as { type: string }).type}`);
    }
  }

  next.history.push(...events);
  return { state: next, events };
}

/** 对局是否结束 */
export function isGameOver(state: GameState): boolean {
  return state.phase === 'round-end';
}

/** 对局是否终止（契约 API 名，语义与 isGameOver 相同） */
export function isTerminal(state: GameState): boolean {
  return isGameOver(state);
}
