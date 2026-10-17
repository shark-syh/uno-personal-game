/**
 * M3-2 引擎模式：把真实规则引擎 + 本地 AI 接到现有 UI 上（原生 JS，零构建）。
 *
 * 架构：
 * - 引擎/AI 的 TS 由 `npm run build:web-engine` 打包成 `js/vendor/uno-engine.js`（ESM），这里直接 import；
 * - 渲染仍然只走 `window.UnoApp.render(view)` / `playEvents(events, done)` / `setActionHandler(fn)` 契约；
 * - 人类动作：UI 的 UiAction → `toEngineAction()` → `applyAction` → 新 view + events → render + 播动画 → 继续；
 * - AI 回合：`decide()` 本地决策（瞬间完成），UI 侧按难度加"思考延迟"再执行，期间显示思考气泡；
 * - UNO 窗口：给人类 2.5s 反应时间（喊 UNO / 抓人），超时后由当前行动者继续（引擎会自动结算 AI 抓人）。
 *
 * 调试参数：
 * - `?test=1`：AI 思考延迟压到 ~15ms、打印事件日志（自动化验证用，不用于正常游玩）；
 * - `?engine-dev=1`：只打印事件日志。
 */
import {
  applyAction,
  buildPlayerNames,
  createInitialGame,
  createLobbyView,
  createRng,
  decide,
  getGameView,
  isGameOver,
  normalizeGameConfig,
  toEngineAction,
} from '../vendor/uno-engine.js';
import { getSettings } from '../state/settings.js';

const AI_BASE_DELAY = { casual: 900, easy: 1100, realistic: 1400, hardcore: 1700 };
const SPEED_SCALE = { slow: 1.6, normal: 1, fast: 0.45 };
const UNO_WINDOW_MS = 2500;
const AVATARS = ['🧑', '🤖', '🧓', '🧑‍🎨', '🧑‍🚀', '🧙', '🦸', '🧑‍🍳', '🧑‍🔬', '🧑‍🌾'];

/** 当前对局运行时 */
let runtime = null;
/** 最近一次大厅配置（再来一局 / 回大厅时复用） */
let lastLobbyConfig = null;
let toast = (message) => console.log(`[uno-engine] ${message}`);

function params() {
  return new URLSearchParams(window.location.search);
}

function isTestMode() {
  return params().get('test') === '1';
}

function isDevMode() {
  return isTestMode() || params().get('engine-dev') === '1';
}

function setTimer(rt, callback, ms) {
  const id = window.setTimeout(() => {
    rt.timers.delete(id);
    if (runtime === rt) callback();
  }, ms);
  rt.timers.add(id);
  return id;
}

function clearRuntime(rt) {
  for (const id of rt.timers) window.clearTimeout(id);
  rt.timers.clear();
}

/** 补 UI 侧字段（设置 / 头像 / 思考气泡），engine view 只给引擎事实 */
function decorate(view, thinkingSeat = null) {
  view.mock = false;
  view.settings = getSettings();
  if (!view.dev) view.dev = {};
  view.players.forEach((player) => {
    if (!player.avatar) player.avatar = AVATARS[player.seat % AVATARS.length] || '🤖';
    if (typeof player.line !== 'string') player.line = '';
    if (thinkingSeat === player.seat) player.thinking = true;
  });
  return view;
}

function currentView(rt, options = {}) {
  const durationMs =
    rt.state.phase === 'round-end' ? Math.round(performance.now() - rt.startedAt) : 0;
  const view = getGameView(rt.state, rt.humanSeat, { durationMs, settings: getSettings() });
  return decorate(view, options.thinkingSeat ?? null);
}

function logEvents(rt, events) {
  if (!isDevMode()) return;
  for (const event of events) console.debug('[uno-engine] event', event.type);
}

function renderAndPlay(rt, view, after) {
  window.UnoApp.render(view);
  logEvents(rt, view.events);
  window.UnoApp.playEvents(view.events || [], () => {
    if (runtime === rt) after();
  });
}

function applyAndRender(rt, engineAction) {
  if (runtime !== rt) return;
  let applied;
  try {
    applied = applyAction(rt.state, engineAction);
  } catch (error) {
    console.error('[uno-engine] 动作被引擎拒绝', engineAction, error);
    if (typeof toast === 'function') toast('操作未被引擎接受，请重试');
    return;
  }
  rt.state = applied.state;
  renderAndPlay(rt, currentView(rt), () => continueGame(rt));
}

function pickAiAction(rt, seat) {
  const decision = decide(rt.state, seat, {
    difficulty: rt.state.config.aiDifficulty,
    rng: rt.aiRng,
  });
  if (isDevMode()) {
    console.debug('[uno-engine] ai-decision', {
      seat,
      difficulty: rt.state.config.aiDifficulty,
      action: decision.action.type,
      reason: decision.reason,
    });
  }
  return decision.action;
}

function scheduleAi(rt) {
  if (runtime !== rt || isGameOver(rt.state)) return;
  const seat = rt.state.currentSeat;
  if (seat === rt.humanSeat) return;

  // 先渲染"思考中"气泡，再按难度/设置延迟执行
  window.UnoApp.render(currentView(rt, { thinkingSeat: seat }));
  const settings = getSettings();
  const base = AI_BASE_DELAY[rt.state.config.aiDifficulty] ?? 1200;
  const scale = SPEED_SCALE[settings.aiSpeed] ?? 1;
  const delay = isTestMode() ? 15 : Math.max(120, Math.round(base * scale));

  setTimer(
    rt,
    () => {
      if (runtime !== rt || isGameOver(rt.state)) return;
      if (rt.state.currentSeat !== seat) return;
      let action;
      try {
        action = pickAiAction(rt, seat);
      } catch (error) {
        console.error('[uno-engine] AI 决策失败', error);
        if (typeof toast === 'function') toast('AI 决策失败，请点「退出」重开');
        return;
      }
      applyAndRender(rt, action);
    },
    delay,
  );
}

/** UNO 反应窗口：人类有 2.5s 点 UNO / 抓人；超时后由当前行动者继续 */
function handleUnoWindow(rt) {
  const state = rt.state;
  const view = currentView(rt);
  const windowActions = view.human.legalActions.filter(
    (action) => action.type === 'CALL_UNO' || action.type === 'CATCH_UNO',
  );

  if (windowActions.length === 0) {
    if (state.currentSeat === rt.humanSeat) {
      window.UnoApp.render(view);
      return;
    }
    scheduleAi(rt);
    return;
  }

  // 显示 UNO / 抓人按钮，并留出反应时间
  window.UnoApp.render(view);
  setTimer(
    rt,
    () => {
      if (runtime !== rt) return;
      if (rt.state.phase !== 'uno-window') return;
      if (rt.state.currentSeat === rt.humanSeat) {
        window.UnoApp.render(currentView(rt));
        return;
      }
      scheduleAi(rt);
    },
    isTestMode() ? 120 : UNO_WINDOW_MS,
  );
}

function continueGame(rt) {
  if (runtime !== rt) return;
  if (isGameOver(rt.state)) return;
  const state = rt.state;
  if (state.phase === 'uno-window') {
    handleUnoWindow(rt);
    return;
  }
  if (state.currentSeat === rt.humanSeat) return; // 人类回合：已渲染，等点击
  scheduleAi(rt);
}

function startGame(lobbyConfig = {}) {
  stopEngineMode();
  lastLobbyConfig = {
    playerCount: 4,
    difficulty: 'realistic',
    aiMode: 'auto',
    challengeWild4: true,
    playerName: '你',
    ...lobbyConfig,
  };
  const settings = getSettings();
  const seed = `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  let config;
  try {
    config = normalizeGameConfig({
      playerCount: lastLobbyConfig.playerCount,
      humanSeat: 0,
      aiDifficulty: lastLobbyConfig.difficulty,
      aiMode: lastLobbyConfig.aiMode,
      challengeWild4: lastLobbyConfig.challengeWild4 !== false,
      autoCallUno: settings.autoCallUno === true,
      seed,
    });
  } catch (error) {
    console.error('[uno-engine] 开局配置非法', error);
    if (typeof toast === 'function') toast('开局配置非法，请检查大厅选项');
    renderLobby();
    return;
  }

  const names = buildPlayerNames(config);
  names[0] = String(lastLobbyConfig.playerName || '你').trim().slice(0, 12) || '你';
  config.names = names;

  const state = createInitialGame(config);
  const rt = {
    state,
    humanSeat: 0,
    aiRng: createRng(`web-ai-${seed}`),
    timers: new Set(),
    startedAt: performance.now(),
    lobbyConfig: { ...lastLobbyConfig },
  };
  runtime = rt;
  document.documentElement.dataset.engine = 'on';

  window.UnoApp.setActionHandler(handleAction);
  if (isDevMode()) console.debug('[uno-engine] game-start', { seed, config: rt.state.config });
  renderAndPlay(rt, currentView(rt), () => continueGame(rt));
}

function renderLobby() {
  const view = createLobbyView(lastLobbyConfig || {}, getSettings());
  view.mock = false;
  view.settings = getSettings();
  window.UnoApp.render(view);
}

function handleAction(action) {
  if (!action || typeof action.type !== 'string') return;

  if (action.type === 'START_GAME') {
    startGame(action.config || {});
    return;
  }
  if (action.type === 'RESTART') {
    startGame(lastLobbyConfig || {});
    return;
  }
  if (action.type === 'BACK_TO_LOBBY') {
    stopEngineMode();
    renderLobby();
    return;
  }
  if (!runtime) return;

  let engineAction;
  try {
    engineAction = toEngineAction(action);
  } catch (error) {
    console.error('[uno-engine] 无法识别的 UI 动作', action, error);
    return;
  }
  applyAndRender(runtime, engineAction);
}

/** 进入引擎模式（大厅或对局都由渲染层展示） */
export function startEngineMode(options = {}) {
  if (typeof options.toast === 'function') toast = options.toast;
  stopEngineMode();
  document.documentElement.dataset.engine = 'on';
  window.UnoApp.setActionHandler(handleAction);
  renderLobby();
}

/** 退出引擎模式（切 mock / 页面销毁时清理定时器，避免 AI 在后台继续行动） */
export function stopEngineMode() {
  if (runtime) {
    clearRuntime(runtime);
    runtime = null;
  }
  document.documentElement.dataset.engine = 'off';
}

export function isEngineModeActive() {
  return runtime !== null;
}
