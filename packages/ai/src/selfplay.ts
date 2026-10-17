/**
 * 自对弈驱动（M2）：AI vs AI 批量对局，用于验证"无非法动作 / 难度胜率单调 / 回合数合理"。
 *
 * 设计要点：
 * - 自对弈没有人类：创建后把 `humanSeat` 置为 -1、所有玩家 `isHuman=false`，
 *   这样引擎的 AI 喊/抓 UNO 概率对每个座位都生效（M1-6 的概率是按 AI 走的）；
 * - 引擎侧 UNO 概率只有全局 `aiDifficulty` 一档（M1-6 遗留），自对弈默认用
 *   `realistic` 固定，避免难度差异混入 UNO 随机结算，胜率反映的是**出牌策略**差异；
 * - AI 决策随机源与引擎随机源分离：引擎 seed 决定发牌/UNO 概率，AI RNG 由
 *   `selfplay-ai-${seed}` 派生，保证整批结果可复现。
 */
import {
  applyAction,
  countCards,
  createInitialGame,
  createRng,
  getLegalActions,
  getResult,
  isGameOver,
} from '@uno/game-core';
import type { Difficulty, EngineAction, GameConfig, GameState } from '@uno/game-core';
import { decide } from './decide.ts';
import { DIFFICULTY_ORDER } from './difficulty.ts';
import type {
  LadderOptions,
  LadderPairingResult,
  LadderResult,
  MixedTableOptions,
  MixedTableResult,
  SelfPlayGameConfig,
  SelfPlayGameResult,
} from './types.ts';

const DEFAULT_MAX_ACTIONS = 5000;

/** 自对弈局面 + AI 随机源 */
export interface SelfPlaySession {
  state: GameState;
  aiRng: ReturnType<typeof createRng>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 创建一局全 AI 对局（没有人类座位） */
export function createSelfPlayGame(config: SelfPlayGameConfig): SelfPlaySession {
  if (config.difficulties.length !== config.playerCount) {
    throw new RangeError(
      `difficulties 长度（${config.difficulties.length}）必须等于 playerCount（${config.playerCount}）`,
    );
  }

  const partial: Partial<GameConfig> = {
    playerCount: config.playerCount,
    seed: config.seed,
    names: Array.from({ length: config.playerCount }, (_, index) => `AI${index + 1}`),
    aiDifficulty: config.engineDifficulty ?? 'realistic',
    autoCallUno: false,
  };
  if (config.deckExhaustion) partial.deckExhaustion = config.deckExhaustion;
  if (config.challengeWild4 !== undefined) partial.challengeWild4 = config.challengeWild4;
  if (config.twoPlayerRules !== undefined) partial.twoPlayerRules = config.twoPlayerRules;

  const state = createInitialGame(partial);
  // 自对弈：没有人类座位，所有玩家都是 AI（创建时 humanSeat 必须在范围内，这里再改）
  state.config.humanSeat = -1;
  for (const player of state.players) player.isHuman = false;

  return { state, aiRng: createRng(`selfplay-ai-${String(config.seed)}`) };
}

/** 两个引擎动作是否等价（用于"AI 只从合法动作里选"的断言） */
export function sameAction(left: EngineAction, right: EngineAction): boolean {
  if (left.type !== right.type) return false;
  switch (left.type) {
    case 'PLAY_CARD':
    case 'PLAY_DRAWN':
    case 'STACK_PLAY': {
      const other = right as typeof left;
      return (
        left.cardId === other.cardId && (left.colorChoice ?? null) === (other.colorChoice ?? null)
      );
    }
    case 'CHOOSE_COLOR':
      return left.color === (right as typeof left).color;
    case 'CATCH_UNO':
      return left.targetSeat === (right as typeof left).targetSeat;
    default:
      return true;
  }
}

/** 跑完一局 AI vs AI，返回结算与质量检查结果 */
export function playSelfPlayGame(config: SelfPlayGameConfig): SelfPlayGameResult {
  const maxActions = config.maxActions ?? DEFAULT_MAX_ACTIONS;
  const session = createSelfPlayGame(config);
  let state = session.state;
  const aiRng = session.aiRng;

  const errors: string[] = [];
  let illegalActions = 0;
  let conservationOk = true;
  let executed = 0;

  while (!isGameOver(state)) {
    if (executed >= maxActions) {
      errors.push(`达到动作上限 ${maxActions}，对局未结束（可能死循环）`);
      break;
    }

    const legal = getLegalActions(state);
    if (legal.length === 0) {
      errors.push('当前阶段没有合法动作（引擎状态异常）');
      break;
    }

    const seat = state.currentSeat;
    const difficulty = config.difficulties[seat];
    if (!difficulty) {
      errors.push(`座位 ${seat} 没有配置难度`);
      break;
    }

    let action: EngineAction;
    try {
      action = decide(state, seat, { difficulty, rng: aiRng }).action;
    } catch (error) {
      errors.push(`AI 决策异常（座位 ${seat} / ${difficulty}）：${errorMessage(error)}`);
      break;
    }

    if (!legal.some((item) => sameAction(item, action))) {
      illegalActions += 1;
      errors.push(`AI 选择了非法动作（座位 ${seat} / ${difficulty}）：${JSON.stringify(action)}`);
      break;
    }

    try {
      const applied = applyAction(state, action);
      state = applied.state;
    } catch (error) {
      illegalActions += 1;
      errors.push(`applyAction 拒绝该动作（座位 ${seat} / ${difficulty}）：${errorMessage(error)}`);
      break;
    }

    executed += 1;
    const total = countCards(state);
    if (total !== 108) {
      conservationOk = false;
      errors.push(`牌数异常：${total}（应为 108）`);
      break;
    }
  }

  const challenges = state.history.filter(
    (event) => event.type === 'CHALLENGE_SUCCESS' || event.type === 'CHALLENGE_FAIL',
  ).length;
  const remainingHandCounts = state.players.map((player) => player.hand.length);

  if (isGameOver(state)) {
    const result = getResult(state);
    return {
      seed: config.seed,
      playerCount: config.playerCount,
      difficulties: [...config.difficulties],
      winnerSeat: result.winnerSeat,
      isDraw: result.isDraw,
      reason: result.reason,
      turns: result.turns,
      actions: result.actions,
      draws: result.draws,
      plays: result.plays,
      stackPlays: result.stackPlays,
      unoCalls: result.unoCalls,
      challenges,
      illegalActions,
      errors,
      conservationOk,
      remainingHandCounts,
    };
  }

  // 未正常结束（只有出错才会到这里）：返回可诊断的部分数据
  let draws = 0;
  let plays = 0;
  let stackPlays = 0;
  let unoCalls = 0;
  for (const event of state.history) {
    if (event.type === 'DRAW') draws += event.count;
    else if (event.type === 'PLAY') plays += 1;
    else if (event.type === 'STACK_PUSH') stackPlays += 1;
    else if (event.type === 'UNO_CALLED') unoCalls += 1;
  }

  return {
    seed: config.seed,
    playerCount: config.playerCount,
    difficulties: [...config.difficulties],
    winnerSeat: null,
    isDraw: false,
    reason: 'empty-hand',
    turns: state.turnCount,
    actions: state.actionCount,
    draws,
    plays,
    stackPlays,
    unoCalls,
    challenges,
    illegalActions,
    errors,
    conservationOk,
    remainingHandCounts,
  };
}

/**
 * 相邻难度阶梯对战（2 人局）：验证"难度越高胜率越高"。
 * 座位交替（强档先/后手各半），每组局数由 `gamesPerPairing` 决定。
 */
export function runDifficultyLadder(options: LadderOptions): LadderResult {
  const games = Math.max(1, Math.floor(options.gamesPerPairing));
  const baseSeed = options.baseSeed ?? 'm2-ladder';
  const pairings: LadderPairingResult[] = [];

  for (let index = 0; index < DIFFICULTY_ORDER.length - 1; index += 1) {
    const weak = DIFFICULTY_ORDER[index]!;
    const strong = DIFFICULTY_ORDER[index + 1]!;
    let strongWins = 0;
    let weakWins = 0;
    let draws = 0;
    let illegalActions = 0;
    let errorCount = 0;
    let totalTurns = 0;
    let totalActions = 0;

    for (let gameIndex = 0; gameIndex < games; gameIndex += 1) {
      const swap = gameIndex % 2 === 1;
      const difficulties: Difficulty[] = swap ? [strong, weak] : [weak, strong];
      const result = playSelfPlayGame({
        playerCount: 2,
        seed: `${String(baseSeed)}-${weak}-vs-${strong}-${gameIndex}`,
        difficulties,
        engineDifficulty: options.engineDifficulty,
        maxActions: options.maxActions,
        deckExhaustion: options.deckExhaustion,
        challengeWild4: options.challengeWild4,
        twoPlayerRules: options.twoPlayerRules,
      });

      if (result.winnerSeat === null) draws += 1;
      else if (result.difficulties[result.winnerSeat] === strong) strongWins += 1;
      else weakWins += 1;

      illegalActions += result.illegalActions;
      errorCount += result.errors.length;
      totalTurns += result.turns;
      totalActions += result.actions;
    }

    const decided = games - draws;
    pairings.push({
      weak,
      strong,
      games,
      strongWins,
      weakWins,
      draws,
      strongWinRate: decided > 0 ? strongWins / decided : 0,
      avgTurns: totalTurns / games,
      avgActions: totalActions / games,
      illegalActions,
      errorCount,
      totalTurns,
      totalActions,
    });
  }

  const illegalActions = pairings.reduce((sum, pairing) => sum + pairing.illegalActions, 0);
  const errorCount = pairings.reduce((sum, pairing) => sum + pairing.errorCount, 0);
  return {
    pairings,
    monotonic: pairings.every((pairing) => pairing.strongWinRate > 0.5),
    illegalActions,
    errorCount,
    games: pairings.reduce((sum, pairing) => sum + pairing.games, 0),
  };
}

/**
 * 4 人混战：每档难度各占一个座位，按局轮转座位，统计胜场与平均名次。
 * 用于验证四档难度的综合强度排序（比相邻 2 人对战更接近真实对局）。
 */
export function runMixedTable(options: MixedTableOptions): MixedTableResult {
  const games = Math.max(1, Math.floor(options.games));
  const baseSeed = options.baseSeed ?? 'm2-mixed';
  const winCounts: Record<Difficulty, number> = { casual: 0, easy: 0, realistic: 0, hardcore: 0 };
  const positionSums: Record<Difficulty, number> = {
    casual: 0,
    easy: 0,
    realistic: 0,
    hardcore: 0,
  };
  const positionCounts: Record<Difficulty, number> = {
    casual: 0,
    easy: 0,
    realistic: 0,
    hardcore: 0,
  };
  let draws = 0;
  let illegalActions = 0;
  let errorCount = 0;
  let totalTurns = 0;

  for (let gameIndex = 0; gameIndex < games; gameIndex += 1) {
    const shift = gameIndex % DIFFICULTY_ORDER.length;
    const difficulties: Difficulty[] = DIFFICULTY_ORDER.map(
      (_, offset) => DIFFICULTY_ORDER[(offset + shift) % DIFFICULTY_ORDER.length]!,
    );
    const result = playSelfPlayGame({
      playerCount: difficulties.length,
      seed: `${String(baseSeed)}-${gameIndex}`,
      difficulties,
      engineDifficulty: options.engineDifficulty,
      maxActions: options.maxActions,
      deckExhaustion: options.deckExhaustion,
      challengeWild4: options.challengeWild4,
    });

    illegalActions += result.illegalActions;
    errorCount += result.errors.length;
    totalTurns += result.turns;

    // 名次：剩余手牌越少越好；并列时名次相同（1 + 比它更少的人数），避免按难度名次字母序偏置
    const remaining = result.remainingHandCounts;
    result.difficulties.forEach((difficulty, seat) => {
      const value = remaining[seat] ?? 99;
      const rank = 1 + remaining.filter((count) => count < value).length;
      positionSums[difficulty] += rank;
      positionCounts[difficulty] += 1;
    });

    if (result.winnerSeat === null) draws += 1;
    else winCounts[result.difficulties[result.winnerSeat]!] += 1;
  }

  const averagePositions = {} as Record<Difficulty, number>;
  for (const difficulty of DIFFICULTY_ORDER) {
    const count = positionCounts[difficulty];
    averagePositions[difficulty] = count > 0 ? positionSums[difficulty] / count : 0;
  }

  const rankingMonotonic = DIFFICULTY_ORDER.every(
    (difficulty, index) =>
      index === 0 || averagePositions[difficulty] <= averagePositions[DIFFICULTY_ORDER[index - 1]!],
  );

  return {
    games,
    draws,
    winCounts,
    averagePositions,
    avgTurns: totalTurns / games,
    illegalActions,
    errorCount,
    rankingMonotonic,
  };
}
