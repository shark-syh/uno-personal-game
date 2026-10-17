import type {
  AiMode,
  DeckExhaustion,
  Difficulty,
  GameConfig,
  StackingMode,
  StartCardRule,
  StartingPlayer,
  Wild4Legality,
} from './types.ts';

/**
 * 规则默认值（对应 `开发计划.md` 4.12 规则决策表）。
 *
 * 本作与"原版"的唯一玩法差异：宽松叠牌（loose）。
 * 其余默认值均按原版：标准 108 张、单局定胜负、UNO 罚 2 张、+4 可挑战、2 人特殊规则开启。
 */
export const DEFAULT_GAME_CONFIG: GameConfig = {
  playerCount: 4,
  humanSeat: 0,
  names: null,
  aiDifficulty: 'realistic',
  aiMode: 'auto',
  startingPlayer: 'random',
  startCardRule: 'classic',
  stacking: 'loose',
  twoPlayerRules: true,
  deckExhaustion: 'reshuffle',
  challengeWild4: true,
  wild4Legality: 'color-only',
  unoPenalty: 2,
  autoCallUno: false,
  seed: undefined,
};

const DIFFICULTIES = new Set<Difficulty>(['casual', 'easy', 'realistic', 'hardcore']);
const AI_MODES = new Set<AiMode>(['zhipu', 'local', 'auto']);
const STARTING_PLAYERS = new Set<StartingPlayer>(['random', 'human']);
const START_CARD_RULES = new Set<StartCardRule>(['classic', 'ignore-action']);
const STACKING_MODES = new Set<StackingMode>(['loose', 'classic', 'none']);
const DECK_EXHAUSTIONS = new Set<DeckExhaustion>(['reshuffle', 'end-by-fewest']);
const WILD4_LEGALITIES = new Set<Wild4Legality>(['color-only', 'new-version']);

/**
 * 合并默认值并校验配置。
 * @throws RangeError 配置非法时抛出（人数越界、未知难度等）
 */
export function normalizeGameConfig(partial: Partial<GameConfig> = {}): GameConfig {
  const merged: GameConfig = { ...DEFAULT_GAME_CONFIG, ...partial };

  if (!Number.isInteger(merged.playerCount) || merged.playerCount < 2 || merged.playerCount > 10) {
    throw new RangeError(`playerCount 必须是 2~10 的整数，收到 ${merged.playerCount}`);
  }
  if (!Number.isInteger(merged.humanSeat) || merged.humanSeat < 0 || merged.humanSeat >= merged.playerCount) {
    throw new RangeError(`humanSeat 必须在 0~${merged.playerCount - 1} 之间，收到 ${merged.humanSeat}`);
  }
  if (merged.names && merged.names.length !== merged.playerCount) {
    throw new RangeError(`names 长度必须等于 playerCount（${merged.playerCount}），收到 ${merged.names.length}`);
  }
  if (!DIFFICULTIES.has(merged.aiDifficulty)) {
    throw new RangeError(`未知 AI 难度：${merged.aiDifficulty}`);
  }
  if (!AI_MODES.has(merged.aiMode)) {
    throw new RangeError(`未知 AI 模式：${merged.aiMode}`);
  }
  if (!STARTING_PLAYERS.has(merged.startingPlayer)) {
    throw new RangeError(`未知先手方式：${merged.startingPlayer}`);
  }
  if (!START_CARD_RULES.has(merged.startCardRule)) {
    throw new RangeError(`未知起手翻牌规则：${merged.startCardRule}`);
  }
  if (!STACKING_MODES.has(merged.stacking)) {
    throw new RangeError(`未知叠加模式：${merged.stacking}`);
  }
  if (!DECK_EXHAUSTIONS.has(merged.deckExhaustion)) {
    throw new RangeError(`未知牌堆耗尽策略：${merged.deckExhaustion}`);
  }
  if (!WILD4_LEGALITIES.has(merged.wild4Legality)) {
    throw new RangeError(`未知 Wild+4 判定口径：${merged.wild4Legality}`);
  }
  if (!Number.isInteger(merged.unoPenalty) || merged.unoPenalty < 0) {
    throw new RangeError(`unoPenalty 必须是非负整数，收到 ${merged.unoPenalty}`);
  }

  return { ...merged, names: merged.names ? [...merged.names] : null };
}
