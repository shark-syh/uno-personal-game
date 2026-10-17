/**
 * 引擎模式：把真实规则引擎 + 本地/智谱混合 AI 接到现有 UI 上（原生 JS，零构建）。
 *
 * M3-2：大厅 START_GAME → createInitialGame → getGameView → render + playEvents；AI 本地决策 + 思考延迟；
 *        UNO 窗口 2.5s；结算/再来一局/回大厅；默认入口为引擎模式，mock 保留 ?mock=1。
 * M4：AI 回合先尝试「本地候选 → 服务端 /api/ai/decide（智谱）→ 校验 → 应用」，失败/超时/限流
 *      自动降级 M2 本地 AI；台词写入玩家气泡；状态栏显示 智谱 / 本地 / 本地·降级。
 *
 * 调试参数：?test=1（快速模式：AI 延迟 15ms、不走智谱、打印事件日志）；?engine-dev=1（仅打印日志）。
 */
import {
  applyAction,
  buildMemory,
  buildPlayerNames,
  createInitialGame,
  createLobbyView,
  createRng,
  decide,
  generateCandidates,
  getAiView,
  getDifficultyProfile,
  getGameView,
  isGameOver,
  nextFloat,
  normalizeGameConfig,
  toEngineAction,
} from '../vendor/uno-engine.js';
import { aiErrorMessage, createAiClient, getServerAiConfig } from '../ai/aiClient.js';
import { getSettings } from '../state/settings.js';
import { clearAllLines, clearPlayerLine } from '../ui/players.js';

const AI_BASE_DELAY = { casual: 900, easy: 1100, realistic: 1400, hardcore: 1700 };
const SPEED_SCALE = { slow: 1.6, normal: 1, fast: 0.45 };
const LLM_CHANCE = { casual: 0.3, easy: 0.6, realistic: 1, hardcore: 1 };
const UNO_WINDOW_MS = 2500;
/** BUG-04：AI 台词存活时间（到期只删该座位气泡并清 map，不做整页 render） */
const AI_LINE_TTL = 2600;
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

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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

/** 取消某个座位的台词 TTL 计时器（计时器 id 同时登记在 rt.timers 里统一清理） */
function clearAiLineTimer(rt, seat) {
  const id = rt.aiLineTimers.get(seat);
  if (id === undefined) return;
  window.clearTimeout(id);
  rt.timers.delete(id);
  rt.aiLineTimers.delete(seat);
}

/**
 * BUG-04：清空所有 AI 台词（map + TTL 计时器 + 气泡 DOM）。
 * 用于新局 / 回大厅 / stopEngineMode / 结算 / 下一次 AI 决策开始（换人即消失）。
 */
function clearAiLines(rt) {
  for (const id of rt.aiLineTimers.values()) {
    window.clearTimeout(id);
    rt.timers.delete(id);
  }
  rt.aiLineTimers.clear();
  rt.aiLines.clear();
  clearAllLines();
}

/**
 * BUG-04：写入一条 AI 台词并注册 TTL。
 * 到期时只删该座位的 map 项与气泡文本（players.js 的 clearPlayerLine），
 * 不调用 UnoApp.render，避免关闭玩家弹窗或打断事件动画。
 */
function showAiLine(rt, seat, line) {
  clearAiLineTimer(rt, seat);
  rt.aiLines.set(seat, line);
  const timerId = setTimer(rt, () => {
    rt.aiLineTimers.delete(seat);
    if (rt.aiLines.get(seat) !== line) return;
    rt.aiLines.delete(seat);
    clearPlayerLine(seat);
  }, AI_LINE_TTL);
  rt.aiLineTimers.set(seat, timerId);
}

/** 补 UI 侧字段（设置 / 头像 / 台词 / AI 运行时状态） */
function decorate(view, rt, thinkingSeat = null) {
  view.mock = false;
  view.settings = getSettings();
  if (!view.dev) view.dev = {};
  view.runtimeAiMode = rt.aiRuntime;
  view.aiModel = rt.lastLlmModel;
  view.players.forEach((player) => {
    if (!player.avatar) player.avatar = AVATARS[player.seat % AVATARS.length] || '🤖';
    player.line = rt.aiLines.get(player.seat) || '';
    if (thinkingSeat === player.seat) player.thinking = true;
  });
  return view;
}

function currentView(rt, options = {}) {
  const durationMs =
    rt.state.phase === 'round-end' ? Math.round(performance.now() - rt.startedAt) : 0;
  const view = getGameView(rt.state, rt.humanSeat, { durationMs, settings: getSettings() });
  return decorate(view, rt, options.thinkingSeat ?? null);
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
  // BUG-04：对局结束/进入结算页时清空 AI 台词（map + 定时器 + 气泡）
  if (isGameOver(rt.state)) clearAiLines(rt);
  renderAndPlay(rt, currentView(rt), () => continueGame(rt));
}

/** 服务端 AI 配置（每局只取一次） */
function ensureAiConfig(rt) {
  if (rt.aiConfig) return Promise.resolve(rt.aiConfig);
  if (!rt.aiConfigPromise) {
    rt.aiConfigPromise = getServerAiConfig()
      .then((config) => {
        rt.aiConfig = config;
        if (runtime === rt && !rt.aiRuntime) {
          rt.aiRuntime = config.aiEnabled ? 'zhipu' : 'degraded';
        }
        return config;
      })
      .catch(() => {
        rt.aiConfig = { aiEnabled: false, error: true };
        if (runtime === rt && !rt.aiRuntime) rt.aiRuntime = 'degraded';
        return rt.aiConfig;
      });
  }
  return rt.aiConfigPromise;
}

/** 本地 AI 决策（M2；与 M3-2 相同，按难度加思考延迟） */
function scheduleLocalThinkingDelay(rt) {
  const settings = getSettings();
  const base = AI_BASE_DELAY[rt.state.config.aiDifficulty] ?? 1200;
  const scale = SPEED_SCALE[settings.aiSpeed] ?? 1;
  return isTestMode() ? 15 : Math.max(120, Math.round(base * scale));
}

function pickLocalAction(rt, seat) {
  const decision = decide(rt.state, seat, {
    difficulty: rt.state.config.aiDifficulty,
    rng: rt.aiRng,
  });
  if (isDevMode()) {
    console.debug('[uno-engine] ai-local', {
      seat,
      action: decision.action.type,
      reason: decision.reason,
    });
  }
  return decision.action;
}

/** 把当前局面裁剪成 LLM 请求体（仅公开信息 + 自己手牌 + 候选） */
function buildLlmPayload(rt, seat) {
  const state = rt.state;
  const profile = getDifficultyProfile(state.config.aiDifficulty);
  const view = getAiView(state, seat);
  const memory = buildMemory(view);
  const candidates = generateCandidates({ state, seat, view, memory, profile });
  const candidateMap = new Map();
  const llmCandidates = candidates.map((candidate) => {
    candidateMap.set(candidate.id, candidate);
    return {
      id: candidate.id,
      kind: candidate.kind,
      action: candidate.action.type,
      card: candidate.card ? candidate.card.faceCode : null,
      color: candidate.colorChoice || null,
      score: Number.isFinite(candidate.rawScore) ? Math.round(candidate.rawScore * 100) / 100 : 0,
      note: candidate.note,
    };
  });
  const discardTop3 = view.discardPile
    .slice(-3)
    .reverse()
    .map((card) => card.faceCode);
  return {
    candidateMap,
    payload: {
      difficulty: state.config.aiDifficulty,
      seat,
      playerName: view.players[seat].name,
      you: { hand: view.hand.map((card) => card.faceCode), handCount: view.hand.length },
      table: {
        topCard: view.topCard ? view.topCard.faceCode : null,
        currentColor: view.currentColor,
        direction: view.direction === 1 ? 'clockwise' : 'counterclockwise',
        drawPileCount: view.drawPileCount,
        discardTop3,
        stack: view.stack
          ? {
              total: view.stack.total,
              chain: view.stack.chain.map((card) => card.faceCode),
              awaitingSeat: view.stack.awaitingSeat,
            }
          : null,
        phase: view.phase,
      },
      players: view.players.map((player) => ({
        seat: player.seat,
        name: player.name,
        handCount: player.handCount,
        saidUno: player.saidUno,
        isHuman: player.isHuman,
      })),
      candidates: llmCandidates,
      historySummary: view.history.slice(-8).map((event) => event.type),
    },
  };
}

/** 是否尝试智谱：模式 / 服务端是否配置 Key / 难度参与频率（休闲 30%、简单 60%） */
async function shouldUseLlm(rt) {
  if (isTestMode()) return false;
  const mode = rt.lobbyConfig.aiMode || 'auto';
  if (mode === 'local') {
    rt.aiRuntime = 'local';
    return false;
  }
  const config = await ensureAiConfig(rt);
  if (!config.aiEnabled) {
    rt.aiRuntime = 'degraded';
    return false;
  }
  if (rt.aiRuntime !== 'zhipu' && rt.aiRuntime !== 'degraded') rt.aiRuntime = 'zhipu';
  const difficulty = rt.state.config.aiDifficulty;
  const chance = LLM_CHANCE[difficulty] ?? 1;
  if (chance >= 1) return true;
  return nextFloat(rt.aiRng) < chance;
}

/** 一次 AI 行动：优先智谱（候选约束），失败降级本地 */
async function runAiAction(rt, seat) {
  if (runtime !== rt || isGameOver(rt.state) || rt.state.currentSeat !== seat) return;

  const useLlm = await shouldUseLlm(rt);
  if (runtime !== rt || isGameOver(rt.state) || rt.state.currentSeat !== seat) return;

  if (useLlm) {
    let built;
    try {
      built = buildLlmPayload(rt, seat);
    } catch (error) {
      console.error('[uno-engine] 构造 AI 候选失败，降级本地', error);
      built = null;
    }
    if (built) {
      if (isDevMode()) {
        console.debug('[uno-engine] llm-request', {
          seat,
          difficulty: rt.state.config.aiDifficulty,
          candidates: built.payload.candidates.length,
        });
      }
      const result = await rt.aiClient.decide(built.payload);
      if (runtime !== rt || isGameOver(rt.state) || rt.state.currentSeat !== seat) return;
      if (result.ok) {
        const candidate = built.candidateMap.get(result.actionId);
        if (candidate) {
          rt.aiRuntime = 'zhipu';
          rt.lastLlmModel = result.model || rt.lastLlmModel;
          if (result.line) showAiLine(rt, seat, result.line);
          if (isDevMode()) {
            console.debug('[uno-engine] llm-decision', {
              seat,
              action: candidate.action.type,
              model: result.model,
              latencyMs: result.latencyMs,
              reason: result.reason,
              line: result.line,
            });
          }
          applyAndRender(rt, candidate.action);
          return;
        }
        result.code = 'AI_INVALID_ACTION';
      }
      rt.aiRuntime = 'degraded';
      if (!rt.aiFailureNotified) {
        rt.aiFailureNotified = true;
        if (typeof toast === 'function') toast(aiErrorMessage(result.code));
      }
      if (isDevMode()) console.debug('[uno-engine] llm-fallback', result);
    }
  }

  // 本地 AI 兜底（保留思考延迟，避免瞬间出牌）
  await sleep(scheduleLocalThinkingDelay(rt));
  if (runtime !== rt || isGameOver(rt.state) || rt.state.currentSeat !== seat) return;
  let action;
  try {
    action = pickLocalAction(rt, seat);
  } catch (error) {
    console.error('[uno-engine] AI 决策失败', error);
    if (typeof toast === 'function') toast('AI 决策失败，请点「退出」重开');
    return;
  }
  applyAndRender(rt, action);
}

/** AI 回合：先清掉上一轮台词，再显示思考气泡，最后走混合决策 */
function scheduleAi(rt) {
  if (runtime !== rt || isGameOver(rt.state)) return;
  const seat = rt.state.currentSeat;
  if (seat === rt.humanSeat) return;
  // BUG-04：下一次 AI 决策开始时清空旧台词（换人即消失）
  clearAiLines(rt);
  window.UnoApp.render(currentView(rt, { thinkingSeat: seat }));
  void runAiAction(rt, seat);
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
  // BUG-04：新局从零开始，兜底清掉上一局可能残留的台词气泡
  clearAllLines();
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
    aiClient: createAiClient(),
    aiConfig: null,
    aiConfigPromise: null,
    aiRuntime: lastLobbyConfig.aiMode === 'local' ? 'local' : null,
    aiLines: new Map(),
    /** BUG-04：每个座位台词 TTL 的 timerId（id 同时登记在 rt.timers 中） */
    aiLineTimers: new Map(),
    aiFailureNotified: false,
    lastLlmModel: null,
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
  view.runtimeAiMode = null;
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

/** 退出引擎模式（切 mock / 页面销毁时清理定时器与台词，避免 AI 在后台继续行动） */
export function stopEngineMode() {
  if (runtime) {
    // BUG-04：清 map + TTL 定时器 + 气泡 DOM，再统一清理运行时定时器
    clearAiLines(runtime);
    clearRuntime(runtime);
    runtime = null;
  } else {
    // 无运行时也兜底清一次 DOM，避免切换模式后残留上一次的气泡
    clearAllLines();
  }
  document.documentElement.dataset.engine = 'off';
}

export function isEngineModeActive() {
  return runtime !== null;
}
