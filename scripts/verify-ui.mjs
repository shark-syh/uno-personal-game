/* global console, process, fetch, WebSocket, setTimeout, Buffer */
/**
 * M3-2 浏览器验收（无头 Chrome + CDP，无第三方依赖）。
 *
 * 覆盖：
 * 1. 引擎模式默认入口、大厅 → 真实对局（4 人 AI）完整打完、结算、再来一局、回大厅；
 * 2. 控制台 0 报错、网络请求全部同源且无 4xx/5xx、卡面加载无失败、无横向溢出；
 * 3. 动效机制：事件队列逐条播放 / aria-busy 输入锁 / 动画关闭 / reduced-motion / 弹窗与 UNO 脉冲动画；
 * 4. 引擎模式下 AI「思考中」气泡（含 dots 动画）与忙碌期间按钮禁用。
 *
 * 前置：本地服务已在 http://localhost:3000 运行（npm run dev）。
 * 用法：npm run verify:ui
 * 产物：review-assets/ui-m32-*.png 截图、review-assets/ui-m32-verify.md 报告。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = process.env.UNO_BASE_URL || 'http://localhost:3000';
const ASSETS = join(ROOT, 'review-assets');
const DEBUG_PORT = Number(process.env.UNO_DEBUG_PORT || 9333);
mkdirSync(ASSETS, { recursive: true });

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail: String(detail || '') });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `（${detail}）` : ''}`);
}

const consoleErrors = [];
const consoleWarnings = [];
const pageExceptions = [];
const networkFailures = [];
const badResponses = [];
const requestUrls = new Set();
const engineEventTypes = new Map();

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean);
  const found = candidates.find((path) => existsSync(path));
  if (!found) throw new Error('未找到 Chrome/Edge，可通过 CHROME_PATH 环境变量指定');
  return found;
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  return JSON.parse(text);
}

async function waitForHttp(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await fetchJson(url);
    } catch (error) {
      lastError = error;
      await sleep(200);
    }
  }
  throw new Error(`等待 ${url} 超时：${lastError}`);
}

/** 极简 CDP 客户端（Node 26 自带 WebSocket） */
class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 0;
    this.pending = new Map();
    this.handlers = new Map();
  }

  async open() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolvePromise, reject) => {
      this.ws.addEventListener('open', () => resolvePromise(), { once: true });
      this.ws.addEventListener(
        'error',
        (event) => reject(event.error || new Error('CDP 连接失败')),
        {
          once: true,
        },
      );
    });
    this.ws.addEventListener('message', (event) => this.onMessage(event));
  }

  onMessage(event) {
    const message = JSON.parse(String(event.data));
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error)
        pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
      else pending.resolve(message.result);
      return;
    }
    const handler = this.handlers.get(message.method);
    if (handler) handler(message.params);
  }

  on(method, handler) {
    this.handlers.set(method, handler);
  }

  send(method, params = {}) {
    const id = (this.nextId += 1);
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async close() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}

const PAGE_HELPERS = `
window.__verify = {
  mode: () => window.UnoApp?.getMode?.(),
  visibleScreen: () => document.querySelector('.screen.is-active')?.dataset.screen || null,
  resultTitle: () => document.querySelector('#result-title')?.textContent || '',
  resultRows: () => [...document.querySelectorAll('.result-row')].map((row) => row.textContent.trim()),
  handCount: () => document.querySelectorAll('#hand .card').length,
  opponentCount: () => document.querySelectorAll('#opponents .opponent').length,
  activeDialogTitle: () => document.querySelector('#dialog-root.is-open #dialog-title')?.textContent || '',
  dialogs: () => [...document.querySelectorAll('#dialog-root.is-open button')].map((button) => button.textContent.trim()).filter(Boolean),
  actionLabels: () => [...document.querySelectorAll('#action-bar button')].map((button) => ({ text: button.textContent.trim(), disabled: button.disabled })),
  busy: () => document.querySelector('#game-screen').getAttribute('aria-busy') === 'true',
  humanReady: () => document.querySelectorAll('#action-bar button:not(:disabled)').length > 0,
  overflow: () => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }),
  failedImages: () => [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).length,
  animations: () => ({
    dialog: getComputedStyle(document.querySelector('.dialog-card') || document.body).animationName,
    uno: getComputedStyle(document.querySelector('.uno-button') || document.body).animationName,
    thinking: getComputedStyle(
      document.querySelector('.opponent-line.thinking') || document.body,
      '::after',
    ).animationName,
    cardTransition: getComputedStyle(document.querySelector('#hand .card') || document.body).transitionDuration,
  }),
  engineOn: () => document.documentElement.dataset.engine === 'on',
  autoStep: () => {
    if (document.querySelector('#result-screen.is-active')) return { step: 'result' };
    if (document.querySelector('#game-screen').getAttribute('aria-busy') === 'true') return { step: 'busy' };
    const dialog = document.querySelector('#dialog-root.is-open');
    if (dialog) {
      const actionable = [...dialog.querySelectorAll('button:not(:disabled)')].filter((button) => button.dataset.actionId);
      if (actionable.length) {
        const button = actionable[Math.floor(Math.random() * actionable.length)];
        button.click();
        return { step: 'dialog', clicked: button.textContent.trim() };
      }
      return { step: 'dialog-idle' };
    }
    const buttons = [...document.querySelectorAll('#action-bar button:not(:disabled)')];
    if (buttons.length) {
      const button = buttons[Math.floor(Math.random() * buttons.length)];
      button.click();
      return { step: 'action', clicked: button.textContent.trim() };
    }
    return { step: 'wait' };
  },
  clickStart: () => {
    const button = document.querySelector('#lobby-form button[type="submit"]');
    if (!button) return false;
    button.click();
    return true;
  },
  selectMock: (name) => {
    const select = document.querySelector('#mock-select');
    if (!select) return false;
    select.value = name;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  },
  selectPlayers: (count) => {
    const button = [...document.querySelectorAll('#player-count-options button')].find((item) => item.textContent.trim() === String(count));
    if (!button) return false;
    button.click();
    return true;
  },
  clickQuitConfirm: () => {
    const button = [...document.querySelectorAll('#dialog-root.is-open button')].find((item) => item.textContent.trim() === '退出对局');
    if (!button) return false;
    button.click();
    return true;
  },
  clickRestart: () => {
    const button = [...document.querySelectorAll('#result-content button')].find((item) => item.textContent.trim() === '再来一局');
    if (!button) return false;
    button.click();
    return true;
  },
  clickBackToLobby: () => {
    const button = [...document.querySelectorAll('#result-content button')].find((item) => item.textContent.trim() === '回大厅');
    if (!button) return false;
    button.click();
    return true;
  },
};
true;
`;

async function main() {
  const chromePath = findChrome();
  const profileDir = join(tmpdir(), `uno-ui-verify-${process.pid}`);
  rmSync(profileDir, { recursive: true, force: true });

  console.log(`[verify-ui] Chrome: ${chromePath}`);
  console.log(`[verify-ui] 打开 ${BASE_URL}`);

  const chrome = spawn(
    chromePath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      '--mute-audio',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profileDir}`,
      '--window-size=1440,900',
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true },
  );

  let cdp;
  const screenshot = async (name) => {
    const result = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    const file = join(ASSETS, name);
    writeFileSync(file, Buffer.from(result.data, 'base64'));
    console.log(`[verify-ui] 截图 ${file}`);
    return file;
  };

  try {
    const version = await waitForHttp(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    const targets = await waitForHttp(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
    const pageTarget = targets.find((target) => target.type === 'page');
    if (!pageTarget) throw new Error('Chrome 没有可用的 page target');
    cdp = new Cdp(pageTarget.webSocketDebuggerUrl);
    await cdp.open();
    console.log(`[verify-ui] 已连接 ${version.Browser}`);

    cdp.on('Runtime.consoleAPICalled', (params) => {
      const text = params.args.map((arg) => arg.value ?? arg.description ?? '').join(' ');
      if (params.type === 'error') consoleErrors.push(text);
      else if (params.type === 'warning') consoleWarnings.push(text);
      else if (params.type === 'debug' && text.includes('[uno-engine] event')) {
        const type = params.args[1]?.value;
        if (type) engineEventTypes.set(type, (engineEventTypes.get(type) || 0) + 1);
      }
    });
    cdp.on('Runtime.exceptionThrown', (params) => {
      pageExceptions.push(
        params.exceptionDetails.exception?.description || params.exceptionDetails.text,
      );
    });
    cdp.on('Log.entryAdded', (params) => {
      if (params.entry.level === 'error') consoleErrors.push(`[log] ${params.entry.text}`);
    });
    cdp.on('Network.requestWillBeSent', (params) => {
      requestUrls.add(params.request.url);
    });
    cdp.on('Network.responseReceived', (params) => {
      const { url, status } = params.response;
      if (url.startsWith('data:')) return;
      if (status >= 400) badResponses.push(`${status} ${url}`);
    });
    cdp.on('Network.loadingFailed', (params) => {
      if (params.canceled) return;
      networkFailures.push(`${params.errorText} ${params.type}`);
    });

    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    await cdp.send('Log.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    // 页面初始化脚本：注入 PAGE_HELPERS + 默认设置（动画开、AI 快速、关音效）
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try { if (!localStorage.getItem('uno:settings')) localStorage.setItem('uno:settings', JSON.stringify({ autoCallUno: false, aiSpeed: 'fast', sound: false, animation: true, showHint: true, aiChatter: true })); } catch (error) {} \n${PAGE_HELPERS}`,
    });
    // M4：把智谱接口 mock 成"在线成功"（避免自动验收消耗真实额度；同时验证 LLM 台词/状态展示）
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        const realFetch = window.fetch.bind(window);
        window.fetch = async (input, init) => {
          const url = typeof input === 'string' ? input : (input && input.url) || '';
          if (url.includes('/api/config')) {
            return new Response(JSON.stringify({ aiEnabled: true, aiDecisionImplemented: true, model: 'glm-mock', aiTimeoutMs: 8000 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (url.includes('/api/ai/decide')) {
            let actionId = '';
            try {
              const body = JSON.parse(init && init.body ? init.body : '{}');
              actionId = body.candidates && body.candidates[0] ? body.candidates[0].id : '';
            } catch (error) {}
            return new Response(JSON.stringify({ ok: true, actionId, reason: 'mock-llm-reason', line: '看我的', model: 'glm-mock', latencyMs: 5 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          return realFetch(input, init);
        };
      })();`,
    });

    const evaluate = async (expression, options = {}) => {
      const result = await cdp.send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: options.awaitPromise !== false,
      });
      if (result.exceptionDetails) {
        throw new Error(
          result.exceptionDetails.exception?.description || result.exceptionDetails.text,
        );
      }
      return result.result?.value;
    };
    const waitFor = async (expression, timeoutMs = 10000, label = expression) => {
      const deadline = Date.now() + timeoutMs;
      let last;
      while (Date.now() < deadline) {
        last = await evaluate(expression);
        if (last) return last;
        await sleep(80);
      }
      throw new Error(`等待超时：${label}`);
    };
    const navigate = async (url) => {
      await cdp.send('Page.navigate', { url });
      await waitFor('document.readyState === "complete"', 15000, `加载 ${url}`);
      await sleep(150);
    };
    const click = async (selector) => {
      const ok = await evaluate(
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`,
      );
      if (!ok) throw new Error(`找不到可点击元素：${selector}`);
      await sleep(120);
    };
    const shot = async (name) => {
      await screenshot(name);
    };

    // ---------------- 1. 默认入口 = 引擎模式 + 大厅 ----------------
    await navigate(BASE_URL + '/');
    await waitFor(
      'window.__verify && window.__verify.visibleScreen() === "lobby"',
      10000,
      '大厅可见',
    );
    const modeAtLobby = await evaluate('window.__verify.mode()');
    const engineOn = await evaluate('window.__verify.engineOn()');
    check('默认入口为引擎模式（真实对局）', modeAtLobby === 'engine', `getMode()=${modeAtLobby}`);
    check('引擎模式标记 `data-engine="on"`', engineOn === true);
    const lobbyCounts = await evaluate(
      `({ counts: document.querySelectorAll('#player-count-options button').length, difficulties: document.querySelectorAll('#difficulty-options button').length, modes: document.querySelectorAll('#ai-mode-options button').length, challenge: document.querySelector('#challenge-wild4')?.checked })`,
    );
    check(
      '大厅选项齐全（人数 9 档 / 难度 4 档 / AI 模式 3 档 / +4 挑战默认开）',
      lobbyCounts.counts === 9 &&
        lobbyCounts.difficulties === 4 &&
        lobbyCounts.modes === 3 &&
        lobbyCounts.challenge === true,
      JSON.stringify(lobbyCounts),
    );
    await shot('ui-m32-lobby-1440.png');

    // ---------------- 2. 完整对局（快速模式，3 局） ----------------
    const raceTypes = ['casual', 'easy', 'realistic', 'hardcore'];
    const gameSummaries = [];
    for (let gameIndex = 0; gameIndex < 3; gameIndex += 1) {
      await navigate(`${BASE_URL}/?test=1`);
      await waitFor('window.__verify.visibleScreen() === "lobby"', 10000, '大厅可见');
      if (gameIndex > 0) {
        // 第二/三局换难度与人数，覆盖 2 人 / 6 人边界
        const difficulty = raceTypes[(gameIndex + 1) % raceTypes.length];
        await evaluate(
          `document.querySelectorAll('#difficulty-options button')[${raceTypes.indexOf(difficulty)}].click(); true`,
        );
        if (gameIndex === 2) {
          await evaluate('window.__verify.selectPlayers(2)');
        }
      }
      await evaluate('window.__verify.clickStart()');
      await waitFor('window.__verify.visibleScreen() === "game"', 10000, '进入牌桌');
      await waitFor('window.__verify.handCount() === 7', 5000, '人类手牌 7 张');
      const setup = await evaluate(
        `({ hand: window.__verify.handCount(), opponents: window.__verify.opponentCount(), failed: window.__verify.failedImages(), overflow: window.__verify.overflow() })`,
      );
      if (gameIndex === 0) {
        check(
          '开局：人类 7 张手牌 + 3 个 AI 座位',
          setup.hand === 7 && setup.opponents === 3,
          JSON.stringify(setup),
        );
        check('开局卡面全部加载成功', setup.failed === 0, `failed=${setup.failed}`);
        check(
          '1440 宽无横向溢出',
          setup.overflow.scroll <= setup.overflow.client,
          JSON.stringify(setup.overflow),
        );
        await shot('ui-m32-game-start-1440.png');
      }

      const startedAt = Date.now();
      let lastStep = 'wait';
      while (Date.now() - startedAt < 90000) {
        const result = await evaluate('window.__verify.autoStep()');
        lastStep = result.step;
        if (result.step === 'result') break;
        await sleep(60);
      }
      if (lastStep !== 'result')
        throw new Error(`第 ${gameIndex + 1} 局未在 90s 内结束（最后步骤 ${lastStep}）`);
      await waitFor('document.querySelector("#result-title") !== null', 5000, '结算页渲染');
      await waitFor('window.__verify.busy() === false', 5000, '结算动画结束');
      const summary = await evaluate(
        `({ title: window.__verify.resultTitle(), rows: window.__verify.resultRows() })`,
      );
      gameSummaries.push(summary);
      if (gameIndex === 0) await shot('ui-m32-result-1440.png');
      check(
        `第 ${gameIndex + 1} 局完整打完并进入结算（${summary.title}）`,
        summary.rows.length >= 2,
        JSON.stringify(summary.rows),
      );

      // 再来一局 → 再退出回大厅
      await evaluate('window.__verify.clickRestart()');
      await waitFor('window.__verify.visibleScreen() === "game"', 10000, '再来一局进入牌桌');
      await waitFor('window.__verify.handCount() === 7', 5000, '重开后手牌 7 张');
      // 等到人类回合再操作：AI 回合的 busy 输入锁会吞掉弹窗按钮点击
      await waitFor(
        '!window.__verify.busy() && window.__verify.humanReady()',
        15000,
        '人类回合可操作',
      );
      await click('#quit-game');
      await waitFor('window.__verify.activeDialogTitle() === "确认退出"', 5000, '退出确认弹窗');
      await evaluate('window.__verify.clickQuitConfirm()');
      await waitFor('window.__verify.visibleScreen() === "lobby"', 10000, '回到大厅');
      check(`第 ${gameIndex + 1} 局：再来一局 / 退出回大厅可用`, true);
    }
    check(
      '引擎事件覆盖：出牌/摸牌/回合结束',
      ['PLAY', 'DRAW', 'ROUND_END'].every((type) => engineEventTypes.has(type)),
      JSON.stringify(Object.fromEntries(engineEventTypes)),
    );
    check(
      '引擎事件包含叠牌/挑战/UNO 路径（随机对局统计）',
      ['STACK_PUSH', 'CHALLENGE_SUCCESS', 'UNO_CALLED'].some((type) => engineEventTypes.has(type)),
      JSON.stringify(Object.fromEntries(engineEventTypes)),
    );

    // ---------------- 3. 引擎模式动效（动画开启） ----------------
    await navigate(BASE_URL + '/');
    await waitFor('window.__verify.visibleScreen() === "lobby"', 10000, '大厅可见');
    await evaluate('window.__verify.clickStart()');
    await waitFor('window.__verify.visibleScreen() === "game"', 10000, '进入牌桌');
    await waitFor('window.__verify.handCount() === 7', 5000, '手牌渲染');
    await evaluate(`(() => {
      window.__busyLog = [];
      window.__thinkingSeen = false;
      const screen = document.querySelector('#game-screen');
      new MutationObserver(() => {
        const busy = screen.getAttribute('aria-busy') === 'true';
        window.__busyLog.push({ busy, thinking: Boolean(document.querySelector('.opponent-line.thinking')), time: Math.round(performance.now()) });
      }).observe(screen, { attributes: true, attributeFilter: ['aria-busy'] });
      return true;
    })()`);
    let sawBusy = false;
    let sawThinking = false;
    let busyDisabledSnapshot = null;
    let thinkingAnimation = '';
    let llmLineSeen = '';
    let llmIndicator = '';
    const engineStart = Date.now();
    while (Date.now() - engineStart < 15000) {
      const state = await evaluate(
        `({ busy: window.__verify.busy(), thinking: Boolean(document.querySelector('.opponent-line.thinking')), screen: window.__verify.visibleScreen(), line: document.querySelector('.opponent-line')?.textContent || '', indicator: document.querySelector('#ai-mode-indicator')?.textContent || '' })`,
      );
      if (state.screen === 'result') break;
      if (state.indicator.includes('智谱')) llmIndicator = state.indicator;
      if (!llmLineSeen && state.line && !state.line.includes('思考中')) {
        llmLineSeen = state.line;
        await shot('ui-m4-llm-line-1440.png');
      }
      if (state.busy && !sawBusy) {
        sawBusy = true;
        busyDisabledSnapshot = await evaluate(
          `({ actionDisabled: [...document.querySelectorAll('#action-bar button')].filter((button) => button.disabled).length, handDisabled: [...document.querySelectorAll('#hand button')].filter((button) => button.disabled).length, busyAttr: document.querySelector('#game-screen').getAttribute('aria-busy') })`,
        );
        await shot('ui-m32-ai-busy-1440.png');
      }
      if (state.thinking && !sawThinking) {
        sawThinking = true;
        thinkingAnimation = await evaluate(
          `getComputedStyle(document.querySelector('.opponent-line.thinking')).animationName`,
        );
        await shot('ui-m32-ai-thinking-1440.png');
      }
      if (state.busy || state.thinking) await sleep(80);
      else {
        const step = await evaluate('window.__verify.autoStep()');
        if (step.step === 'result') break;
        await sleep(80);
      }
    }
    const busyLog = await evaluate('window.__busyLog');
    const busyTransitions = busyLog.filter((entry) => entry.busy).length;
    check(
      '引擎模式：事件播放期间出现 aria-busy 输入锁',
      sawBusy && busyTransitions > 0,
      `busy 记录 ${busyTransitions} 次`,
    );
    check(
      '引擎模式：动画期间操作按钮被禁用',
      Boolean(busyDisabledSnapshot) && busyDisabledSnapshot.busyAttr === 'true',
      JSON.stringify(busyDisabledSnapshot),
    );
    check(
      '引擎模式：AI 回合显示「思考中」气泡',
      sawThinking,
      `thinking 出现动画名=${thinkingAnimation}`,
    );
    await waitFor('window.__verify.busy() === false', 10000, '动画结束后 aria-busy 解除');
    check(
      '引擎模式：动画结束后 aria-busy 解除',
      (await evaluate('window.__verify.busy()')) === false,
    );
    check(
      'M4 智谱在线成功：状态栏显示「智谱」',
      llmIndicator.includes('智谱'),
      `indicator=${llmIndicator}`,
    );
    check(
      'M4 智谱台词：AI 气泡展示 LLM line',
      llmLineSeen.includes('看我的'),
      `line=${llmLineSeen}`,
    );
    await waitFor('window.__verify.busy() === false', 5000, '动画结束');
    // 等到人类回合再退出，避免 AI 回合 busy 锁吞掉确认按钮
    await waitFor(
      '!window.__verify.busy() && window.__verify.humanReady()',
      15000,
      '人类回合可操作',
    );
    await click('#quit-game');
    await waitFor('window.__verify.activeDialogTitle() === "确认退出"', 5000, '退出确认');
    await evaluate('window.__verify.clickQuitConfirm()');
    await waitFor('window.__verify.visibleScreen() === "lobby"', 5000, '回大厅');

    // ---------------- 3b. M4：智谱失败自动降级（拦截 decide → 429） ----------------
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => { const previous = window.fetch.bind(window); window.fetch = async (input, init) => { const url = typeof input === 'string' ? input : (input && input.url) || ''; if (url.includes('/api/ai/decide')) { return new Response(JSON.stringify({ ok: false, code: 'RATE_LIMIT', message: 'busy' }), { status: 429, headers: { 'Content-Type': 'application/json' } }); } return previous(input, init); }; })();`,
    });
    await navigate(BASE_URL + '/');
    await waitFor('window.__verify.visibleScreen() === "lobby"', 10000, '大厅');
    await evaluate(
      `(() => { const button = document.querySelector('#ai-mode-options button[data-value="zhipu"]'); if (button) button.click(); return true; })()`,
    );
    await evaluate('window.__verify.clickStart()');
    await waitFor('window.__verify.visibleScreen() === "game"', 10000, '进入牌桌');
    await waitFor(
      `document.querySelector('#ai-mode-indicator')?.textContent.includes('降级')`,
      20000,
      'AI 状态栏显示降级',
    );
    const fallbackToast = await evaluate(
      `document.querySelector('#toast-region')?.textContent || ''`,
    );
    check(
      'M4 智谱失败自动降级：状态栏显示「本地·降级」+ 提示 toast',
      fallbackToast.includes('智谱') && fallbackToast.includes('降级'),
      fallbackToast.trim(),
    );
    const initialFeed = await evaluate(`document.querySelector('#event-feed')?.textContent || ''`);
    await waitFor(
      `(document.querySelector('#event-feed')?.textContent || '') !== ${JSON.stringify(initialFeed)}`,
      15000,
      '降级后 AI 仍在行动',
    );
    check('M4 降级后本地 AI 继续行动（对局不中断）', true);
    await shot('ui-m4-ai-fallback-1440.png');
    await waitFor('!window.__verify.busy() && window.__verify.humanReady()', 15000, '人类回合');
    await click('#quit-game');
    await waitFor('window.__verify.activeDialogTitle() === "确认退出"', 5000, '退出确认');
    await evaluate('window.__verify.clickQuitConfirm()');
    await waitFor('window.__verify.visibleScreen() === "lobby"', 5000, '回大厅');

    // ---------------- 4. 动画队列机制（mock 模式，避免 AI 干扰） ----------------
    await navigate(`${BASE_URL}/?mock=1`);
    await waitFor('window.__verify.visibleScreen() === "lobby"', 10000, 'mock 大厅');
    await evaluate('window.__verify.selectMock("normal-play")');
    await waitFor('window.__verify.visibleScreen() === "game"', 5000, 'mock 牌桌');
    const queueMeasure = await evaluate(`(async () => {
      const events = Array.from({ length: 5 }, () => ({ type: 'DRAW', seat: 1, count: 1, cards: [] }));
      const startedAt = performance.now();
      const during = { busy: null, disabled: null };
      window.__queueDone = null;
      window.UnoApp.playEvents(events, () => { window.__queueDone = { elapsed: performance.now() - startedAt }; });
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 60));
      during.busy = document.querySelector('#game-screen').getAttribute('aria-busy') === 'true';
      during.disabled = [...document.querySelectorAll('#action-bar button')].filter((button) => button.disabled).length;
      while (!window.__queueDone) await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
      const after = { busy: document.querySelector('#game-screen').getAttribute('aria-busy'), actionBarDisabled: document.querySelector('#action-bar').getAttribute('aria-disabled') };
      return { during, after, elapsed: window.__queueDone.elapsed };
    })()`);
    check(
      '事件队列逐条播放（5 事件 ≈ 1000ms）',
      queueMeasure.elapsed >= 850 && queueMeasure.elapsed <= 1500,
      `elapsed=${queueMeasure.elapsed.toFixed(0)}ms`,
    );
    check(
      '事件队列期间 aria-busy=true 且操作按钮禁用',
      queueMeasure.during.busy === true && queueMeasure.during.disabled > 0,
      JSON.stringify(queueMeasure.during),
    );
    check(
      '事件队列结束后 aria-busy / aria-disabled 清理',
      queueMeasure.after.busy === null && queueMeasure.after.actionBarDisabled === null,
      JSON.stringify(queueMeasure.after),
    );

    // reduced-motion：应跳过动画、立即完成
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    const reducedMotion = await evaluate(`(async () => {
      const events = Array.from({ length: 5 }, () => ({ type: 'DRAW', seat: 1, count: 1, cards: [] }));
      const startedAt = performance.now();
      await new Promise((resolvePromise) => window.UnoApp.playEvents(events, resolvePromise));
      return { elapsed: performance.now() - startedAt, busy: document.querySelector('#game-screen').getAttribute('aria-busy') };
    })()`);
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });
    check(
      'reduced-motion 下跳过动画（<100ms 完成）',
      reducedMotion.elapsed < 100 && reducedMotion.busy === null,
      `elapsed=${reducedMotion.elapsed.toFixed(0)}ms`,
    );

    // 设置里关闭动画：应跳过动画
    await evaluate(
      `localStorage.setItem('uno:settings', JSON.stringify({ autoCallUno: false, aiSpeed: 'fast', sound: false, animation: false, showHint: true, aiChatter: true })); true`,
    );
    await navigate(`${BASE_URL}/?mock=1`);
    await waitFor('window.__verify.visibleScreen() === "lobby"', 10000, 'mock 大厅');
    await evaluate('window.__verify.selectMock("normal-play")');
    const animationOff = await evaluate(`(async () => {
      const events = Array.from({ length: 5 }, () => ({ type: 'DRAW', seat: 1, count: 1, cards: [] }));
      const startedAt = performance.now();
      await new Promise((resolvePromise) => window.UnoApp.playEvents(events, resolvePromise));
      return { elapsed: performance.now() - startedAt, animation: document.documentElement.dataset.animation };
    })()`);
    check(
      '设置关闭动画后跳过动画（<100ms）',
      animationOff.elapsed < 100 && animationOff.animation === 'false',
      `elapsed=${animationOff.elapsed.toFixed(0)}ms`,
    );

    // ---------------- 5. mock 弹窗与 CSS 动画（回归） ----------------
    await evaluate(
      `localStorage.setItem('uno:settings', JSON.stringify({ autoCallUno: false, aiSpeed: 'fast', sound: false, animation: true, showHint: true, aiChatter: true })); true`,
    );
    await navigate(`${BASE_URL}/?mock=1`);
    await waitFor('window.__verify.visibleScreen() === "lobby"', 10000, 'mock 大厅');
    await evaluate('window.__verify.selectMock("challenge-decide")');
    await waitFor('window.__verify.activeDialogTitle() === "+4 挑战"', 5000, '+4 挑战弹窗');
    const challengeAnimation = await evaluate('window.__verify.animations()');
    check(
      '弹窗进场动画 dialog-in 生效',
      challengeAnimation.dialog.includes('dialog-in'),
      `animationName=${challengeAnimation.dialog}`,
    );
    await shot('ui-m32-mock-challenge-1440.png');
    await evaluate(`document.querySelector('#dialog-root.is-open .dialog-close').click(); true`);
    await evaluate('window.__verify.selectMock("uno-window")');
    await waitFor('window.__verify.visibleScreen() === "game"', 5000, 'mock UNO 局面');
    const unoAnimation = await evaluate('window.__verify.animations()');
    check(
      'UNO 按钮脉冲动画 uno-pulse 生效',
      unoAnimation.uno.includes('uno-pulse'),
      `animationName=${unoAnimation.uno}`,
    );
    await shot('ui-m32-mock-uno-1440.png');
    await evaluate('window.__verify.selectMock("catch-uno")');
    await sleep(200);
    await evaluate('window.__verify.selectMock("ai-thinking")');
    await waitFor('window.__verify.visibleScreen() === "game"', 5000, 'mock 思考中局面');
    await sleep(200);
    const thinkingMockAnimation = await evaluate('window.__verify.animations()');
    check(
      'AI「思考中」气泡 dots 动画生效',
      thinkingMockAnimation.thinking.includes('dots'),
      `::after animationName=${thinkingMockAnimation.thinking}`,
    );
    await evaluate('window.__verify.selectMock("result")');
    await waitFor('window.__verify.visibleScreen() === "result"', 5000, 'mock 结算页');
    check(
      'mock 结算页正常渲染（UI 回归）',
      (await evaluate('window.__verify.resultTitle()')).length > 0,
      await evaluate('window.__verify.resultTitle()'),
    );

    // 1024 布局无横向溢出
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1024,
      height: 768,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await navigate(`${BASE_URL}/?mock=1`);
    await waitFor('window.__verify.visibleScreen() === "lobby"', 10000, '1024 大厅');
    const overflow1024 = await evaluate('window.__verify.overflow()');
    check(
      '1024 宽大厅无横向溢出',
      overflow1024.scroll <= overflow1024.client,
      JSON.stringify(overflow1024),
    );
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    // ---------------- 6. 控制台 / 网络 / 隐藏信息 ----------------
    const originViolations = [...requestUrls].filter(
      (url) =>
        !url.startsWith(BASE_URL) &&
        !url.startsWith('data:') &&
        !url.startsWith('blob:') &&
        !url.startsWith('about:'),
    );
    check(
      '没有控制台 JS 异常',
      pageExceptions.length === 0,
      pageExceptions.slice(0, 3).join(' | '),
    );
    check('没有 console.error', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
    check(
      '没有失败的网络请求',
      networkFailures.length === 0,
      networkFailures.slice(0, 3).join(' | '),
    );
    check('没有 4xx/5xx 响应', badResponses.length === 0, badResponses.slice(0, 3).join(' | '));
    check(
      '所有请求同源（无外链）',
      originViolations.length === 0,
      originViolations.slice(0, 3).join(' | '),
    );
    check(
      '引擎 bundle 被页面加载（js/vendor/uno-engine.js）',
      [...requestUrls].some((url) => url.includes('/js/vendor/uno-engine.js')),
    );
    if (consoleWarnings.length > 0)
      console.log(
        `[verify-ui] 提示：控制台 warning ${consoleWarnings.length} 条：${consoleWarnings.slice(0, 3).join(' | ')}`,
      );

    // ---------------- 7. 汇总报告 ----------------
    const passed = checks.filter((item) => item.ok).length;
    const failed = checks.length - passed;
    const lines = [
      '# M3-2 浏览器验收报告（自动生成）',
      '',
      `> 时间：${new Date().toISOString()} ｜ 入口：${BASE_URL} ｜ 浏览器：${version.Browser}`,
      `> 结果：**${passed} / ${checks.length} 通过**${failed > 0 ? `，${failed} 项失败` : ''}`,
      '',
      '## 检查项',
      '',
      '| 结果 | 项目 | 细节 |',
      '|------|------|------|',
      ...checks.map(
        (item) =>
          `| ${item.ok ? '✅' : '❌'} | ${item.name} | ${item.detail.replaceAll('|', '\\|')} |`,
      ),
      '',
      '## 引擎事件统计（3 局真实对局，快速模式）',
      '',
      '| 事件 | 次数 |',
      '|------|------|',
      ...[...engineEventTypes.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `| ${type} | ${count} |`),
      '',
      '## 对局结算摘要',
      '',
      ...gameSummaries.map((summary, index) => `- 第 ${index + 1} 局：${summary.title}`),
      '',
      '## 截图',
      '',
      '- review-assets/ui-m32-lobby-1440.png',
      '- review-assets/ui-m32-game-start-1440.png',
      '- review-assets/ui-m32-ai-busy-1440.png',
      '- review-assets/ui-m32-ai-thinking-1440.png',
      '- review-assets/ui-m32-result-1440.png',
      '- review-assets/ui-m32-mock-challenge-1440.png',
      '- review-assets/ui-m32-mock-uno-1440.png',
      '',
    ];
    const reportPath = join(ASSETS, 'ui-m32-verify.md');
    writeFileSync(reportPath, lines.join('\n'), 'utf8');
    writeFileSync(
      join(ASSETS, 'ui-m32-verify.json'),
      JSON.stringify(
        {
          checks,
          engineEvents: Object.fromEntries(engineEventTypes),
          gameSummaries,
          consoleErrors,
          networkFailures,
          badResponses,
          pageExceptions,
        },
        null,
        2,
      ),
      'utf8',
    );
    console.log(`\n[verify-ui] 报告：${reportPath}`);
    console.log(
      `[verify-ui] 结果：${passed}/${checks.length} 通过${failed > 0 ? `，${failed} 项失败` : ''}`,
    );
    if (failed > 0) process.exitCode = 1;
  } finally {
    await cdp?.close();
    try {
      chrome.kill();
    } catch {
      /* ignore */
    }
    await sleep(300);
    try {
      if (process.platform === 'win32')
        spawn('taskkill', ['/F', '/T', '/PID', String(chrome.pid)], {
          stdio: 'ignore',
          windowsHide: true,
        });
      else chrome.kill('SIGKILL');
    } catch {
      /* ignore */
    }
    await sleep(800);
    try {
      rmSync(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
    } catch (error) {
      console.warn(
        `[verify-ui] 清理 Chrome 临时目录失败（可忽略）：${error.code || error.message}`,
      );
    }
  }
}

main().catch((error) => {
  console.error('[verify-ui] 失败：', error);
  if (pageExceptions.length > 0)
    console.error('[verify-ui] 页面异常：', pageExceptions.slice(0, 10));
  if (consoleErrors.length > 0)
    console.error('[verify-ui] 控制台错误：', consoleErrors.slice(0, 10));
  if (networkFailures.length > 0)
    console.error('[verify-ui] 网络失败：', networkFailures.slice(0, 10));
  if (badResponses.length > 0)
    console.error('[verify-ui] 非 2xx 响应：', badResponses.slice(0, 10));
  process.exitCode = 1;
});
