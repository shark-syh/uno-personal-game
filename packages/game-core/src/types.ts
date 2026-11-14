/**
 * UNO 规则引擎核心类型（M1 阶段）。
 *
 * 字段命名与 `docs/UI开发提示词.md` 第 1 节的契约保持一致，后续对接时不要随意改名。
 */

/** 四种颜色 */
export type Color = 'red' | 'yellow' | 'green' | 'blue';

/**
 * 玩法模式（三模式升级 · M1）。
 * - classic：标准 108 张，现有行为完全不变；
 * - mercy：UNO Show 'Em No Mercy，168 张（牌表见 deck.ts）；
 * - flip：UNO Flip，112 张双面牌，方案已写、后续阶段实现（M1 起遇到会明确抛错）。
 */
export type GameMode = 'classic' | 'flip' | 'mercy';

/**
 * 牌型并集：基础版 6 种 + 友尽版新增 7 种。
 * 友尽版不含普通 wild / wild4，由四类新万能牌取代（见 docs/三模式升级-友尽模式规则契约.md）。
 */
export type CardKind =
  | 'number'
  | 'skip'
  | 'reverse'
  | 'draw2'
  | 'wild'
  | 'wild4'
  | 'draw4'
  | 'skipEveryone'
  | 'discardAll'
  | 'draw6'
  | 'draw10'
  | 'wildReverseDraw4'
  | 'wildColorRoulette';

/** AI 难度四档（M2 阶段使用，类型先就位） */
export type Difficulty = 'casual' | 'easy' | 'realistic' | 'hardcore';

/** AI 决策来源：智谱 / 纯本地 / 自动降级 */
export type AiMode = 'zhipu' | 'local' | 'auto';

/** 先手方式：随机 / 强制人类先手（调试用） */
export type StartingPlayer = 'random' | 'human';

/** 起手翻牌为动作牌时的处理：原版结算 / 忽略动作牌重新翻 */
export type StartCardRule = 'classic' | 'ignore-action';

/**
 * 叠加模式：基础版宽松叠法；友尽版 M2 起为 official（只能叠等值或更高罚牌）。
 * classic 配置项保留但本期仍按 loose 处理（历史行为不变）。
 */
export type StackingMode = 'loose' | 'classic' | 'none' | 'official';

/** 对局结束原因：出完手牌 / 牌堆耗尽按手牌最少 / 友尽模式其余玩家全被淘汰 */
export type RoundEndReason = 'empty-hand' | 'deck-empty' | 'last-survivor';

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
  /** 万能牌为 null（基础 wild/wild4 与友尽四类新万能牌） */
  color: Color | null;
  /** 数字牌 0-9，其余为 null */
  value: number | null;
  /**
   * 卡面资源码。classic 对应 apps/web/cards/{faceCode}.png（如 "R7" / "BA2" / "WC" / "W4"）；
   * mercy 对应 B 版资源文件名（如 "two-draw-red" / "seven-swap-blue" / "wild-ten-draw"），
   * 由后续阶段按 mode 切换资源目录，不在本阶段改动现有 54 张 PNG。
   */
  faceCode: string;
}

/** 对局配置（默认值见 config.ts 的 DEFAULT_GAME_CONFIG） */
export interface GameConfig {
  /** 玩法模式：默认 classic，保证所有既有调用零改动 */
  mode: GameMode;
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
  | 'choose-swap-target'
  | 'choose-roulette-color'
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
  /** 友尽模式：手牌 ≥25 张被淘汰（可选，classic 恒为 false） */
  eliminated?: boolean;
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
  // reason 区分"出完手牌获胜" / "牌堆耗尽按手牌最少者判定" / 友尽"最后幸存者"
  | { type: 'ROUND_END'; winnerSeat: number | null; reason: RoundEndReason }
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
  | { type: 'UNO_CAUGHT'; seat: number; penalty: number }
  // M2 友尽：7 换手（与指定座位交换整副手牌）
  | { type: 'SWAP_HANDS'; seat: number; targetSeat: number }
  // M2 友尽：0 传手（全体活跃玩家按当前方向传递手牌）
  | { type: 'PASS_HANDS'; direction: Direction }
  // M2 友尽：全员跳过（出牌者立即再来一回合，方向不变）
  | { type: 'SKIP_EVERYONE'; seat: number }
  // M2 友尽：全弃（同色牌压在该牌下方）
  | { type: 'DISCARD_ALL'; seat: number; count: number }
  // M2 友尽：颜色轮盘由下家选色
  | { type: 'COLOR_ROULETTE'; seat: number; color: Color }
  // M2 友尽：轮盘抽牌途中牌堆与弃牌堆同时耗尽，停止抽牌并跳过该回合
  | { type: 'ROULETTE_EXHAUSTED'; seat: number }
  // M2 友尽：手牌 ≥25 张立即出局，手牌搁置（重洗时放回）
  | { type: 'MERCY_ELIMINATED'; seat: number; count: number };

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
  | { type: 'CATCH_UNO'; targetSeat: number }
  // M2 友尽：7 换手选目标（官方强制，无「不换」选项）
  | { type: 'SWAP_HANDS'; targetSeat: number }
  // M2 友尽：Wild 颜色轮盘由下家选色
  | { type: 'CHOOSE_ROULETTE_COLOR'; color: Color };

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
 * 叠牌链状态（宽松叠法，见 `docs/开发计划.md` 4.5）。
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
  /** official 口径：链顶罚牌值，只有 ≥ 该值的罚牌才能继续叠（可选，loose 不使用） */
  topDrawValue?: number;
}

/**
 * +4 挑战窗口状态（M1-5，见 `docs/开发计划.md` 4.6）。
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
 * UNO 窗口状态（M1-6，见 `docs/开发计划.md` 4.7）。
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
  /** 对局结束原因；未结束时为 null（M1-7；M2 新增 last-survivor） */
  endReason: RoundEndReason | null;
  /** M2 友尽：7 换手待选目标（仅 choose-swap-target 阶段非 null） */
  pendingSwap?: { initiatorSeat: number } | null;
  /** M2 友尽：颜色轮盘等待下家选色（仅 choose-roulette-color 阶段非 null） */
  roulette?: { initiatorSeat: number; chooserSeat: number; targetColor: Color | null } | null;
  /** M2 友尽：淘汰者搁置的手牌，抽牌堆耗尽重洗弃牌堆时放回 */
  parkedCards?: Card[];
  /** 本次动作产生的事件（UI 消费后清空） */
  events: GameEvent[];
  /** 整局事件历史（回放/调试用） */
  history: GameEvent[];
  rng: RngState;
}

/** 单个玩家的结算数据（见 `docs/开发计划.md` 4.10；2026-10-18 起取消计分，改为操作统计图表） */
export interface PlayerResult {
  seat: number;
  name: string;
  isHuman: boolean;
  /** 剩余手牌（结算页展示） */
  remaining: Card[];
  saidUno: boolean;
  /** 本局出牌次数（PLAY 事件数） */
  plays: number;
  /** 本局摸牌张数（DRAW 事件 count 之和） */
  draws: number;
  /** 本局叠牌次数（STACK_PUSH 事件数） */
  stackPlays: number;
  /** 本局成功喊 UNO 次数 */
  unoCalls: number;
  /** 本局被抓 UNO 次数 */
  unoCaught: number;
  /** 本局发起 +4 挑战次数（挑战成功/失败都算一次） */
  challenges: number;
}

/** 对局结算结果（getResult 返回；字段对齐 UI 契约的 result，平局时 winnerSeat=null） */
export interface GameResult {
  /** 获胜者座位；null 表示平局（牌堆耗尽且手牌最少者并列） */
  winnerSeat: number | null;
  /** 是否平局 */
  isDraw: boolean;
  reason: RoundEndReason;
  players: PlayerResult[];
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
  /** 发起 +4 挑战的总次数 */
  challenges: number;
  /** 对局时长（毫秒）；引擎不记录时钟，由调用方（UI）传入，默认 0 */
  durationMs: number;
}
