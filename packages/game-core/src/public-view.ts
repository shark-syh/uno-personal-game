/**
 * 引擎侧 UI 对接层（M3-2）：把内部 `GameState` 投影成 UI 契约的 `GameView`。
 *
 * 契约来源：`UI开发提示词.md` 第 1 节（字段冻结）。本文件只负责：
 * - 隐藏信息过滤：其他玩家手牌、`wild4Info`、他人摸牌牌面、AI 挑战时看到的手牌；
 * - `EngineAction` → `UiAction`（带 id / label / hint，供 UI 渲染按钮）；
 * - `getResult` → 契约 `result`（含平局）；
 * - 人类可交互动作（AI 回合时人类合法动作为空，UNO 窗口例外）。
 *
 * UI 侧只消费这里产出的 view，并通过 `toEngineAction()` 把 UiAction 换回引擎动作。
 */
import { COLOR_NAME, cardLabel } from './deck.ts';
import { getLegalActions } from './legal.ts';
import { getResult } from './result.ts';
import type {
  AiMode,
  Card,
  Color,
  Difficulty,
  Direction,
  EngineAction,
  GameEvent,
  GamePhase,
  GameState,
  StackState,
} from './types.ts';

/** UI 动作（契约 §1.3）：带展示信息的合法动作 */
export interface UiAction {
  /** 唯一 id（引擎生成） */
  id: string;
  type: EngineAction['type'];
  /** 按钮/提示文案 */
  label: string;
  cardId?: string;
  colorChoice?: Color;
  color?: Color;
  targetSeat?: number;
  disabled?: boolean;
  /** 提示条文字 */
  hint?: string;
}

/** 契约 §1.2 的 config 子集 */
export interface PublicConfig {
  playerCount: number;
  difficulty: Difficulty;
  aiMode: AiMode;
  challengeWild4: boolean;
}

/** 契约 §1.2 settings（UI 会用 localStorage 覆盖，这里给默认值保证渲染完整） */
export interface ViewSettings {
  autoCallUno: boolean;
  aiSpeed: 'slow' | 'normal' | 'fast';
  sound: boolean;
  animation: boolean;
  showHint: boolean;
  aiChatter: boolean;
}

export const DEFAULT_VIEW_SETTINGS: ViewSettings = {
  autoCallUno: false,
  aiSpeed: 'normal',
  sound: true,
  animation: true,
  showHint: true,
  aiChatter: true,
};

/** 契约 §1.2 players[] 里由 UI/AI 层补充的展示字段也给出默认值 */
export interface PublicPlayerView {
  seat: number;
  name: string;
  isHuman: boolean;
  avatar: string;
  handCount: number;
  saidUno: boolean;
  thinking: boolean;
  lastPlayed: Card | null;
  line: string;
  difficulty: Difficulty | null;
}

/** 契约 §1.2 human */
export interface PublicHumanView {
  seat: number;
  hand: Card[];
  legalActions: UiAction[];
  drawnThisTurn: Card | null;
  mustRespondStack: boolean;
  canCallUno: boolean;
  /** 人类可以抓 UNO 的座位号 */
  canCatch: number[];
  pendingChallenge: { opponentSeat: number } | null;
}

/** 契约 §1.2 table */
export interface PublicTableView {
  discardTop: Card | null;
  /** 最近 3 张（新→旧），用于视觉堆叠 */
  discardTop3: Card[];
  drawPileCount: number;
  stack: StackState | null;
  pendingColorChoice: boolean;
  winnerSeat: number | null;
}

/** 契约 §1.2.2 result（平局时 winnerSeat = null） */
export interface PublicResult {
  winnerSeat: number | null;
  isDraw: boolean;
  reason: 'empty-hand' | 'deck-empty';
  players: Array<{
    seat: number;
    name: string;
    isHuman: boolean;
    remaining: Card[];
    score: number;
    saidUno: boolean;
  }>;
  turns: number;
  actions: number;
  draws: number;
  plays: number;
  stackPlays: number;
  unoCalls: number;
  durationMs: number;
}

/** 契约 §1.2 GameView（UI 的唯一数据源） */
export interface GameView {
  mock: boolean;
  screen: 'lobby' | 'game' | 'result';
  phase: GamePhase;
  config: PublicConfig;
  currentSeat: number;
  direction: Direction;
  currentColor: Color | null;
  players: PublicPlayerView[];
  human: PublicHumanView;
  table: PublicTableView;
  events: GameEvent[];
  result: PublicResult | null;
  settings: ViewSettings;
  dev: { mockName?: string; toolbar?: boolean };
}

/** 生成 lobby 屏幕的伪 view（引擎不保存大厅状态，由 UI 层持有） */
export function createLobbyView(
  config: Partial<PublicConfig> = {},
  settings: Partial<ViewSettings> = {},
): GameView {
  return {
    mock: false,
    screen: 'lobby',
    phase: 'lobby',
    config: {
      playerCount: config.playerCount ?? 4,
      difficulty: config.difficulty ?? 'realistic',
      aiMode: config.aiMode ?? 'auto',
      challengeWild4: config.challengeWild4 ?? true,
    },
    currentSeat: 0,
    direction: 1,
    currentColor: null,
    players: [],
    human: {
      seat: 0,
      hand: [],
      legalActions: [],
      drawnThisTurn: null,
      mustRespondStack: false,
      canCallUno: false,
      canCatch: [],
      pendingChallenge: null,
    },
    table: {
      discardTop: null,
      discardTop3: [],
      drawPileCount: 0,
      stack: null,
      pendingColorChoice: false,
      winnerSeat: null,
    },
    events: [],
    result: null,
    settings: { ...DEFAULT_VIEW_SETTINGS, ...settings },
    dev: {},
  };
}

/** 事件脱敏：他人摸牌不带牌面；AI 挑战成功不带被挑战者手牌 */
export function sanitizeEventsForSeat(events: readonly GameEvent[], seat: number): GameEvent[] {
  return events.map((event) => {
    if (event.type === 'DRAW') {
      if (event.seat === seat) return event;
      return { type: 'DRAW', seat: event.seat, count: event.count, cards: [] };
    }
    if (event.type === 'CHALLENGE_SUCCESS') {
      if (event.challenger === seat && event.hand) {
        return {
          type: 'CHALLENGE_SUCCESS',
          challenger: event.challenger,
          target: event.target,
          hand: event.hand.map((card) => ({ ...card })),
        };
      }
      return { type: 'CHALLENGE_SUCCESS', challenger: event.challenger, target: event.target };
    }
    return event;
  });
}

/** 给某个 UI 动作生成中文 label */
function labelFor(action: EngineAction, card: Card | null, state: GameState): string {
  switch (action.type) {
    case 'PLAY_CARD':
    case 'PLAY_DRAWN':
    case 'STACK_PLAY': {
      const prefix =
        action.type === 'STACK_PLAY' ? '叠 ' : action.type === 'PLAY_DRAWN' ? '出 ' : '出 ';
      if (!card) return `${prefix}一张牌`;
      if (action.colorChoice)
        return `${prefix}${cardLabel(card)} · ${COLOR_NAME[action.colorChoice]}`;
      return `${prefix}${cardLabel(card)}`;
    }
    case 'DRAW':
      return '摸 1 张';
    case 'END_TURN':
      return '结束回合';
    case 'CHOOSE_COLOR':
      return `${COLOR_NAME[action.color]}色`;
    case 'STACK_DECLINE':
      return `放弃叠牌（摸 ${state.stack?.total ?? 0} 张）`;
    case 'CHALLENGE_W4':
      return '挑战！查看手牌';
    case 'DECLINE_CHALLENGE':
      return '摸 4 张';
    case 'CALL_UNO':
      return 'UNO!';
    case 'CATCH_UNO':
      return '抓他！';
    default:
      return '操作';
  }
}

/** 给某个 UI 动作生成提示条文字（hintFor 会优先展示第一个 hint） */
function hintFor(action: EngineAction, state: GameState): string {
  switch (action.type) {
    case 'PLAY_CARD':
    case 'PLAY_DRAWN': {
      return '高亮的牌可以打出，点击直接出牌';
    }
    case 'STACK_PLAY':
      return `继续叠牌，让下家摸 ${(state.stack?.total ?? 0) + 2} 张以上`;
    case 'DRAW':
      return '没有合适的牌？摸一张';
    case 'END_TURN':
      return '结束本回合';
    case 'CHOOSE_COLOR':
      return '请选择万能牌的颜色';
    case 'STACK_DECLINE':
      return `放弃叠牌，摸 ${state.stack?.total ?? 0} 张`;
    case 'CHALLENGE_W4':
      return '怀疑上家 +4 违规？挑战并查看他的手牌';
    case 'DECLINE_CHALLENGE':
      return '接受 +4，摸 4 张并失去回合';
    case 'CALL_UNO':
      return '只剩最后一张，快喊 UNO';
    case 'CATCH_UNO':
      return '发现有人忘了喊 UNO，抓住他';
    default:
      return '';
  }
}

/** 该动作涉及的手牌（用于 label；窗口动作没有） */
function cardForAction(action: EngineAction, state: GameState): Card | null {
  if (action.type === 'PLAY_CARD' || action.type === 'STACK_PLAY') {
    return state.players[state.currentSeat]?.hand.find((card) => card.id === action.cardId) ?? null;
  }
  if (action.type === 'PLAY_DRAWN') return state.drawnThisTurn;
  return null;
}

/** 动作唯一 id（同一次渲染里不重复即可） */
function idFor(action: EngineAction): string {
  switch (action.type) {
    case 'PLAY_CARD':
      return `play:${action.cardId}:${action.colorChoice ?? '-'}`;
    case 'PLAY_DRAWN':
      return `play-drawn:${action.cardId}:${action.colorChoice ?? '-'}`;
    case 'STACK_PLAY':
      return `stack:${action.cardId}:${action.colorChoice ?? '-'}`;
    case 'CHOOSE_COLOR':
      return `choose-color:${action.color}`;
    case 'CATCH_UNO':
      return `catch:${action.targetSeat}`;
    default:
      return action.type.toLowerCase();
  }
}

/** 引擎动作 → UI 动作（带展示信息） */
export function toUiAction(action: EngineAction, state: GameState): UiAction {
  const card = cardForAction(action, state);
  const uiAction: UiAction = {
    id: idFor(action),
    type: action.type,
    label: labelFor(action, card, state),
    disabled: false,
    hint: hintFor(action, state),
  };
  if ('cardId' in action) uiAction.cardId = action.cardId;
  if ('colorChoice' in action && action.colorChoice) uiAction.colorChoice = action.colorChoice;
  if ('color' in action) uiAction.color = action.color;
  if ('targetSeat' in action) uiAction.targetSeat = action.targetSeat;
  return uiAction;
}

/** UiAction → 引擎动作（UI 只做转发，合法性仍由引擎 applyAction 校验） */
export function toEngineAction(uiAction: UiAction): EngineAction {
  switch (uiAction.type) {
    case 'PLAY_CARD':
      if (!uiAction.cardId) throw new Error('PLAY_CARD 缺少 cardId');
      return {
        type: 'PLAY_CARD',
        cardId: uiAction.cardId,
        ...(uiAction.colorChoice ? { colorChoice: uiAction.colorChoice } : {}),
      };
    case 'PLAY_DRAWN':
      if (!uiAction.cardId) throw new Error('PLAY_DRAWN 缺少 cardId');
      return {
        type: 'PLAY_DRAWN',
        cardId: uiAction.cardId,
        ...(uiAction.colorChoice ? { colorChoice: uiAction.colorChoice } : {}),
      };
    case 'STACK_PLAY':
      if (!uiAction.cardId) throw new Error('STACK_PLAY 缺少 cardId');
      return {
        type: 'STACK_PLAY',
        cardId: uiAction.cardId,
        ...(uiAction.colorChoice ? { colorChoice: uiAction.colorChoice } : {}),
      };
    case 'CHOOSE_COLOR':
      if (!uiAction.color) throw new Error('CHOOSE_COLOR 缺少 color');
      return { type: 'CHOOSE_COLOR', color: uiAction.color };
    case 'CATCH_UNO':
      if (uiAction.targetSeat === undefined) throw new Error('CATCH_UNO 缺少 targetSeat');
      return { type: 'CATCH_UNO', targetSeat: uiAction.targetSeat };
    case 'DRAW':
    case 'END_TURN':
    case 'STACK_DECLINE':
    case 'CHALLENGE_W4':
    case 'DECLINE_CHALLENGE':
    case 'CALL_UNO':
      return { type: uiAction.type };
    default:
      throw new Error(`未知 UI 动作类型：${String(uiAction.type)}`);
  }
}

/**
 * 人类当前可交互的动作：
 * - AI 回合：通常为空（UI 只做展示）；
 * - `uno-window`：人类始终能看到窗口动作（喊/抓），且如果窗口关闭后轮到人类，也包含待执行动作。
 */
export function getHumanLegalActions(state: GameState, seat: number): UiAction[] {
  if (state.phase === 'round-end') return [];
  const legal = getLegalActions(state);
  if (state.phase === 'uno-window') {
    const windowActions: EngineAction[] = legal.filter(
      (action) => action.type === 'CALL_UNO' || action.type === 'CATCH_UNO',
    );
    const pendingActions =
      state.currentSeat === seat ? legal.filter((action) => !windowActions.includes(action)) : [];
    return [...windowActions, ...pendingActions].map((action) => toUiAction(action, state));
  }
  if (state.currentSeat !== seat) return [];
  return legal.map((action) => toUiAction(action, state));
}

/** 从整局历史里还原每位玩家最近打出的牌（公开信息） */
function lastPlayedBySeat(state: GameState): Map<number, Card> {
  const map = new Map<number, Card>();
  for (const event of state.history) {
    if (event.type === 'PLAY') map.set(event.seat, { ...event.card });
  }
  return map;
}

/** 结算映射（M1-7 getResult → 契约 result） */
export function toPublicResult(state: GameState, durationMs = 0): PublicResult {
  const result = getResult(state, { durationMs });
  return {
    winnerSeat: result.winnerSeat,
    isDraw: result.isDraw,
    reason: result.reason,
    players: result.players.map((player) => ({
      seat: player.seat,
      name: player.name,
      isHuman: player.isHuman,
      remaining: player.remaining,
      score: player.score,
      saidUno: player.saidUno,
    })),
    turns: result.turns,
    actions: result.actions,
    draws: result.draws,
    plays: result.plays,
    stackPlays: result.stackPlays,
    unoCalls: result.unoCalls,
    durationMs: result.durationMs,
  };
}

/** 把引擎状态投影成 UI 契约 view（所有隐藏信息在此过滤） */
export function getGameView(
  state: GameState,
  seat: number,
  options: { durationMs?: number; settings?: Partial<ViewSettings> } = {},
): GameView {
  if (!state.players[seat])
    throw new RangeError(`座位 ${seat} 不存在（共 ${state.players.length} 人）`);

  const human = state.players[seat]!;
  const lastPlayed = lastPlayedBySeat(state);
  const roundEnded = state.phase === 'round-end';

  return {
    mock: false,
    screen: roundEnded ? 'result' : 'game',
    phase: state.phase,
    config: {
      playerCount: state.players.length,
      difficulty: state.config.aiDifficulty,
      aiMode: state.config.aiMode,
      challengeWild4: state.config.challengeWild4,
    },
    currentSeat: state.currentSeat,
    direction: state.direction,
    currentColor: state.currentColor,
    players: state.players.map((player) => ({
      seat: player.seat,
      name: player.name,
      isHuman: player.isHuman,
      avatar: player.isHuman ? '🧑' : '🤖',
      handCount: player.hand.length,
      saidUno: player.saidUno,
      thinking: false,
      lastPlayed: lastPlayed.get(player.seat) ?? null,
      line: '',
      difficulty: player.isHuman ? null : state.config.aiDifficulty,
    })),
    human: {
      seat,
      hand: human.hand.map((card) => ({ ...card })),
      legalActions: getHumanLegalActions(state, seat),
      drawnThisTurn: state.drawnThisTurn ? { ...state.drawnThisTurn } : null,
      mustRespondStack: state.phase === 'stack-response' && state.currentSeat === seat,
      canCallUno: Boolean(
        state.unoWindow && state.unoWindow.seat === seat && state.unoWindow.canCall,
      ),
      canCatch:
        state.unoWindow && state.unoWindow.seat !== seat ? [...state.unoWindow.canCatch] : [],
      pendingChallenge:
        state.pendingChallenge && state.pendingChallenge.challengerSeat === seat
          ? { opponentSeat: state.pendingChallenge.targetSeat }
          : null,
    },
    table: {
      discardTop:
        state.discardPile.length > 0
          ? { ...state.discardPile[state.discardPile.length - 1]! }
          : null,
      discardTop3: [...state.discardPile]
        .slice(-3)
        .reverse()
        .map((card) => ({ ...card })),
      drawPileCount: state.drawPile.length,
      stack: state.stack
        ? {
            total: state.stack.total,
            chain: state.stack.chain.map((card) => ({ ...card })),
            lastPlayer: state.stack.lastPlayer,
            topColor: state.stack.topColor,
            awaitingSeat: state.stack.awaitingSeat,
          }
        : null,
      pendingColorChoice: state.phase === 'choose-color',
      winnerSeat: state.winnerSeat,
    },
    events: sanitizeEventsForSeat(state.events, seat),
    result: roundEnded ? toPublicResult(state, options.durationMs ?? 0) : null,
    settings: { ...DEFAULT_VIEW_SETTINGS, ...options.settings },
    dev: {},
  };
}
