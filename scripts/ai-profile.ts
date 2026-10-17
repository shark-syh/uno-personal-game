/**
 * 本地 AI 打牌实测（M2 验收补充）：每个难度各跑 N 局 4 人 AI 对局，
 * 统计"平均用时 + 打牌风格"并输出 Markdown 表格（可直接贴报告）。
 *
 * 口径：
 * - 4 人桌、4 个座位全部使用同一难度（引擎侧 UNO 喊/抓概率也取该难度，
 *   与真实对局里 `GameConfig.aiDifficulty` 只有一档的现状一致）；
 * - 每难度先跑 1 局热身（不计入），再跑 N 局（默认 5 局）计时；
 * - 用时为 Node 单线程实测（本地启发式 AI 无人工"思考延迟"；M4 接入 LLM 后另计）；
 * - 风格数据全部来自 AI 实际决策与引擎事件，不读隐藏信息（诈唬按决策特征识别）。
 *
 * 用法（项目根目录）：
 *   npm run profile:ai
 *   npm run profile:ai -- --games 10 --players 4
 *   npm run profile:ai -- --out review-assets/ai-profile.md
 */
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { applyAction, countCards, getLegalActions, isGameOver } from '@uno/game-core';
import type { Difficulty, GameState } from '@uno/game-core';
import {
  createSelfPlayGame,
  decide,
  DIFFICULTY_LABEL,
  DIFFICULTY_ORDER,
  sameAction,
} from '../packages/ai/src/index.ts';

interface ProfileOptions {
  games: number;
  players: number;
  out: string | null;
}

interface GameRunStats {
  durationMs: number;
  decisionMs: number;
  decisions: number;
  turns: number;
  actions: number;
  plays: number;
  actionCardPlays: number;
  draws: number;
  stackPlays: number;
  challenges: number;
  /** 面对过多少次 +4 挑战窗口（挑战决策的分母） */
  challengeWindows: number;
  challengeSuccess: number;
  wild4NormalPlays: number;
  bluffs: number;
  unoCalls: number;
  unoCaught: number;
  remainingHandTotal: number;
}

interface DifficultyAggregate {
  difficulty: Difficulty;
  games: number;
  runs: GameRunStats[];
}

const HELP = `本地 AI 打牌实测（M2）

参数：
  --games <n>    每个难度计时的局数（默认 5；另各跑 1 局热身不计入）
  --players <n>  对局人数（默认 4）
  --out <路径>   把 Markdown 结果写入文件（可选）
  --help         显示帮助

示例：npm run profile:ai -- --games 5 --out review-assets/ai-profile.md
`;

function parseArgs(argv: string[]): ProfileOptions {
  const options: ProfileOptions = { games: 5, players: 4, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case '--games':
        options.games = Math.max(1, Number(value) || 5);
        index += 1;
        break;
      case '--players':
        options.players = Math.min(10, Math.max(2, Number(value) || 4));
        index += 1;
        break;
      case '--out':
        options.out = value ?? null;
        index += 1;
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

/** 跑一局"全同难度"的 4 人 AI 对局并统计 */
function runGame(difficulty: Difficulty, seed: string, players: number): GameRunStats {
  const difficulties = Array.from({ length: players }, () => difficulty);
  const session = createSelfPlayGame({
    playerCount: players,
    seed,
    difficulties,
    engineDifficulty: difficulty,
  });
  let state: GameState = session.state;
  const aiRng = session.aiRng;

  let decisionMs = 0;
  let decisions = 0;
  let challenges = 0;
  let challengeWindows = 0;
  let wild4NormalPlays = 0;
  let bluffs = 0;
  let guard = 0;

  const startedAt = performance.now();
  while (!isGameOver(state)) {
    guard += 1;
    if (guard > 10000) throw new Error(`对局 ${String(seed)} 超过动作上限仍未结束`);
    const seat = state.currentSeat;
    const legal = getLegalActions(state);

    const decisionStartedAt = performance.now();
    const decision = decide(state, seat, { difficulty, rng: aiRng });
    decisionMs += performance.now() - decisionStartedAt;
    decisions += 1;

    if (!legal.some((action) => sameAction(action, decision.action))) {
      throw new Error(`AI 选择了非法动作（seed ${String(seed)}）`);
    }
    if (decision.candidates.some((candidate) => candidate.kind === 'challenge')) {
      challengeWindows += 1;
    }
    if (decision.candidate.kind === 'challenge') challenges += 1;
    if (decision.candidate.kind === 'play' && decision.candidate.card?.kind === 'wild4') {
      wild4NormalPlays += 1;
      // bluffRisk > 0 表示"当时手上有当前颜色牌仍出 +4"（原版允许的诈唬，被挑战会受罚）
      if (decision.candidate.features.bluffRisk > 0) bluffs += 1;
    }

    state = applyAction(state, decision.action).state;
    if (countCards(state) !== 108) throw new Error(`牌数异常（seed ${String(seed)}）`);
  }
  const durationMs = performance.now() - startedAt;

  let plays = 0;
  let actionCardPlays = 0;
  let draws = 0;
  let stackPlays = 0;
  let challengeSuccess = 0;
  let unoCalls = 0;
  let unoCaught = 0;
  for (const event of state.history) {
    if (event.type === 'PLAY') {
      plays += 1;
      if (event.card.kind !== 'number') actionCardPlays += 1;
    } else if (event.type === 'DRAW') {
      draws += event.count;
    } else if (event.type === 'STACK_PUSH') {
      stackPlays += 1;
    } else if (event.type === 'CHALLENGE_SUCCESS') {
      challengeSuccess += 1;
    } else if (event.type === 'UNO_CALLED') {
      unoCalls += 1;
    } else if (event.type === 'UNO_CAUGHT') {
      unoCaught += 1;
    }
  }

  return {
    durationMs,
    decisionMs,
    decisions,
    turns: state.turnCount,
    actions: state.actionCount,
    plays,
    actionCardPlays,
    draws,
    stackPlays,
    challenges,
    challengeWindows,
    challengeSuccess,
    wild4NormalPlays,
    bluffs,
    unoCalls,
    unoCaught,
    remainingHandTotal: state.players.reduce((sum, player) => sum + player.hand.length, 0),
  };
}

function sum(runs: readonly GameRunStats[], pick: (run: GameRunStats) => number): number {
  return runs.reduce((total, run) => total + pick(run), 0);
}

function avg(runs: readonly GameRunStats[], pick: (run: GameRunStats) => number): number {
  return runs.length > 0 ? sum(runs, pick) / runs.length : 0;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function ms(value: number): string {
  return value >= 100 ? `${value.toFixed(1)} ms` : `${value.toFixed(2)} ms`;
}

function us(value: number): string {
  return `${(value * 1000).toFixed(0)} μs`;
}

/** 由数据生成一句中文风格小结 */
function styleSummary(difficulty: Difficulty, runs: readonly GameRunStats[]): string {
  const games = runs.length;
  const actions = sum(runs, (run) => run.actions);
  const turns = sum(runs, (run) => run.turns);
  const plays = sum(runs, (run) => run.plays);
  const draws = sum(runs, (run) => run.draws);
  const actionRate = sum(runs, (run) => run.actionCardPlays) / Math.max(1, plays);
  const drawRatio = draws / Math.max(1, plays);
  const stackPer100 = (100 * sum(runs, (run) => run.stackPlays)) / Math.max(1, plays);
  const windows = sum(runs, (run) => run.challengeWindows);
  const chosen = sum(runs, (run) => run.challenges);
  const willingness = windows > 0 ? chosen / windows : 0;
  const successRate = chosen > 0 ? sum(runs, (run) => run.challengeSuccess) / chosen : 0;
  const wild4Plays = sum(runs, (run) => run.wild4NormalPlays);
  const illegalRate = wild4Plays > 0 ? bluffs(runs) / wild4Plays : 0;
  const caughtPerGame = avg(runs, (run) => run.unoCaught);

  const traits: string[] = [];
  traits.push(
    `节奏 ${(actions / games).toFixed(0)} 动作/局、${(turns / games).toFixed(0)} 回合/局`,
  );

  if (drawRatio >= 0.75) traits.push('摸牌偏多、清牌慢');
  else if (drawRatio <= 0.64) traits.push('清牌效率最高');
  else traits.push('清牌效率适中');

  if (actionRate >= 0.37) traits.push('偏进攻（动作牌用得多）');
  else if (actionRate < 0.33) traits.push('偏保守（动作牌用得少）');

  if (stackPer100 >= 14) traits.push(`叠牌凶（${stackPer100.toFixed(1)} 次/百出牌）`);
  else if (stackPer100 >= 12) traits.push(`叠牌积极（${stackPer100.toFixed(1)} 次/百出牌）`);
  else traits.push(`叠牌较少（${stackPer100.toFixed(1)} 次/百出牌）`);

  if (windows > 0) {
    if (willingness >= 0.6) {
      traits.push(
        `挑战果断（面对窗口 ${percent(willingness)} 出手，成功率 ${percent(successRate)}）`,
      );
    } else if (willingness > 0) {
      traits.push(
        `挑战谨慎（面对窗口 ${percent(willingness)} 出手，成功率 ${percent(successRate)}）`,
      );
    } else {
      traits.push('从不挑战');
    }
  } else {
    traits.push('没遇到挑战窗口');
  }

  if (wild4Plays > 0) {
    if (illegalRate >= 0.7) traits.push(`出 +4 常不规避同色牌（违规率 ${percent(illegalRate)}）`);
    else if (illegalRate >= 0.45) traits.push(`出 +4 有一定违规比例（${percent(illegalRate)}）`);
    else traits.push(`出 +4 较谨慎（违规率 ${percent(illegalRate)}）`);
  }

  if (caughtPerGame > 0.15) traits.push(`UNO 偶尔忘喊被抓（${caughtPerGame.toFixed(1)} 次/局）`);
  else traits.push('UNO 几乎不被抓');

  const label = DIFFICULTY_LABEL[difficulty];
  return `**${label}**：${traits.join('；')}。`;
}

function bluffs(runs: readonly GameRunStats[]): number {
  return sum(runs, (run) => run.bluffs);
}

function buildMarkdown(
  aggregates: readonly DifficultyAggregate[],
  options: ProfileOptions,
): string {
  const lines: string[] = [];
  lines.push('## 本地 AI 打牌实测（M2 本地启发式 AI）');
  lines.push('');
  lines.push(
    `> 配置：**${options.players} 人桌 × 全员同难度**；每个难度计时 **${options.games} 局**（另热身 1 局不计）；` +
      '引擎 UNO 喊/抓概率取该难度；计时为 Node 单线程实测，本地 AI 无人工思考延迟。',
  );
  lines.push('');

  lines.push('### 一、用时与节奏');
  lines.push('');
  lines.push(
    '| 难度 | 平均每局耗时 | 平均每局 AI 决策耗时 | 平均单次决策 | 平均回合数 | 平均动作数 |',
  );
  lines.push('|------|-------------|---------------------|-------------|-----------|-----------|');
  for (const aggregate of aggregates) {
    const runs = aggregate.runs;
    const avgDuration = avg(runs, (run) => run.durationMs);
    const avgDecisionTime = avg(runs, (run) => run.decisionMs);
    const decisions = sum(runs, (run) => run.decisions);
    const avgPerDecision = decisions > 0 ? sum(runs, (run) => run.decisionMs) / decisions : 0;
    lines.push(
      `| ${DIFFICULTY_LABEL[aggregate.difficulty]} | ${ms(avgDuration)} | ${ms(avgDecisionTime)} | ${us(avgPerDecision)} | ` +
        `${avg(runs, (run) => run.turns).toFixed(1)} | ${avg(runs, (run) => run.actions).toFixed(1)} |`,
    );
  }
  lines.push('');

  lines.push('### 二、出牌风格');
  lines.push('');
  lines.push('| 难度 | 出牌/局 | 摸牌/局 | 摸牌/出牌比 | 叠牌/局 | 动作牌占比 | 终局剩牌/人 |');
  lines.push('|------|---------|---------|-------------|---------|-----------|-------------|');
  for (const aggregate of aggregates) {
    const runs = aggregate.runs;
    const plays = sum(runs, (run) => run.plays);
    const draws = sum(runs, (run) => run.draws);
    const actionRate = plays > 0 ? sum(runs, (run) => run.actionCardPlays) / plays : 0;
    lines.push(
      `| ${DIFFICULTY_LABEL[aggregate.difficulty]} | ` +
        `${avg(runs, (run) => run.plays).toFixed(1)} | ` +
        `${avg(runs, (run) => run.draws).toFixed(1)} | ` +
        `${(draws / Math.max(1, plays)).toFixed(2)} | ` +
        `${avg(runs, (run) => run.stackPlays).toFixed(1)} | ` +
        `${percent(actionRate)} | ` +
        `${avg(runs, (run) => run.remainingHandTotal / options.players).toFixed(1)} |`,
    );
  }
  lines.push('');

  lines.push('### 三、挑战与冒险');
  lines.push('');
  lines.push(
    '| 难度 | 挑战窗口/局 | 挑战意愿 | 挑战成功率 | 普通回合+4/局 | 违规+4/局 | 违规+4率 | UNO喊/局 | 被抓/局 |',
  );
  lines.push(
    '|------|-------------|---------|-----------|--------------|-----------|----------|---------|---------|',
  );
  for (const aggregate of aggregates) {
    const runs = aggregate.runs;
    const windows = sum(runs, (run) => run.challengeWindows);
    const chosen = sum(runs, (run) => run.challenges);
    const willingness = windows > 0 ? chosen / windows : 0;
    const successRate = chosen > 0 ? sum(runs, (run) => run.challengeSuccess) / chosen : 0;
    const wild4Plays = sum(runs, (run) => run.wild4NormalPlays);
    const illegalRate = wild4Plays > 0 ? bluffs(runs) / wild4Plays : 0;
    lines.push(
      `| ${DIFFICULTY_LABEL[aggregate.difficulty]} | ` +
        `${avg(runs, (run) => run.challengeWindows).toFixed(2)} | ` +
        `${windows > 0 ? percent(willingness) : '—'} | ` +
        `${chosen > 0 ? percent(successRate) : '—'} | ` +
        `${avg(runs, (run) => run.wild4NormalPlays).toFixed(2)} | ` +
        `${avg(runs, (run) => run.bluffs).toFixed(2)} | ` +
        `${wild4Plays > 0 ? percent(illegalRate) : '—'} | ` +
        `${avg(runs, (run) => run.unoCalls).toFixed(1)} | ` +
        `${avg(runs, (run) => run.unoCaught).toFixed(1)} |`,
    );
  }
  lines.push('');

  lines.push('### 四、风格小结');
  lines.push('');
  for (const aggregate of aggregates) {
    lines.push(`- ${styleSummary(aggregate.difficulty, aggregate.runs)}`);
  }
  lines.push('');
  lines.push(
    '> 读数提示：**摸牌/出牌比**越低清牌效率越高；**挑战意愿**=挑战次数 / 面对挑战窗口次数；',
  );
  lines.push('> **违规+4率**=手持当前颜色牌仍出 +4 的比例（原版允许诈唬，但被挑战会受罚）；');
  lines.push(
    '> 本地 AI 决策耗时 < 1 ms，所以"每局耗时"主要是引擎模拟开销；真实对局还会加 UI 动画与 M4 思考延迟，届时另行统计。',
  );
  lines.push('');
  return lines.join('\n');
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const aggregates: DifficultyAggregate[] = [];

  console.log(
    `本地 AI 打牌实测：${options.players} 人桌 × 全同难度，每难度 ${options.games} 局（另 1 局热身）...`,
  );

  for (const difficulty of DIFFICULTY_ORDER) {
    // 热身局（不计入统计，减少 JIT 预热对计时的影响）
    runGame(difficulty, `profile-warmup-${difficulty}`, options.players);

    const runs: GameRunStats[] = [];
    for (let index = 0; index < options.games; index += 1) {
      runs.push(runGame(difficulty, `profile-${difficulty}-${index + 1}`, options.players));
    }
    aggregates.push({ difficulty, games: runs.length, runs });
    console.log(
      `  ${DIFFICULTY_LABEL[difficulty]}：${options.games} 局完成（平均每局 ${ms(
        runs.reduce((total, run) => total + run.durationMs, 0) / runs.length,
      )}）`,
    );
  }

  const markdown = buildMarkdown(aggregates, options);
  console.log('');
  console.log(markdown);

  if (options.out) {
    writeFileSync(options.out, markdown, 'utf8');
    console.log(`已写入：${options.out}`);
  }
}

main();
