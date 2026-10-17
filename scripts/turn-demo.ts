/**
 * 回合主循环演示（M1-2 起验证用）：不需要 AI，按"随机合法动作"把一整局打完，
 * 用来观察出牌、抽牌、方向、跳过、+2/+4 叠牌结算、+4 挑战、UNO 喊/抓、牌堆耗尽与结算数据。
 *
 * 用法（项目根目录）：
 *   npm run demo:turn
 *   npm run demo:turn -- --players 4 --seed hello
 *   npm run demo:turn -- --players 6 --max-actions 300
 *   npm run demo:turn -- --decline-stack       # 叠牌响应时一律弃权，方便观察累计摸牌
 *   npm run demo:turn -- --decline-challenge   # 面对 +4 一律接受摸 4（不挑战）
 *   npm run demo:turn -- --deck-exhaustion end-by-fewest   # 牌堆一空立即结束
 *   npm run demo:turn -- --quiet
 */
import { COLOR_NAME, cardLabel } from '../packages/game-core/src/deck.ts';
import {
  applyAction,
  getLegalActions,
  getResult,
  isGameOver,
  topCard,
} from '../packages/game-core/src/index.ts';
import { createRng, nextInt } from '../packages/game-core/src/rng.ts';
import { countCards, createInitialGame } from '../packages/game-core/src/setup.ts';
import type {
  EngineAction,
  GameConfig,
  GameState,
  RngState,
} from '../packages/game-core/src/types.ts';

interface DemoOptions {
  config: Partial<GameConfig>;
  maxActions: number;
  quiet: boolean;
  randomPolicy: boolean;
  declineStack: boolean;
  declineChallenge: boolean;
  forgetUno: boolean;
  noUnoCatch: boolean;
}

const HELP = `UNO 回合主循环演示（M1-7 规则引擎闭环）

参数：
  --players <2-10>     对局人数（默认 4）
  --seed <字符串>      随机种子（默认 turn-demo，可复现）
  --max-actions <数字> 动作上限保护（默认 500）
  --difficulty <档位>  AI 难度：casual / easy / realistic / hardcore（默认 realistic，影响 AI 喊/抓 UNO 概率）
  --deck-exhaustion <策略>  牌堆耗尽策略：reshuffle（默认，洗回弃牌堆）/ end-by-fewest（一空即按手牌最少者结束）
  --random             完全随机动作（默认"有牌/能叠/能挑战/能喊能抓就先做"，更接近真人）
  --decline-stack      叠牌响应时一律弃权（观察累计摸牌结算）
  --decline-challenge  面对 +4 一律接受摸 4（默认会挑战，方便观察成功/失败分支）
  --no-challenge       关闭 +4 挑战（+4 直接摸 4 张）
  --forget-uno         人类出牌剩 1 张时故意不喊 UNO（观察 AI 抓人罚 2 张）
  --no-uno-catch       人类不主动抓 AI 的 UNO
  --quiet              只输出结果，不逐条打印动作
  --help               显示帮助

说明：默认策略会尽量叠牌（+2/+4 任意互叠）、面对单张 +4 选择挑战、剩 1 张时喊 UNO；
      AI 喊/抓 UNO 概率按难度（真实/骨灰级必喊必抓）；结算用引擎 getResult 输出趣味分数与统计。
`;

function parseArgs(argv: string[]): DemoOptions {
  const config: Partial<GameConfig> = { playerCount: 4, seed: 'turn-demo' };
  let maxActions = 500;
  let quiet = false;
  let randomPolicy = false;
  let declineStack = false;
  let declineChallenge = false;
  let forgetUno = false;
  let noUnoCatch = false;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    switch (flag) {
      case '--players':
        config.playerCount = Number(value);
        index += 1;
        break;
      case '--seed':
        config.seed = value;
        index += 1;
        break;
      case '--max-actions':
        maxActions = Math.max(1, Number(value) || 500);
        index += 1;
        break;
      case '--difficulty':
        config.aiDifficulty = value as GameConfig['aiDifficulty'];
        index += 1;
        break;
      case '--deck-exhaustion':
        config.deckExhaustion = value as GameConfig['deckExhaustion'];
        index += 1;
        break;
      case '--quiet':
        quiet = true;
        break;
      case '--random':
        randomPolicy = true;
        break;
      case '--decline-stack':
        declineStack = true;
        break;
      case '--decline-challenge':
        declineChallenge = true;
        break;
      case '--no-challenge':
        config.challengeWild4 = false;
        break;
      case '--forget-uno':
        forgetUno = true;
        break;
      case '--no-uno-catch':
        noUnoCatch = true;
        break;
      case '--help':
        console.log(HELP);
        process.exit(0);
        break;
      default:
        break;
    }
  }

  return {
    config,
    maxActions,
    quiet,
    randomPolicy,
    declineStack,
    declineChallenge,
    forgetUno,
    noUnoCatch,
  };
}

/** 默认"有牌/能叠/能挑战/能喊能抓就先做"策略（更像真人）；--random 则完全随机 */
function chooseAction(legal: EngineAction[], policy: RngState, options: DemoOptions): EngineAction {
  if (options.randomPolicy) return legal[nextInt(policy, legal.length)]!;
  if (options.declineStack) {
    const decline = legal.find((action) => action.type === 'STACK_DECLINE');
    if (decline) return decline;
  }
  // 面对 +4 挑战窗口：默认选择挑战（能看到成功/失败两种结算），--decline-challenge 则接受摸 4
  const challenge = legal.find((action) => action.type === 'CHALLENGE_W4');
  const acceptChallenge = legal.find((action) => action.type === 'DECLINE_CHALLENGE');
  if (acceptChallenge) {
    return options.declineChallenge ? acceptChallenge : (challenge ?? acceptChallenge);
  }
  // UNO 窗口：默认先喊自己的 UNO / 抓别人忘喊的 UNO；--forget-uno / --no-uno-catch 可跳过
  const callUno = legal.find((action) => action.type === 'CALL_UNO');
  if (callUno && !options.forgetUno) return callUno;
  const catchUno = legal.find((action) => action.type === 'CATCH_UNO');
  if (catchUno && !options.noUnoCatch) return catchUno;
  const playable = legal.filter(
    (action) =>
      action.type === 'PLAY_CARD' || action.type === 'PLAY_DRAWN' || action.type === 'STACK_PLAY',
  );
  const pool = playable.length > 0 ? playable : legal;
  return pool[nextInt(policy, pool.length)]!;
}

function colorText(state: GameState): string {
  return state.currentColor ? COLOR_NAME[state.currentColor] : '待选';
}

function describeAction(action: EngineAction, state: GameState, actorSeat: number): string {
  const name = state.players[actorSeat]!.name;
  switch (action.type) {
    case 'PLAY_CARD': {
      const card = state.players[actorSeat]!.hand.find((item) => item.id === action.cardId);
      const color = action.colorChoice ? `→${COLOR_NAME[action.colorChoice]}` : '';
      return `${name} 出 ${card ? cardLabel(card) : action.cardId}${color}`;
    }
    case 'PLAY_DRAWN': {
      const card = state.drawnThisTurn;
      const color = action.colorChoice ? `→${COLOR_NAME[action.colorChoice]}` : '';
      return `${name} 出刚抽的 ${card ? cardLabel(card) : action.cardId}${color}`;
    }
    case 'DRAW':
      return `${name} 抽牌`;
    case 'END_TURN':
      return `${name} 结束回合`;
    case 'CHOOSE_COLOR':
      return `${name} 选颜色 ${COLOR_NAME[action.color]}`;
    case 'STACK_PLAY': {
      const card = state.players[actorSeat]!.hand.find((item) => item.id === action.cardId);
      const color = action.colorChoice ? `→${COLOR_NAME[action.colorChoice]}` : '';
      return `${name} 叠牌 ${card ? cardLabel(card) : action.cardId}${color}（累计 ${state.stack?.total ?? 0}）`;
    }
    case 'STACK_DECLINE': {
      const stack = state.stack;
      const leadsToChallenge =
        state.config.challengeWild4 &&
        stack !== null &&
        stack.chain.length === 1 &&
        stack.chain[0]?.kind === 'wild4';
      return leadsToChallenge
        ? `${name} 放弃叠牌，进入 +4 挑战窗口`
        : `${name} 放弃叠牌，摸 ${stack?.total ?? 0} 张`;
    }
    case 'CHALLENGE_W4':
      return `${name} 挑战 +4（查看上家手牌）`;
    case 'DECLINE_CHALLENGE':
      return `${name} 接受 +4，摸 ${state.pendingChallenge?.total ?? 4} 张`;
    case 'CALL_UNO': {
      const unoSeat = state.unoWindow?.seat ?? actorSeat;
      return `${state.players[unoSeat]!.name} 喊 UNO！`;
    }
    case 'CATCH_UNO': {
      const targetName = state.players[action.targetSeat]?.name ?? `座位 ${action.targetSeat}`;
      return `${name} 抓住 ${targetName} 没喊的 UNO（罚 2 张）`;
    }
  }
}

const options = parseArgs(process.argv.slice(2));

try {
  const seed = options.config.seed;
  let state = createInitialGame(options.config);
  const policy = createRng(`turn-policy-${String(seed)}`);
  const eventCounts = new Map<string, number>();

  const top = topCard(state)!;
  console.log('=== UNO 回合主循环演示（M1-7 规则引擎闭环）===');
  console.log(
    `人数: ${state.players.length} | 种子: ${String(seed)} | 起始牌: ${cardLabel(top)} | 颜色: ${colorText(state)} | 当前行动: ${state.players[state.currentSeat]!.name} | 方向: ${state.direction === 1 ? '顺时针' : '逆时针'}`,
  );
  console.log(
    `手牌: ${state.players.map((player) => `${player.name}:${player.hand.length}`).join(' | ')} | 抽牌堆: ${state.drawPile.length}`,
  );
  console.log(
    `规则: 宽松叠牌（+2/+4 任意互叠，弃权摸累计数）${state.config.challengeWild4 ? ' | +4 可挑战（成功出牌者摸 4 / 失败挑战者摸 6）' : ' | +4 挑战已关闭（+4 直接摸 4）'} | UNO 罚 ${state.config.unoPenalty} 张（AI 难度 ${state.config.aiDifficulty}） | 牌堆耗尽: ${state.config.deckExhaustion}${options.declineStack ? ' | 本次演示一律弃牌叠牌' : ''}${options.declineChallenge ? ' | 本次演示面对 +4 一律接受摸 4' : ''}${options.forgetUno ? ' | 本次演示人类不喊 UNO' : ''}${options.noUnoCatch ? ' | 本次演示人类不抓 UNO' : ''}${options.randomPolicy ? ' | 完全随机动作' : ''}`,
  );
  console.log('');

  const startedAt = Date.now();

  let actionCount = 0;
  while (!isGameOver(state)) {
    if (actionCount >= options.maxActions) {
      console.error(`⚠ 达到动作上限 ${options.maxActions}，对局未结束（可能是策略随机性极端情况）`);
      process.exitCode = 1;
      break;
    }

    const actorSeat = state.currentSeat;
    const legal = getLegalActions(state);
    if (legal.length === 0) throw new Error('没有合法动作，引擎状态异常');

    const action = chooseAction(legal, policy, options);
    const description = describeAction(action, state, actorSeat);
    const result = applyAction(state, action);
    state = result.state;
    actionCount += 1;

    for (const event of result.events) {
      eventCounts.set(event.type, (eventCounts.get(event.type) ?? 0) + 1);
    }

    const total = countCards(state);
    if (total !== 108) throw new Error(`牌数异常：${total}（应为 108）`);

    if (!options.quiet) {
      const stackText = state.stack ? ` 叠牌累计:${state.stack.total}` : '';
      console.log(
        `#${String(actionCount).padStart(3, ' ')} ${description}  [颜色:${colorText(state)} 抽牌堆:${state.drawPile.length} 弃牌堆:${state.discardPile.length}${stackText}]`,
      );
    }
  }

  if (isGameOver(state)) {
    const result = getResult(state, { durationMs: Date.now() - startedAt });
    const winnerName = result.winnerSeat === null ? '平局' : state.players[result.winnerSeat]!.name;
    console.log('\n--- 对局结束 ---');
    console.log(
      `结果: ${result.isDraw ? '平局（牌堆耗尽，手牌最少者并列）' : `${winnerName} 获胜`} | 结束原因: ${result.reason === 'empty-hand' ? '出完手牌' : '牌堆耗尽'} | 动作数: ${result.actions} | 回合数: ${result.turns} | 用时: ${result.durationMs}ms | 全牌校验: ${countCards(state)}/108 ✔`,
    );
    console.log(
      `剩余手牌（趣味分）: ${result.players.map((player) => `${player.name}:${player.remaining.length} 张/${player.score} 分`).join(' | ')} | 抽牌堆: ${state.drawPile.length} | 弃牌堆: ${state.discardPile.length}`,
    );
    console.log(
      `统计: 出牌 ${result.plays} | 摸牌 ${result.draws} | 叠牌 ${result.stackPlays} | 喊 UNO ${result.unoCalls}`,
    );
    console.log(
      `事件统计: ${[...eventCounts.entries()].map(([type, count]) => `${type}×${count}`).join(' ')}`,
    );
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`❌ 演示失败：${message}`);
  console.error('提示：--players 必须是 2~10 的整数，--seed 任意字符串。');
  process.exitCode = 1;
}
