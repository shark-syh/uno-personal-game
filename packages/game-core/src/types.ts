/**
 * UNO 规则引擎核心类型（M1 阶段）。
 *
 * 字段命名与 `UI开发提示词.md` 第 1 节的契约保持一致，后续对接时不要随意改名。
 */

/** 四种颜色 */
export type Color = 'red' | 'yellow' | 'green' | 'blue';

/** 牌型：数字 / 跳过 / 反转 / +2 / 万能 / +4 万能 */
export type CardKind = 'number' | 'skip' | 'reverse' | 'draw2' | 'wild' | 'wild4';

/** AI 难度四档（M2 阶段使用，类型先就位） */
export type Difficulty = 'casual' | 'easy' | 'realistic' | 'hardcore';

/** AI 决策来源：智谱 / 纯本地 / 自动降级 */
export type AiMode = 'zhipu' | 'local' | 'auto';

/** 先手方式：随机 / 强制人类先手（调试用） */
export type StartingPlayer = 'random' | 'human';

/** 起手翻牌为动作牌时的处理：原版结算 / 忽略动作牌重新翻 */
export type StartCardRule = 'classic' | 'ignore-action';

/** 叠加模式：本作固定宽松叠法，保留配置位 */
export type StackingMode = 'loose' | 'classic' | 'none';

/** 抽牌堆耗尽策略：洗回弃牌堆 / 按手牌最少者结束 */
export type DeckExhaustion = 'reshuffle' | 'end-by-fewest';

/** Wild+4 合法性判定：经典只看当前颜色 / 新版把手中 Wild 也算作"可替代牌" */
export type Wild4Legality = 'color-only' | 'new-version';

/** 顺时针 1 / 逆时针 -1 */
export type Direction = 1 | -1;

/** 一张牌 */
export interface Card {
  /** 全局唯一，如 "R7#0" */
  id: string;
  kind: CardKind;
  /** wild / wild4 为 null */
  color: Color | null;
  /** 数字牌 0-9，其余为 null */
  value: number | null;
  /** 卡面资源码，对应 apps/web/cards/{faceCode}.png，如 "R7" / "BA2" / "WC" / "W4" */
  faceCode: string;
}

/** 对局配置（默认值见 config.ts 的 DEFAULT_GAME_CONFIG） */
export interface GameConfig {
  /** 总人数 2~10（人类 1 人 + 其余 AI） */
  playerCount: number;
  /** 人类座位，本期固定为 0 */
  humanSeat: number;
  /** 自定义玩家名（null 表示自动生成） */
  names: string[] | null;
  /** AI 难度（M2 使用） */
  aiDifficulty: Difficulty;
  /** AI 决策来源（M4 使用） */
  aiMode: AiMode;
  startingPlayer: StartingPlayer;
  startCardRule: StartCardRule;
  stacking: StackingMode;
  /** 2 人特殊规则（Reverse=Skip、连动等） */
  twoPlayerRules: boolean;
  deckExhaustion: DeckExhaustion;
  challengeWild4: boolean;
  /** Wild+4 合法性判定口径（M1-5 挑战时使用） */
  wild4Legality: Wild4Legality;
  /** UNO 被抓罚牌数，默认 2 */
  unoPenalty: number;
  /** 是否自动喊 UNO（默认手动，更还原） */
  autoCallUno: boolean;
  /** 随机种子：相同种子可完全复现对局；不传则随机 */
  seed: string | number | undefined;
}

/** 对局阶段（与 UI 契约一致） */
export type GamePhase =
  | 'lobby'
  | 'dealing'
  | 'turn-start'
  | 'await-play'
  | 'choose-color'
  | 'stack-response'
  | 'challenge-decide'
  | 'uno-window'
  | 'turn-end'
  | 'round-end';

/** 玩家状态 */
export interface PlayerState {
  seat: number;
  name: string;
  isHuman: boolean;
  hand: Card[];
  saidUno: boolean;
}

/** 可序列化的 RNG 状态（mulberry32） */
export interface RngState {
  seed: number;
  value: number;
}

/** 对局事件（UI 动画 / 测试断言 / 回放都用它） */
export type GameEvent =
  | { type: 'DEAL'; seat: number; count: number }
  | { type: 'START_CARD'; card: Card }
  | { type: 'START_CARD_IGNORED'; card: Card }
  | { type: 'PLAY'; seat: number; card: Card }
  | { type: 'COLOR_SET'; seat: number; color: Color }
  | { type: 'SKIP'; seat: number }
  | { type: 'REVERSE'; direction: Direction }
  | { type: 'DRAW'; seat: number; count: number; cards: Card[] }
  | { type: 'PILE_RESHUFFLE'; reason: 'wild4-start' | 'ignore-action' | 'draw' }
  | { type: 'PLAYER_OUT'; seat: number }
  // M1-7：对局结束。winnerSeat 为 null 表示平局（牌堆耗尽且手牌最少者并列）；
  // reason 区分"出完手牌获胜"与"牌堆耗尽按手牌最少者判定"
  | { type: 'ROUND_END'; winnerSeat: number | null; reason: 'empty-hand' | 'deck-empty' }
  // M1-4 叠牌链：每有一张 +2/+4 加入链中就发一次（total 为加入后的累计数）
  | { type: 'STACK_PUSH'; seat: number; card: Card; total: number }
  // M1-4 叠牌链结算：seat 为需要摸牌的人，total 为累计要摸的张数
  | { type: 'STACK_RESOLVE'; seat: number; total: number }
  // M1-5 +4 挑战成功：挑战者查看被挑战者手牌，判定其违规（有当前颜色牌）。
  // hand 仅在"挑战者是人类"时携带（完整手牌快照，供 UI 展示；AI 挑战时不泄露给其他玩家）。
  | { type: 'CHALLENGE_SUCCESS'; challenger: number; target: number; hand?: Card[] }
  // M1-5 +4 挑战失败：挑战者摸 penalty 张（4+2=6）并失去回合
  | { type: 'CHALLENGE_FAIL'; challenger: number; target: number; penalty: number }
  // M1-6 UNO 喊牌：某玩家出牌后剩 1 张并成功喊出 UNO
  | { type: 'UNO_CALLED'; seat: number }
  // M1-6 UNO 被抓住：seat 罚摸 penalty 张（默认 2）
  | { type: 'UNO_CAUGHT'; seat: number; penalty: number };

/** 引擎动作（人类/AI/演示脚本通用） */
export type EngineAction =
  | { type: 'PLAY_CARD'; cardId: string; colorChoice?: Color }
  | { type: 'DRAW' }
  | { type: 'PLAY_DRAWN'; cardId: string; colorChoice?: Color }
  | { type: 'END_TURN' }
  | { type: 'CHOOSE_COLOR'; color: Color }
  // M1-4 叠牌响应：打出 +2/+4 继续叠牌（Wild+4 需带 colorChoice）
  | { type: 'STACK_PLAY'; cardId: string; colorChoice?: Color }
  // M1-4 叠牌响应：放弃叠牌，摸累计张数（单张 +4 链会先进入挑战窗口）
  | { type: 'STACK_DECLINE' }
  // M1-5 +4 挑战：挑战者查看出牌者手牌并判定（出牌者违规 → 成功）
  | { type: 'CHALLENGE_W4' }
  // M1-5 +4 挑战：接受原版效果，摸 4 张并失去回合
  | { type: 'DECLINE_CHALLENGE' }
  // M1-6 UNO：出牌后剩 1 张的玩家喊 UNO
  | { type: 'CALL_UNO' }
  // M1-6 UNO：抓住某个忘喊 UNO 的玩家（罚其摸 2 张）；抓人者不消耗自己的行动
  | { type: 'CATCH_UNO'; targetSeat: number };

/** Wild+4 打出记录（隐藏信息：只有挑战判定时才使用，不进入公开视图） */
export interface Wild4PlayInfo {
  /** 打出 +4 的玩家 */
  seat: number;
  /** 打出时是否合法（手上没有当前颜色牌） */
  wasLegal: boolean;
  /** 打出前的颜色（挑战判定依据） */
  previousColor: Color | null;
  /** 是否允许挑战（叠牌链中不开放，M1-4 使用） */
  challengeable: boolean;
  /** 打出时的回合数 */
  turn: number;
}

/**
 * 叠牌链状态（宽松叠法，见 `开发计划.md` 4.5）。
 * 仅在 `phase === 'stack-response'` 时非 null；与 UNO 窗口重叠时（uno-window 阶段）也可能非 null。
 */
export interface StackState {
  /** 累计要摸的张数 */
  total: number;
  /** 已打出的叠牌链（按顺序，末尾为链顶） */
  chain: Card[];
  /** 最后一张叠牌的出牌者 */
  lastPlayer: number;
  /** 最后一张叠牌结算后的颜色（+4 为出牌者所选颜色） */
  topColor: Color;
  /** 当前必须做出响应的玩家 */
  awaitingSeat: number;
}

/**
 * +4 挑战窗口状态（M1-5，见 `开发计划.md` 4.6）。
 * 仅在 `phase === 'challenge-decide'` 时非 null：有挑战权的玩家二选一（挑战 / 接受摸 4）。
 */
export interface PendingChallenge {
  /** 有挑战权的玩家：被 +4 指向的下一位（正常回合打出 +4 后的下家） */
  challengerSeat: number;
  /** 打出 +4 的玩家（被挑战者） */
  targetSeat: number;
  /** 接受挑战时挑战者要摸的张数（+4 效果，默认 4） */
  total: number;
}

/**
 * UNO 窗口状态（M1-6，见 `开发计划.md` 4.7）。
 * 仅在 `phase === 'uno-window'` 时非 null：某玩家出牌后手牌恰好剩 1 张且还没喊 UNO。
 * 窗口是"下一步行动之前"的反应窗口：下一位玩家一行动就关闭（同时结算 AI 抓人概率）。
 */
export interface UnoWindowState {
  /** 需要喊 UNO 的玩家 */
  seat: number;
  /** 人类（座位 0）可以抓的座位号；目标为人类自己时为空 */
  canCatch: number[];
  /** 该玩家是否还能主动喊 UNO（只有"人类忘记喊"时为 true；AI 已经在出牌时掷过概率） */
  canCall: boolean;
  /** 窗口关闭后恢复的阶段（叠牌/挑战会与 UNO 窗口重叠） */
  pendingPhase: 'await-play' | 'stack-response' | 'challenge-decide';
}

/** 对局状态（M1-4：宽松叠牌链） */
export interface GameState {
  config: GameConfig;
  phase: GamePhase;
  players: PlayerState[];
  /** 抽牌堆：数组末尾为堆顶（pop 抽牌） */
  drawPile: Card[];
  /** 弃牌堆：数组末尾为顶牌 */
  discardPile: Card[];
  /** 当前有效颜色；起手为 Wild 等待选色时为 null */
  currentColor: Color | null;
  currentSeat: number;
  direction: Direction;
  dealerSeat: number;
  /** 等待选色的玩家座位（起手 Wild 时非 null） */
  pendingColorChoiceSeat: number | null;
  /** 本回合刚抽到的牌；非 null 时只能出这张或结束回合 */
  drawnThisTurn: Card | null;
  /** 叠牌链；仅 stack-response 阶段非 null（M1-4） */
  stack: StackState | null;
  /** 最近一次 Wild+4 的打出记录（隐藏信息，M1-5 挑战使用） */
  wild4Info: Wild4PlayInfo | null;
  /** +4 挑战窗口；仅 challenge-decide 阶段非 null（M1-5） */
  pendingChallenge: PendingChallenge | null;
  /** UNO 窗口；仅 uno-window 阶段非 null（M1-6） */
  unoWindow: UnoWindowState | null;
  turnCount: number;
  /** 已成功执行的动作数（getResult 统计用） */
  actionCount: number;
  /** 获胜者座位；null 表示对局未结束或平局（配合 phase/endReason 判断） */
  winnerSeat: number | null;
  /** 对局结束原因；未结束时为 null（M1-7） */
  endReason: 'empty-hand' | 'deck-empty' | null;
  /** 本次动作产生的事件（UI 消费后清空） */
  events: GameEvent[];
  /** 整局事件历史（回放/调试用） */
  history: GameEvent[];
  rng: RngState;
}

/** 单个玩家的结算数据（见 `开发计划.md` 4.10） */
export interface PlayerResult {
  seat: number;
  name: string;
  isHuman: boolean;
  /** 剩余手牌（结算页展示） */
  remaining: Card[];
  /** 趣味分数：数字=面值，动作牌=20，万能牌=50（不决定胜负） */
  score: number;
  saidUno: boolean;
}

/** 对局结算结果（getResult 返回；字段对齐 UI 契约的 result，平局时 winnerSeat=null） */
export interface GameResult {
  /** 获胜者座位；null 表示平局（牌堆耗尽且手牌最少者并列） */
  winnerSeat: number | null;
  /** 是否平局 */
  isDraw: boolean;
  reason: 'empty-hand' | 'deck-empty';
  players: PlayerResult[];
  /**
   * 赢家本局得分（官方 UNO 计分口径）：对手剩余手牌趣味分之和；仅结算展示，不决定胜负。
   * 平局（winnerSeat=null）时为 0。
   */
  winnerScore: number;
  /** 回合数（turnCount） */
  turns: number;
  /** 已执行动作数 */
  actions: number;
  /** 累计摸牌数 */
  draws: number;
  /** 出牌次数（PLAY 事件数） */
  plays: number;
  /** 叠牌加入链的次数 */
  stackPlays: number;
  /** 成功喊 UNO 的次数 */
  unoCalls: number;
  /** 对局时长（毫秒）；引擎不记录时钟，由调用方（UI）传入，默认 0 */
  durationMs: number;
}
