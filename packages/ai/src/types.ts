/**
 * UNO 本地启发式 AI 的类型定义（M2）。
 *
 * 依赖 `@uno/game-core` 的规则引擎类型；本包**不修改**引擎契约，
 * 只通过 `getLegalActions` / `applyAction` 等公开 API 与引擎交互。
 */
import type {
  Card,
  Color,
  DeckExhaustion,
  Difficulty,
  Direction,
  EngineAction,
  GameEvent,
  GamePhase,
  RngState,
  StackingMode,
  Wild4Legality,
} from '@uno/game-core';

export type { Difficulty } from '@uno/game-core';

/** 候选动作类别（与 `CandidateKind` 一一对应 UI/LLM 可读的分类） */
export type CandidateKind =
  | 'play'
  | 'play-drawn'
  | 'draw'
  | 'end-turn'
  | 'choose-color'
  | 'stack-play'
  | 'stack-decline'
  | 'challenge'
  | 'decline-challenge';

/**
 * 公开视图（AI 唯一可见的数据）。
 *
 * `getAiView(state, seat)` 只暴露：自己的手牌、所有玩家的**手牌数量**与公开状态、
 * 弃牌堆（公开）、抽牌堆张数、叠牌链、挑战/UNO 窗口的公开字段、已脱敏的事件历史。
 * 绝不包含其他玩家手牌、`wild4Info`（是否合法属于隐藏信息）等。
 */
export interface AiPlayerView {
  seat: number;
  name: string;
  isHuman: boolean;
  handCount: number;
  saidUno: boolean;
}

/** 叠牌链的公开快照 */
export interface AiStackView {
  total: number;
  chain: Card[];
  lastPlayer: number;
  topColor: Color;
  awaitingSeat: number;
}

/** +4 挑战窗口的公开快照 */
export interface AiChallengeView {
  challengerSeat: number;
  targetSeat: number;
  total: number;
}

/** UNO 窗口的公开快照（AI 的喊/抓由引擎按难度概率自动结算，决策层不产出窗口动作） */
export interface AiUnoWindowView {
  seat: number;
  canCall: boolean;
  canCatch: number[];
}

/** AI 可见的对局配置子集 */
export interface AiViewConfig {
  playerCount: number;
  humanSeat: number;
  deckExhaustion: DeckExhaustion;
  stacking: StackingMode;
  challengeWild4: boolean;
  twoPlayerRules: boolean;
  unoPenalty: number;
  wild4Legality: Wild4Legality;
}

/** AI 公开视图 */
export interface AiView {
  seat: number;
  phase: GamePhase;
  currentSeat: number;
  direction: Direction;
  currentColor: Color | null;
  turnCount: number;
  config: AiViewConfig;
  /** 自己的手牌 */
  hand: Card[];
  /** 所有玩家的公开信息（手牌数量而非内容） */
  players: AiPlayerView[];
  /** 弃牌堆（公开，末尾为顶牌） */
  discardPile: Card[];
  /** 当前顶牌 */
  topCard: Card | null;
  /** 抽牌堆剩余张数（公开） */
  drawPileCount: number;
  /** 本回合刚抽到的牌（仅当前行动者可见） */
  drawnThisTurn: Card | null;
  stack: AiStackView | null;
  pendingChallenge: AiChallengeView | null;
  unoWindow: AiUnoWindowView | null;
  /** 脱敏后的事件历史：他人摸牌不携带牌面；挑战成功不携带被挑战者手牌 */
  history: GameEvent[];
}

/** 单张候选的特征（全部归一化到 0~1，便于加权与调参） */
export interface CandidateFeatures {
  /** 出牌使手牌减少（1=出牌，0=不减少） */
  handReduction: number;
  /** 攻击性：Skip / Reverse / +2 / +4 压制下家的价值 */
  attack: number;
  /** 出牌后手中同色牌比例（颜色控制，越高越能保持出牌选择） */
  colorKeep: number;
  /** 出牌后自己还剩多少"下一手可出"的牌（保持牌型灵活，越高越好） */
  followUp: number;
  /** 此刻打出万能牌的"浪费"代价（越早越大） */
  wildCost: number;
  /** 终局价值：出完 / 只剩 1 张 / 阻止下家 */
  endgame: number;
  /** 下家威胁响应：对手手牌越少，动作牌越关键 */
  threat: number;
  /** 叠牌响应阶段的收益（仅 STACK_PLAY） */
  stackGain: number;
  /** 摸牌代价（DRAW / STACK_DECLINE / END_TURN 使用） */
  drawCost: number;
  /** 手持当前颜色牌仍出 +4 时被挑战的风险成本（仅普通回合 +4） */
  bluffRisk: number;
  /** 颜色选择：下家缺该色的概率（越高越好） */
  nextPlayerWeakColor: number;
  /** 颜色选择：自己手中该色比例（越高越好） */
  colorFit: number;
  /** 挑战成功率估计（仅 CHALLENGE_W4） */
  challengeSuccess: number;
  /** 挑战失败风险（仅 CHALLENGE_W4） */
  challengeRisk: number;
}

/** 一个候选动作 + 特征 + 评分 + 一句中文理由（供日志 / M4 LLM 参考） */
export interface Candidate {
  /** 唯一 id，如 "PLAY_CARD:R7#0:-" */
  id: string;
  kind: CandidateKind;
  action: EngineAction;
  card: Card | null;
  colorChoice: Color | null;
  features: CandidateFeatures;
  /** 0~1 的展示分（对候选集做 min-max 归一化后） */
  score: number;
  /** 加权原始分（含难度噪声） */
  rawScore: number;
  /** 中文一句话，如 "打红7：保留 3 张红牌" */
  note: string;
}

/** 决策结果 */
export interface AiDecision {
  seat: number;
  difficulty: Difficulty;
  action: EngineAction;
  candidate: Candidate;
  /** 按 rawScore 降序排列的全部候选 */
  candidates: Candidate[];
  /** 决策理由（中文一句话） */
  reason: string;
  source: 'local';
}

export type MemoryLevel = 'none' | 'colors' | 'full' | 'full-plus';

export type ColorChoiceStrategy = 'most-in-hand' | 'weighted' | 'next-player' | 'bayes';

/** 面对 +4 时的挑战策略 */
export type ChallengeMode = 'random' | 'simple' | 'estimate' | 'ev';

export interface FeatureWeights {
  handReduction: number;
  attack: number;
  colorKeep: number;
  followUp: number;
  wildCost: number;
  endgame: number;
  threat: number;
  stackGain: number;
  drawCost: number;
  bluffRisk: number;
  nextPlayerWeakColor: number;
  colorFit: number;
  challengeSuccess: number;
  challengeRisk: number;
}

export interface ChallengeStrategy {
  mode: ChallengeMode;
  /** `random` 模式下乱挑战的概率（休闲） */
  randomChance: number;
  /** 估算违规概率超过该阈值就挑战（simple/estimate/ev） */
  threshold: number;
  /** 完全没有信息时的先验违规概率 */
  priorIllegal: number;
}

/** 四档难度的参数表（对应 `开发计划.md` 6.4） */
export interface DifficultyProfile {
  difficulty: Difficulty;
  label: string;
  /** 失误率：以该概率从非最优候选中随机挑一个（模拟真人犯错） */
  mistakeRate: number;
  /** 评分噪声幅度（0=无噪声） */
  noise: number;
  memoryLevel: MemoryLevel;
  colorChoice: ColorChoiceStrategy;
  challenge: ChallengeStrategy;
  /** 手持当前颜色牌时仍出 +4（诈唬）的倾向，0=尽量避免 */
  bluffChance: number;
  weights: FeatureWeights;
  /** 一句话说明（文档 / 日志用） */
  description: string;
}

/** AI 记牌器的公开信息统计（按难度档位决定特征是否使用） */
export interface PlayerMemory {
  seat: number;
  isHuman: boolean;
  handCount: number;
  saidUno: boolean;
  /** 该玩家打出过的彩色牌数量（按颜色） */
  colorsPlayed: Record<Color, number>;
  /** 该玩家打出过的动作牌数量（Skip/Reverse/+2/+4） */
  actionCardsPlayed: number;
  wild4Played: number;
  plays: number;
  /** 该玩家公开的摸牌数量 */
  draws: number;
  /** 该玩家作为 +4 出牌者被挑战成功（说明诈唬被抓）的次数 */
  wild4BluffsCaught: number;
  /** 该玩家被证明 +4 合法（挑战失败）的次数 */
  wild4LegalProven: number;
}

/** 记牌器：只用公开信息 + 自己手牌推导 */
export interface AiMemory {
  seat: number;
  /** 每种颜色还剩多少张未公开（初始 25/色：19 数字 + 6 动作） */
  remainingByColor: Record<Color, number>;
  /** 剩余未公开的万能牌数量（初始 4） */
  wildsRemaining: number;
  /** 剩余未公开的 Wild+4 数量（初始 4） */
  wild4Remaining: number;
  /** 剩余未公开的 +2 数量（初始 8） */
  draw2Remaining: number;
  skipRemaining: number;
  reverseRemaining: number;
  /** 未公开总张数（抽牌堆 + 其他玩家手牌） */
  unknownCards: number;
  /** 已公开张数（弃牌堆 + 自己手牌） */
  seenCards: number;
  players: PlayerMemory[];
  challengeSuccesses: number;
  challengeFails: number;
  /** 最近一次 +4 出牌前的颜色（公开信息，挑战概率估计用） */
  colorBeforeLastWild4: Color | null;
}

/** `decide()` 的参数 */
export interface DecideOptions {
  difficulty: Difficulty;
  /** AI 专用随机源（与引擎 rng 分离，保证引擎 seed 仍可复现） */
  rng: RngState;
  /** 可选：复用已算好的记牌结果（批量模拟可提速） */
  memory?: AiMemory;
}

/** 自对弈单局配置 */
export interface SelfPlayGameConfig {
  playerCount: number;
  seed: string | number;
  /** 每个座位使用的难度，长度必须等于 playerCount */
  difficulties: Difficulty[];
  /** 引擎侧 UNO 喊/抓概率使用的全局难度（M1-6 只有一档），默认 realistic */
  engineDifficulty?: Difficulty;
  maxActions?: number;
  deckExhaustion?: DeckExhaustion;
  challengeWild4?: boolean;
  twoPlayerRules?: boolean;
}

/** 自对弈单局结果 */
export interface SelfPlayGameResult {
  seed: string | number;
  playerCount: number;
  difficulties: Difficulty[];
  winnerSeat: number | null;
  isDraw: boolean;
  reason: 'empty-hand' | 'deck-empty';
  turns: number;
  actions: number;
  draws: number;
  plays: number;
  stackPlays: number;
  unoCalls: number;
  challenges: number;
  illegalActions: number;
  errors: string[];
  /** 每步牌数守恒检查是否通过 */
  conservationOk: boolean;
  /** 各座位结束时剩余手牌数（4 人混战排位用） */
  remainingHandCounts: number[];
}

/** 相邻难度对战胜率（验证单调性） */
export interface LadderPairingResult {
  weak: Difficulty;
  strong: Difficulty;
  games: number;
  strongWins: number;
  weakWins: number;
  draws: number;
  /** 强档胜率（不含平局） */
  strongWinRate: number;
  avgTurns: number;
  avgActions: number;
  illegalActions: number;
  errorCount: number;
  totalTurns: number;
  totalActions: number;
}

/** 难度阶梯自对弈汇总 */
export interface LadderResult {
  pairings: LadderPairingResult[];
  /** 是否每一组相邻对战都是"难度高者胜率 > 50%" */
  monotonic: boolean;
  illegalActions: number;
  errorCount: number;
  games: number;
}

/** 相邻难度阶梯对弈参数 */
export interface LadderOptions {
  /** 每组相邻难度对战的局数（2 人局，座位交替以抵消先手优势） */
  gamesPerPairing: number;
  /** 种子前缀（相同种子 ⇒ 相同结果，便于复现） */
  baseSeed?: string | number;
  /** 引擎侧 UNO 喊/抓概率使用的全局难度，默认 realistic */
  engineDifficulty?: Difficulty;
  maxActions?: number;
  deckExhaustion?: DeckExhaustion;
  challengeWild4?: boolean;
  twoPlayerRules?: boolean;
}

/** 4 人混战（每档一个座位，座位轮转）参数 */
export interface MixedTableOptions {
  games: number;
  baseSeed?: string | number;
  engineDifficulty?: Difficulty;
  maxActions?: number;
  deckExhaustion?: DeckExhaustion;
  challengeWild4?: boolean;
}

/** 4 人混战结果（验证四档难度的综合强度排序） */
export interface MixedTableResult {
  games: number;
  draws: number;
  /** 各难度胜场数 */
  winCounts: Record<Difficulty, number>;
  /** 各难度平均名次（1=最好；按剩余手牌从少到多排位） */
  averagePositions: Record<Difficulty, number>;
  avgTurns: number;
  illegalActions: number;
  errorCount: number;
  /** 平均名次是否随难度单调变好（休闲 > 简单 > 真实 > 骨灰级 无意义，应为晋升） */
  rankingMonotonic: boolean;
}
