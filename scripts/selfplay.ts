/**
 * AI vs AI 自对弈基准（M2 验收脚本）。
 *
 * 验收目标：
 * 1. 非法动作数 = 0（AI 永远只从引擎合法动作里选）；
 * 2. 难度胜率单调：相邻难度对战时，强档胜率 > 50%（2 人局，座位交替抵消先手优势）；
 * 3. 平均回合数合理（约 20~60 回合）；
 * 4. 4 人混战排名随难度提升（附加验证）。
 *
 * 用法（项目根目录）：
 *   npm run selfplay                          # 默认：每组相邻 200 局 + 混战 100 局
 *   npm run selfplay -- --games 300 --mixed 200
 *   npm run selfplay -- --games 50 --no-mixed
 *   npm run selfplay -- --seed m2-demo --engine-difficulty hardcore
 *   npm run selfplay -- --help
 */
import type { Difficulty } from '@uno/game-core';
import {
  DIFFICULTY_LABEL,
  DIFFICULTY_ORDER,
  runDifficultyLadder,
  runMixedTable,
} from '../packages/ai/src/index.ts';

interface SelfplayOptions {
  games: number;
  mixed: number;
  seed: string;
  engineDifficulty: Difficulty;
  maxActions: number;
  deckExhaustion: 'reshuffle' | 'end-by-fewest' | undefined;
  challengeWild4: boolean | undefined;
}

const HELP = `M2 本地 AI 自对弈基准

参数：
  --games <n>              每组相邻难度对战的局数（默认 200）
  --mixed <n>              4 人混战局数（默认 100；--no-mixed 关闭）
  --no-mixed               不做 4 人混战
  --seed <字符串>          种子前缀（默认 m2-selfplay；相同种子 ⇒ 相同结果）
  --engine-difficulty <档> 引擎侧 UNO 喊/抓概率使用的全局难度（默认 realistic）
  --max-actions <n>        单局动作上限保护（默认 5000）
  --deck-exhaustion <策略> 牌堆耗尽策略：reshuffle（默认）/ end-by-fewest
  --no-challenge           关闭 +4 挑战
  --help                   显示帮助

输出：相邻难度对战胜率（验证单调性）、4 人混战胜场/平均名次、平均回合数、非法动作数。
退出码：非法动作 > 0 / 出现对局异常 / 难度不单调 时为 1。
`;

function parseArgs(argv: string[]): SelfplayOptions {
  const options: SelfplayOptions = {
    games: 200,
    mixed: 100,
    seed: 'm2-selfplay',
    engineDifficulty: 'realistic',
    maxActions: 5000,
    deckExhaustion: undefined,
    challengeWild4: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case '--games':
        options.games = Math.max(1, Number(value) || 200);
        index += 1;
        break;
      case '--mixed':
        options.mixed = Math.max(0, Number(value) || 0);
        index += 1;
        break;
      case '--no-mixed':
        options.mixed = 0;
        break;
      case '--seed':
        options.seed = value ?? options.seed;
        index += 1;
        break;
      case '--engine-difficulty':
        options.engineDifficulty = value as Difficulty;
        index += 1;
        break;
      case '--max-actions':
        options.maxActions = Math.max(100, Number(value) || 5000);
        index += 1;
        break;
      case '--deck-exhaustion':
        options.deckExhaustion = value as 'reshuffle' | 'end-by-fewest';
        index += 1;
        break;
      case '--no-challenge':
        options.challengeWild4 = false;
        break;
      case '--help':
        console.log(HELP);
        process.exit(0);
        break;
      default:
        break;
    }
  }

  return options;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function pad(text: string, width: number): string {
  // 中文按 2 个宽度粗略对齐即可（仅日志展示）
  let displayWidth = 0;
  for (const char of text) displayWidth += /[\u4e00-\u9fff]/.test(char) ? 2 : 1;
  return text + ' '.repeat(Math.max(0, width - displayWidth));
}

const options = parseArgs(process.argv.slice(2));
const startedAt = Date.now();

console.log('=== M2 本地 AI 自对弈基准 ===');
console.log(
  `参数: 每组相邻难度 ${options.games} 局 | 4 人混战 ${options.mixed} 局 | 种子 ${options.seed} | ` +
    `引擎 UNO 难度 ${options.engineDifficulty} | 动作上限 ${options.maxActions}`,
);
console.log('');

const ladder = runDifficultyLadder({
  gamesPerPairing: options.games,
  baseSeed: options.seed,
  engineDifficulty: options.engineDifficulty,
  maxActions: options.maxActions,
  deckExhaustion: options.deckExhaustion,
  challengeWild4: options.challengeWild4,
});

console.log('【相邻难度阶梯（2 人局，双方座位交替）】');
for (const pairing of ladder.pairings) {
  const strong = DIFFICULTY_LABEL[pairing.strong];
  const weak = DIFFICULTY_LABEL[pairing.weak];
  console.log(
    `${pad(`${weak} vs ${strong}`, 22)} | 强档胜率 ${percent(pairing.strongWinRate)} ` +
      `(${pairing.games} 局: ${pairing.strongWins} 胜 / ${pairing.weakWins} 负 / ${pairing.draws} 平) | ` +
      `平均回合 ${pairing.avgTurns.toFixed(1)} | 平均动作 ${pairing.avgActions.toFixed(1)} | ` +
      `非法 ${pairing.illegalActions} | 错误 ${pairing.errorCount}`,
  );
}
console.log(
  `小计: ${ladder.games} 局 | 非法动作 ${ladder.illegalActions} | 错误 ${ladder.errorCount} | ` +
    `难度单调性 ${ladder.monotonic ? '✅ 单调（每组强档胜率 > 50%）' : '❌ 不单调'}`,
);
console.log('');

let mixedErrorCount = 0;
let mixedIllegal = 0;
let mixedMonotonic = true;
let mixedGames = 0;
if (options.mixed > 0) {
  const mixed = runMixedTable({
    games: options.mixed,
    baseSeed: `${options.seed}-mixed`,
    engineDifficulty: options.engineDifficulty,
    maxActions: options.maxActions,
    deckExhaustion: options.deckExhaustion,
    challengeWild4: options.challengeWild4,
  });
  mixedGames = mixed.games;
  mixedErrorCount = mixed.errorCount;
  mixedIllegal = mixed.illegalActions;
  mixedMonotonic = mixed.rankingMonotonic;
  console.log('【4 人混战（每档一席，座位按局轮转）】');
  console.log(
    `胜场: ${DIFFICULTY_ORDER.map((difficulty) => `${DIFFICULTY_LABEL[difficulty]} ${mixed.winCounts[difficulty]}`).join(' | ')}` +
      `（平局 ${mixed.draws}）`,
  );
  console.log(
    `平均名次（1=最好）: ${DIFFICULTY_ORDER.map(
      (difficulty) =>
        `${DIFFICULTY_LABEL[difficulty]} ${mixed.averagePositions[difficulty].toFixed(2)}`,
    ).join(' | ')}`,
  );
  console.log(
    `平均回合 ${mixed.avgTurns.toFixed(1)} | 非法 ${mixed.illegalActions} | 错误 ${mixed.errorCount} | ` +
      `排名随难度提升 ${mixed.rankingMonotonic ? '✅' : '❌'}`,
  );
  console.log('');
}

const totalGames = ladder.games + mixedGames;
const illegalActions = ladder.illegalActions + mixedIllegal;
const errorCount = ladder.errorCount + mixedErrorCount;
const monotonic = ladder.monotonic && mixedMonotonic;
const avgTurns =
  ladder.pairings.reduce((sum, pairing) => sum + pairing.avgTurns, 0) /
  Math.max(1, ladder.pairings.length);

console.log('【验收结论】');
console.log(`- 总对局 ${totalGames} 局 | 非法动作 ${illegalActions} | 对局异常 ${errorCount}`);
console.log(
  `- 相邻难度胜率单调: ${ladder.monotonic ? '✅' : '❌'} | 4 人混战排名单调: ${mixedGames > 0 ? (mixedMonotonic ? '✅' : '❌') : '（未跑）'}`,
);
console.log(`- 平均回合数: ${avgTurns.toFixed(1)}（验收参考区间 20~60）`);
console.log(`- 用时: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

if (illegalActions > 0 || errorCount > 0 || !monotonic) {
  console.error('❌ 自对弈验收未通过（非法动作 / 异常 / 难度不单调）');
  process.exitCode = 1;
} else {
  console.log('✅ 自对弈验收通过');
}
