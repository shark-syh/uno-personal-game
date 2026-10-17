/**
 * 开局演示脚本（M1-1 验证用）：不需要 UI，直接看开局发牌结果。
 *
 * 用法：
 *   npm run demo:deal
 *   npm run demo:deal -- --players 6 --seed hello
 *   npm run demo:deal -- --players 2 --count 5
 *   npm run demo:deal -- --ignore-action
 *   npm run demo:deal -- --human-first
 */
import { COLOR_NAME, cardLabel } from '../packages/game-core/src/deck.ts';
import { countCards, createInitialGame } from '../packages/game-core/src/setup.ts';
import type { GameConfig } from '../packages/game-core/src/types.ts';

interface DemoOptions {
  config: Partial<GameConfig>;
  count: number;
}

const HELP = `UNO 开局演示（M1-1）

参数：
  --players <2-10>    对局人数（默认 4）
  --seed <字符串>     随机种子（默认 demo-seed，可复现）
  --count <次数>      连续演示多个种子（默认 1）
  --human-first       强制人类先手
  --ignore-action     起手动作牌时忽略并重新翻
  --help              显示帮助

示例：
  npm run demo:deal -- --players 6 --seed hello
  npm run demo:deal -- --players 2 --count 5
`;

function parseArgs(argv: string[]): DemoOptions {
  const config: Partial<GameConfig> = { playerCount: 4, seed: 'demo-seed' };
  let count = 1;

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
      case '--count':
        count = Math.max(1, Number(value) || 1);
        index += 1;
        break;
      case '--human-first':
        config.startingPlayer = 'human';
        break;
      case '--ignore-action':
        config.startCardRule = 'ignore-action';
        break;
      case '--help':
        console.log(HELP);
        process.exit(0);
        break;
      default:
        break;
    }
  }

  return { config, count };
}

const options = parseArgs(process.argv.slice(2));

try {
  for (let round = 0; round < options.count; round += 1) {
    const seed =
      options.count === 1 ? options.config.seed : `${String(options.config.seed)}-${round + 1}`;
    const state = createInitialGame({ ...options.config, seed });
  const top = state.discardPile[state.discardPile.length - 1]!;
  const colorText = state.currentColor ? COLOR_NAME[state.currentColor] : '待选色';
  const directionText = state.direction === 1 ? '顺时针' : '逆时针';

  if (options.count > 1) {
    console.log(
      `#${round + 1} 种子=${String(seed)} | 起始牌=${cardLabel(top)} | 颜色=${colorText} | 当前行动=${state.players[state.currentSeat]!.name} | 牌数=${countCards(state)}`,
    );
    continue;
  }

  console.log('=== UNO 开局演示（M1-1）===');
  console.log(
    `人数: ${state.players.length} | 种子: ${String(seed)} | 叠加规则: ${state.config.stacking === 'loose' ? '宽松叠牌' : state.config.stacking} | 起手规则: ${state.config.startCardRule}`,
  );
  console.log(
    `庄家: ${state.players[state.dealerSeat]!.name} | 当前行动: ${state.players[state.currentSeat]!.name} | 方向: ${directionText}`,
  );
  console.log(`起始牌: ${cardLabel(top)} | 当前颜色: ${colorText}`);
  if (state.phase === 'choose-color') {
    console.log(`注意: 起手是 Wild，等待 ${state.players[state.currentSeat]!.name} 选色（M1-2 实现选色动作）`);
  }
  console.log('');
  for (const player of state.players) {
    const marker = player.seat === state.currentSeat ? '▶' : ' ';
    const human = player.isHuman ? ' [真人]' : '';
    console.log(
      `${marker} ${player.name}${human} · ${player.hand.length} 张: ${player.hand
        .map((card) => cardLabel(card))
        .join(' · ')}`,
    );
  }
  console.log('');
  console.log(
    `抽牌堆: ${state.drawPile.length} 张 | 弃牌堆: ${state.discardPile.length} 张 | 全牌校验: ${countCards(state)} / 108 ${countCards(state) === 108 ? '✔' : '✘'}`,
  );
  console.log(
    `事件: ${state.events
      .map((event) => (event.type === 'DEAL' ? `DEAL(座位${event.seat},${event.count}张)` : event.type))
      .join(' → ')}`,
  );
  console.log('');
  console.log('提示: --players 2~10 / --seed 任意字符串 / --count 5 / --ignore-action / --human-first');
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`❌ 开局失败：${message}`);
  console.error('提示：--players 必须是 2~10 的整数，--seed 任意字符串。');
  process.exitCode = 1;
}
