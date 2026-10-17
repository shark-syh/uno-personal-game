import { ALL_COLORS } from './deck.ts';
import type { Card, Color, EngineAction, GameState } from './types.ts';

/** 取弃牌堆顶牌（没有则返回 null） */
export function topCard(state: GameState): Card | null {
  return state.discardPile[state.discardPile.length - 1] ?? null;
}

/** 是否为合法颜色 */
export function isColor(value: unknown): value is Color {
  return typeof value === 'string' && (ALL_COLORS as readonly string[]).includes(value);
}

/**
 * 某张牌在当前局面下能否打出（正常回合 / 抽牌后判断共用）。
 *
 * 规则（见 `docs/开发计划.md` 4.4）：
 * - Wild / Wild+4：永远可出（Wild+4 允许诈唬，挑战由 M1-5 实现）；
 * - 颜色匹配；
 * - 数字匹配（顶牌是数字时）；
 * - 图案匹配（跳过/反转/+2 可跨色压在同类牌上）。
 */
export function isPlayable(state: GameState, card: Card): boolean {
  if (card.kind === 'wild' || card.kind === 'wild4') return true;

  const top = topCard(state);
  if (!top) return false;

  if (state.currentColor !== null && card.color === state.currentColor) return true;

  if (top.kind === 'number' && card.kind === 'number' && card.value === top.value) return true;

  if (
    (top.kind === 'skip' || top.kind === 'reverse' || top.kind === 'draw2') &&
    card.kind === top.kind
  ) {
    return true;
  }

  return false;
}

/** 手牌里是否有可出的牌（AI/提示用） */
export function hasPlayableCard(state: GameState, seat: number): boolean {
  const player = state.players[seat];
  if (!player) return false;
  return player.hand.some((card) => isPlayable(state, card));
}

/**
 * Wild+4 是否有"合法出牌"资格（原版：手上不能有当前颜色的牌）。
 * 注意：即使不合法也允许打出（原版允许诈唬），只是被挑战时要受罚 —— 所以这里
 * 只返回判定结果，用于记录隐藏信息，供 M1-5 挑战结算使用。
 *
 * `wild4Legality` 配置：
 * - color-only（经典，默认）：只看当前颜色；
 * - new-version：手上只要有 Wild，也算"有可替代牌"。
 */
export function isWild4Legal(state: GameState, seat: number): boolean {
  const player = state.players[seat];
  if (!player) return true;
  const currentColor = state.currentColor;
  if (!currentColor) return true;

  const hasMatchingColor = player.hand.some((card) => card.color === currentColor);
  if (hasMatchingColor) return false;

  if (state.config.wild4Legality === 'new-version') {
    const hasWild = player.hand.some((card) => card.kind === 'wild');
    if (hasWild) return false;
  }
  return true;
}

/** 某张牌能否用于叠牌（宽松叠法：+2 / +4 都可，且不看颜色） */
export function isStackableCard(card: Card): boolean {
  return card.kind === 'draw2' || card.kind === 'wild4';
}

/** 某张牌对应的可行动作（万能牌展开为 4 种颜色） */
function playActionsFor(card: Card, type: 'PLAY_CARD' | 'PLAY_DRAWN'): EngineAction[] {
  if (card.kind === 'wild' || card.kind === 'wild4') {
    return ALL_COLORS.map((color) =>
      type === 'PLAY_CARD'
        ? { type: 'PLAY_CARD' as const, cardId: card.id, colorChoice: color }
        : { type: 'PLAY_DRAWN' as const, cardId: card.id, colorChoice: color },
    );
  }
  return type === 'PLAY_CARD'
    ? [{ type: 'PLAY_CARD', cardId: card.id }]
    : [{ type: 'PLAY_DRAWN', cardId: card.id }];
}

/** 叠牌响应阶段的动作：任意 +2/+4（宽松叠法不看颜色）+ 弃权 */
function stackActionsFor(card: Card): EngineAction[] {
  if (card.kind === 'wild4') {
    return ALL_COLORS.map((color) => ({
      type: 'STACK_PLAY' as const,
      cardId: card.id,
      colorChoice: color,
    }));
  }
  return [{ type: 'STACK_PLAY', cardId: card.id }];
}

/** 叠牌响应阶段的合法动作（宽松叠法不看颜色）：任意 +2/+4 + 弃权 */
function stackResponseActions(state: GameState): EngineAction[] {
  const stack = state.stack;
  if (!stack) return [];
  const player = state.players[stack.awaitingSeat];
  if (!player) return [];
  const actions: EngineAction[] = [];
  for (const card of player.hand) {
    if (isStackableCard(card)) actions.push(...stackActionsFor(card));
  }
  actions.push({ type: 'STACK_DECLINE' });
  return actions;
}

/** +4 挑战窗口的合法动作：只有挑战权的玩家二选一 */
function challengeActions(state: GameState): EngineAction[] {
  const pending = state.pendingChallenge;
  if (!pending || pending.challengerSeat !== state.currentSeat) return [];
  return [{ type: 'CHALLENGE_W4' }, { type: 'DECLINE_CHALLENGE' }];
}

/** 正常回合（含抽牌后）的合法动作 */
function awaitPlayActions(state: GameState): EngineAction[] {
  const player = state.players[state.currentSeat];
  if (!player) return [];

  const actions: EngineAction[] = [];

  // 已抽牌：只能打出刚抽到的那张，或结束回合
  if (state.drawnThisTurn) {
    if (isPlayable(state, state.drawnThisTurn)) {
      actions.push(...playActionsFor(state.drawnThisTurn, 'PLAY_DRAWN'));
    }
    actions.push({ type: 'END_TURN' });
    return actions;
  }

  for (const card of player.hand) {
    if (isPlayable(state, card)) {
      actions.push(...playActionsFor(card, 'PLAY_CARD'));
    }
  }
  actions.push({ type: 'DRAW' });
  return actions;
}

/**
 * 生成当前玩家（state.currentSeat）的所有合法动作。
 * UI 只渲染这个列表；AI 候选也基于它生成。
 *
 * M1-6 补充：`uno-window` 是"下一位行动前的反应窗口"，因此该阶段的动作由两部分组成：
 * - 窗口动作：人类点 UNO（CALL_UNO）/ 抓别人 UNO（CATCH_UNO，targetSeat 为忘喊者）；
 * - 当前行动者的原始动作（pendingPhase 对应的动作）：执行其中任一动作即关闭窗口。
 * AI 候选生成（M2）需要按动作类型自行过滤“不属于自己的窗口动作”。
 */
export function getLegalActions(state: GameState): EngineAction[] {
  switch (state.phase) {
    case 'choose-color':
      return ALL_COLORS.map((color) => ({ type: 'CHOOSE_COLOR', color }));
    case 'stack-response':
      return stackResponseActions(state);
    case 'challenge-decide':
      return challengeActions(state);
    case 'uno-window': {
      const win = state.unoWindow;
      if (!win) return [];
      const actions: EngineAction[] = [];
      if (win.canCall) actions.push({ type: 'CALL_UNO' });
      for (const targetSeat of win.canCatch) actions.push({ type: 'CATCH_UNO', targetSeat });
      // 窗口关闭后要恢复的 pending 动作也一并给出：任一动作都会先结算抓人再执行
      if (win.pendingPhase === 'stack-response') actions.push(...stackResponseActions(state));
      else if (win.pendingPhase === 'challenge-decide') actions.push(...challengeActions(state));
      else actions.push(...awaitPlayActions(state));
      return actions;
    }
    case 'await-play':
      return awaitPlayActions(state);
    default:
      return [];
  }
}
