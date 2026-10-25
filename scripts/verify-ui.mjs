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
// v2.0.0 M2 起：v2 阶段截图按契约存 review-assets/v2/<阶段>-<场景>-<宽度>.png
const V2_ASSETS = join(ASSETS, 'v2');
mkdirSync(V2_ASSETS, { recursive: true });

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
  opponentHands: () =>
    [...document.querySelectorAll('#opponents .opponent')].map((node) => {
      const stack = node.querySelector('.opponent-hand');
      const cards = [...node.querySelectorAll('.opponent-hand-card')];
      const rect = (element) => {
        const box = element.getBoundingClientRect();
        return [box.left, box.top, box.right, box.bottom];
      };
      let union = null;
      for (const card of cards) {
        const box = rect(card);
        union = union
          ? [
              Math.min(union[0], box[0]),
              Math.min(union[1], box[1]),
              Math.max(union[2], box[2]),
              Math.max(union[3], box[3]),
            ]
          : box;
      }
      const intersects = (a, b) => Boolean(a && b) && a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
      const first = cards[0];
      return {
        seat: Number(node.dataset.seat),
        handCount: Number(node.dataset.handCount),
        visible: Number(stack?.dataset.visible || 0),
        cards: cards.length,
        lastPlayed: Boolean(node.querySelector('.mini-card')),
        display: stack ? getComputedStyle(stack).display : 'missing',
        cardW: first ? first.offsetWidth : 0,
        cardH: first ? first.offsetHeight : 0,
        nameOverlap: intersects(union, rect(node.querySelector('.opponent-name'))),
        metaOverlap: intersects(union, rect(node.querySelector('.opponent-meta'))),
        inside: !union
          ? true
          : union[0] >= 0 && union[1] >= 0 && union[2] <= window.innerWidth && union[3] <= window.innerHeight,
      };
    }),
  activeDialogTitle: () => document.querySelector('#dialog-root.is-open #dialog-title')?.textContent || '',
  dialogs: () => [...document.querySelectorAll('#dialog-root.is-open button')].map((button) => button.textContent.trim()).filter(Boolean),
  actionLabels: () => [...document.querySelectorAll('#action-bar button')].map((button) => ({ text: button.textContent.trim(), disabled: button.disabled })),
  busy: () => document.querySelector('#game-screen').getAttribute('aria-busy') === 'true',
  humanReady: () =>
    document.querySelectorAll('#hand .card.is-legal, #action-bar button:not(:disabled)').length > 0,
  speechLines: () =>
    [...document.querySelectorAll('#speech-layer .opponent-line')]
      .map((node) => node.textContent.trim())
      .filter(Boolean),
  hintText: () => (document.querySelector('#hint-bar')?.textContent || '').trim(),
  handHeading: () => ({
    heading: Boolean(document.querySelector('.hand-heading')),
    count: Boolean(document.querySelector('#hand-count')),
    text: document.querySelector('#hand')?.textContent || '',
  }),
  // M2：大厅/牌桌品牌审计（UNO Local + 版本号 + 开启对局 + 旧文案清除 + 无音效按钮 + Tab 顺序）
  brandAudit: () => {
    const visible = (el) => {
      if (!el || el.hidden) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
    };
    const versionOk = (el) => {
      if (!visible(el)) return false;
      const text = (el.textContent || '').trim();
      if (!text.startsWith('v') || text.length < 5) return false;
      const parts = text.slice(1).split('.');
      return (
        parts.length === 3 && parts.every((part) => part.length > 0 && [...part].every((ch) => ch >= '0' && ch <= '9'))
      );
    };
    const follows = (a, b) =>
      Boolean(a && b) && Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const start = document.querySelector('#lobby-start');
    const configControls = [...document.querySelectorAll('#lobby-form .choice-grid button, #challenge-wild4')];
    const lastConfig = configControls[configControls.length - 1];
    const secondary = document.querySelector('#lobby-form button[data-open-dialog="settings"]');
    const bodyText = document.body.textContent || '';
    return {
      docTitle: document.title,
      lobbyTitle: (document.querySelector('#lobby-title')?.textContent || '').trim(),
      titleVisible: visible(document.querySelector('#lobby-title')),
      versionVisible: versionOk(document.querySelector('#lobby-version')),
      lead: (document.querySelector('#lobby-lead')?.textContent || '').trim(),
      startText: start ? start.textContent.trim() : null,
      startAria: start ? start.getAttribute('aria-label') : null,
      startVisible: visible(start),
      roomStartText: (document.querySelector('#room-start')?.textContent || '').trim(),
      brandName: (document.querySelector('#brand-name')?.textContent || '').trim(),
      gameVersion: (document.querySelector('#game-version')?.textContent || '').trim(),
      gameVersionOk: versionOk(document.querySelector('#game-version')),
      tabOrder: follows(lastConfig, start) && follows(start, secondary),
      noOldCopy:
        !bodyText.includes('开始游戏') && !bodyText.includes('个人练习项目') && !bodyText.includes('单机版'),
      noSoundButton:
        !document.querySelector('#sound-button') &&
        ![...document.querySelectorAll('#top-bar button')].some((button) =>
          (button.textContent || '').includes('音效'),
        ),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  },
  // M3：圆桌座位审计（锚点 / relative-seat / 状态 data-* / 中心行动状态）
  arenaAudit: () => {
    const screen = document.querySelector('#game-screen');
    const seats = [...document.querySelectorAll('#opponents .opponent')].map((node) => {
      const rect = node.getBoundingClientRect();
      const style = node.style;
      return {
        seat: Number(node.dataset.seat),
        relative: Number(node.dataset.relativeSeat || 0),
        hasX: Boolean(style.getPropertyValue('--seat-x')),
        hasY: Boolean(style.getPropertyValue('--seat-y')),
        hasAngle: Boolean(style.getPropertyValue('--seat-angle')),
        current: node.dataset.current === 'true',
        inside:
          rect.left >= 0 &&
          rect.top >= 0 &&
          rect.right <= window.innerWidth &&
          rect.bottom <= window.innerHeight,
      };
    });
    const phaseLabel = document.querySelector('#phase-label');
    const stamp = (document.querySelector('#turn-stamp')?.textContent || '').trim();
    return {
      phase: screen?.dataset.phase || '',
      currentSeat: screen?.dataset.currentSeat ?? '',
      viewerSeat: screen?.dataset.viewerSeat ?? '',
      dataCount: Number(document.querySelector('#opponents')?.dataset.count || 0),
      seatCount: Number(document.querySelector('#opponents')?.dataset.seatCount || 0),
      seats,
      stamp,
      phaseLabelHidden: Boolean(phaseLabel?.hidden),
      phaseLabelText: (phaseLabel?.textContent || '').trim(),
      relativeOk: seats.every((seat, index) => seat.relative === index + 1),
      arena: Boolean(document.querySelector('#table-area.arena .arena-rail')),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  },
  // M4：悬浮手牌与动作区审计（hand-dock / data-count / data-state / data-phase / 滚动边界 / 触控目标）
  handDock: () => {
    const zone = document.querySelector('#hand-zone');
    const hand = document.querySelector('#hand');
    const cards = [...(hand?.querySelectorAll('.card') || [])];
    const zoneStyle = zone ? getComputedStyle(zone) : null;
    const handStyle = hand ? getComputedStyle(hand) : null;
    const actionBar = document.querySelector('#action-bar');
    const buttons = [...(actionBar?.querySelectorAll('button') || [])];
    const state = (card) => card.dataset.state || '';
    return {
      dockClass: Boolean(zone?.classList.contains('hand-dock')),
      dockBg: zoneStyle?.backgroundImage || '',
      safePad: zoneStyle ? parseFloat(zoneStyle.paddingBottom) >= 8 : false,
      hasVisibleTitle:
        Boolean(document.querySelector('.hand-heading')) ||
        Boolean(document.querySelector('#hand-count')) ||
        (hand?.textContent || '').includes('你的手牌'),
      dataCount: hand?.dataset.count || '',
      cardCount: cards.length,
      everyCardHasState: cards.length > 0 && cards.every((card) => ['legal', 'illegal', 'drawn'].includes(state(card))),
      stateMatchesClass:
        cards
          .filter((card) => card.classList.contains('is-legal'))
          .every((card) => state(card) === 'legal' || state(card) === 'drawn') &&
        cards
          .filter((card) => card.classList.contains('is-illegal'))
          .every((card) => state(card) === 'illegal') &&
        cards.filter((card) => state(card) === 'drawn').every((card) => card.classList.contains('is-drawn')),
      scrollBoundary: handStyle?.overflowX || '',
      scrollable: hand ? hand.scrollWidth >= hand.clientWidth : false,
      actionBarPhase: actionBar?.dataset.phase || '',
      screenPhase: document.querySelector('#game-screen')?.dataset.phase || '',
      minTouchTarget: buttons.length ? Math.min(...buttons.map((button) => button.getBoundingClientRect().height)) : 0,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  },
  colorMetrics: () => {
    const dot = document.querySelector('#color-indicator');
    const label = document.querySelector('#color-label');
    const topBar = document.querySelector('#top-bar');
    if (!dot || !label) return null;
    const dotRect = dot.getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    return {
      dotW: Math.round(dotRect.width),
      dotH: Math.round(dotRect.height),
      labelFont: parseFloat(getComputedStyle(label).fontSize),
      labelRect: {
        top: Math.round(labelRect.top),
        right: Math.round(labelRect.right),
      },
      viewportW: window.innerWidth,
      topBarOverflow: topBar ? topBar.scrollWidth > topBar.clientWidth : false,
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  },
  resultChartAudit: () => {
    const content = document.querySelector('#result-content');
    const text = content?.textContent || '';
    // 从结算行文本里取「N 张」的数字（不用正则，避免模板字符串转义告警）
    const shownCountOf = (rowText) => {
      const zhang = rowText.indexOf('张');
      if (zhang < 0) return null;
      let end = zhang;
      while (end > 0 && rowText[end - 1] === ' ') end -= 1;
      let start = end;
      while (start > 0 && rowText[start - 1] >= '0' && rowText[start - 1] <= '9') start -= 1;
      return start < end ? Number(rowText.slice(start, end)) : null;
    };
    const rows = [...document.querySelectorAll('.result-row')].map((row) => ({
      seat: Number(row.dataset.seat),
      cards: [...row.querySelectorAll('.mini-card')].length,
      shownCount: shownCountOf(row.textContent || ''),
      isWinnerRow:
        row.textContent.includes('出完手牌') || row.textContent.includes('手牌最少获胜'),
      text: row.textContent.trim(),
    }));
    const summary = {};
    document.querySelectorAll('[data-summary]').forEach((node) => {
      summary[node.dataset.summary] = Number(node.dataset.value);
    });
    const playerOps = [...document.querySelectorAll('[data-chart="player-ops"] [data-seat]')].map(
      (node) => ({ seat: Number(node.dataset.seat), metrics: JSON.parse(node.dataset.metrics || '{}') }),
    );
    const handColors = [...document.querySelectorAll('[data-chart="hand-colors"] [data-seat]')].map(
      (node) => ({ seat: Number(node.dataset.seat), colors: JSON.parse(node.dataset.colors || '{}') }),
    );
    const mixNode = document.querySelector('[data-chart="action-mix"]');
    return {
      hasScoreText: text.includes('趣味分数') || text.includes('本局得分') || text.includes('得分'),
      hasCharts: Boolean(document.querySelector('#result-charts')),
      chartCount: document.querySelectorAll('#result-charts .result-chart').length,
      summary,
      playerOps,
      handColors,
      mix: JSON.parse((mixNode && mixNode.dataset.mix) || '{}'),
      hasMix: Boolean(mixNode),
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      rows,
    };
  },
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
    const drawLabel = [...document.querySelectorAll('#action-bar button')].some(
      (button) => button.textContent.trim() === '摸牌',
    );
    if (document.querySelector('#result-screen.is-active')) return { step: 'result', drawLabel };
    if (document.querySelector('#game-screen').getAttribute('aria-busy') === 'true')
      return { step: 'busy', drawLabel };
    const dialog = document.querySelector('#dialog-root.is-open');
    if (dialog) {
      const actionable = [...dialog.querySelectorAll('button:not(:disabled)')].filter((button) => button.dataset.actionId);
      if (actionable.length) {
        const button = actionable[Math.floor(Math.random() * actionable.length)];
        button.click();
        return { step: 'dialog', clicked: button.textContent.trim(), drawLabel };
      }
      return { step: 'dialog-idle', drawLabel };
    }
    // 出牌一律通过点击手牌（操作栏已不再渲染出牌按钮）
    const playableCards = [...document.querySelectorAll('#hand .card.is-legal')];
    if (playableCards.length) {
      const card = playableCards[Math.floor(Math.random() * playableCards.length)];
      card.click();
      return { step: 'card', clicked: card.dataset.cardId, drawLabel };
    }
    const buttons = [...document.querySelectorAll('#action-bar button:not(:disabled)')];
    if (buttons.length) {
      const button = buttons[Math.floor(Math.random() * buttons.length)];
      button.click();
      return { step: 'action', clicked: button.textContent.trim(), drawLabel };
    }
    return { step: 'wait', drawLabel };
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
      '--autoplay-policy=no-user-gesture-required',
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
        window.__llmMock = { stop: false, calls: 0 };
        const realFetch = window.fetch.bind(window);
        window.fetch = async (input, init) => {
          const url = typeof input === 'string' ? input : (input && input.url) || '';
          if (url.includes('/api/config')) {
            return new Response(JSON.stringify({ aiEnabled: true, aiDecisionImplemented: true, model: 'glm-mock', aiTimeoutMs: 8000 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (url.includes('/api/ai/decide')) {
            window.__llmMock.calls += 1;
            if (window.__llmMock.stop) {
              return new Response(JSON.stringify({ ok: false, code: 'RATE_LIMIT', message: 'mock stop（用于验证台词 TTL）' }), { status: 429, headers: { 'Content-Type': 'application/json' } });
            }
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
      `({ counts: document.querySelectorAll('#player-count-options button').length, difficulties: document.querySelectorAll('#difficulty-options button').length, modes: document.querySelectorAll('#ai-mode-options button').length, challenge: document.querySelector('#challenge-wild4')?.checked, playerName: Boolean(document.querySelector('#player-name')) })`,
    );
    check(
      '大厅选项齐全（人数 9 档 / 难度 4 档 / AI 模式 3 档 / +4 挑战默认开 / 无用户名输入）',
      lobbyCounts.counts === 9 &&
        lobbyCounts.difficulties === 4 &&
        lobbyCounts.modes === 3 &&
        lobbyCounts.playerName === false &&
        lobbyCounts.challenge === true,
      JSON.stringify(lobbyCounts),
    );
    // ---------------- 1b. M2：大厅与顶部品牌（UNO Local + 版本号 + 开启对局） ----------------
    await waitFor('window.__verify.brandAudit().versionVisible', 5000, '大厅版本号可见');
    const brand1440 = await evaluate('window.__verify.brandAudit()');
    check(
      'M2 大厅品牌：UNO Local + 版本号、开启对局主按钮、旧文案清除、无音效按钮',
      brand1440.docTitle === 'UNO Local' &&
        brand1440.lobbyTitle === 'UNO Local' &&
        brand1440.versionVisible &&
        brand1440.lead === 'v2.0.0 UI 重构与交互升级' &&
        brand1440.startText === '开启对局' &&
        brand1440.startAria === '开启对局' &&
        brand1440.roomStartText === '开启对局' &&
        brand1440.noOldCopy &&
        brand1440.noSoundButton &&
        !brand1440.overflow,
      JSON.stringify(brand1440),
    );
    check(
      'M2 大厅 Tab 顺序：配置 → 开启对局 → 次级入口',
      brand1440.tabOrder,
      JSON.stringify({ tabOrder: brand1440.tabOrder }),
    );
    await shot('v2/M2-lobby-1440.png');
    await shot('ui-m32-lobby-1440.png');

    // ---------------- 2. 完整对局（快速模式，3 局） ----------------
    // BUG-01 新规则（摸到可出为止）让对局变长：这一段的目的是"完整打完对局"，
    // 因此关闭动画、AI 快速，控制总时长；动效本身在第 3/4 节单独验证。
    await evaluate(
      `localStorage.setItem('uno:settings', JSON.stringify({ autoCallUno: false, aiSpeed: 'fast', sound: false, animation: false, showHint: true, aiChatter: true })); true`,
    );
    const statsBefore = await evaluate(`JSON.parse(localStorage.getItem('uno:stats') || '{}')`);

    const raceTypes = ['casual', 'easy', 'realistic', 'hardcore'];
    const gameSummaries = [];
    const resultChartAudits = [];
    const gameStepStats = { card: 0, drawLabel: false };
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
      if (gameIndex === 0) {
        await waitFor('window.__verify.brandAudit().gameVersionOk', 5000, '牌桌版本号可见');
        const gameBrand = await evaluate('window.__verify.brandAudit()');
        check(
          'M2 牌桌顶栏品牌：UNO Local + 版本号可见',
          gameBrand.brandName === 'UNO Local' && gameBrand.gameVersionOk,
          JSON.stringify({ brandName: gameBrand.brandName, gameVersion: gameBrand.gameVersion }),
        );
      }
      await waitFor('window.__verify.handCount() >= 7', 5000, '人类手牌 ≥7 张');
      // 卡面图片异步解码：最多等 8s 再统计失败数，避免把"尚未解码完成"误判为加载失败
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if ((await evaluate('window.__verify.failedImages()')) === 0) break;
        await sleep(200);
      }
      const setup = await evaluate(
        `({ hand: window.__verify.handCount(), opponents: window.__verify.opponentCount(), failed: window.__verify.failedImages(), overflow: window.__verify.overflow() })`,
      );
      if (gameIndex === 0) {
        check(
          '开局：人类 7~9 张手牌（起手 +2 可能 9 张）+ 3 个 AI 座位',
          setup.hand >= 7 && setup.hand <= 9 && setup.opponents === 3,
          JSON.stringify(setup),
        );
        check('开局卡面全部加载成功', setup.failed === 0, `failed=${setup.failed}`);
        // M5-04：抽牌堆 HUD 计数与 data-count 一致、为合理数字（真实引擎视图）
        const drawPileHud = await evaluate(
          `({ text: document.querySelector('#draw-count')?.textContent || '', dataCount: document.querySelector('#draw-pile')?.dataset.count || '' })`,
        );
        check(
          '抽牌堆计数在 HUD 正确显示（文本与 data-count 一致）',
          drawPileHud.text === drawPileHud.dataCount &&
            /^\d+$/.test(drawPileHud.text) &&
            Number(drawPileHud.text) >= 0 &&
            Number(drawPileHud.text) <= 108,
          JSON.stringify(drawPileHud),
        );
        check(
          '1440 宽无横向溢出',
          setup.overflow.scroll <= setup.overflow.client,
          JSON.stringify(setup.overflow),
        );
        await shot('ui-m32-game-start-1440.png');
        // ---------------- M3：圆桌座位锚点与中心行动状态（4 人局首屏） ----------------
        const arena4p = await evaluate('window.__verify.arenaAudit()');
        check(
          'M3 圆桌：椭圆桌面结构就绪、座位圆周锚点齐全且在视口内',
          arena4p.arena &&
            arena4p.dataCount === 3 &&
            arena4p.seatCount === 3 &&
            arena4p.relativeOk &&
            arena4p.seats.every((seat) => seat.hasX && seat.hasY && seat.hasAngle && seat.inside),
          JSON.stringify({ arena: arena4p.arena, seatCount: arena4p.seatCount, seats: arena4p.seats }),
        );
        check(
          'M3 行动状态：#turn-stamp 含玩家名、data-phase/current-seat/viewer-seat 同步、普通回合 #phase-label 隐藏',
          arena4p.stamp.length > 0 &&
            arena4p.phase.length > 0 &&
            arena4p.currentSeat !== '' &&
            arena4p.viewerSeat !== '' &&
            (arena4p.phase !== 'await-play' || arena4p.phaseLabelHidden),
          JSON.stringify({
            stamp: arena4p.stamp,
            phase: arena4p.phase,
            currentSeat: arena4p.currentSeat,
            viewerSeat: arena4p.viewerSeat,
            phaseLabelText: arena4p.phaseLabelText,
          }),
        );
        await shot('v2/M3-table-4p-1440.png');
        // BUG-06 用户要求：删除「你的手牌 / N 张」；操作栏只留功能按钮（出牌改为点手牌）；无冗余提示文字
        await waitFor(
          '!window.__verify.busy() && window.__verify.humanReady()',
          20000,
          '首个玩家回合',
        );
        const uiState = await evaluate(
          `({ heading: window.__verify.handHeading(), hint: window.__verify.hintText(), labels: window.__verify.actionLabels(), color: window.__verify.colorMetrics() })`,
        );
        check(
          '手牌区不再显示「你的手牌 / N 张」',
          !uiState.heading.heading &&
            !uiState.heading.count &&
            !uiState.heading.text.includes('你的手牌') &&
            uiState.heading.text.trim() === '',
          JSON.stringify(uiState.heading),
        );
        check(
          '操作栏不再有出牌按钮（出牌改为点击手牌）',
          !uiState.labels.some(
            (item) => item.text.startsWith('出 ') || item.text.startsWith('叠 '),
          ),
          JSON.stringify(uiState.labels),
        );
        check(
          '正常回合无冗余状态提示文字',
          !uiState.hint.includes('轮到你了') &&
            !uiState.hint.includes('高亮的牌可以打出') &&
            !uiState.hint.includes('正在行动') &&
            !uiState.hint.includes('摸一张'),
          `hint=${uiState.hint}`,
        );
        check(
          '当前颜色明显放大（色点 ≥20px、文字 ≥17px、不溢出）',
          Boolean(uiState.color) &&
            uiState.color.dotW >= 20 &&
            uiState.color.labelFont >= 17 &&
            !uiState.color.topBarOverflow &&
            !uiState.color.pageOverflow &&
            uiState.color.labelRect.right <= uiState.color.viewportW,
          JSON.stringify(uiState.color),
        );
        // ---------------- M4：悬浮手牌与动作区（契约 B07/B08） ----------------
        const dock1440 = await evaluate('window.__verify.handDock()');
        check(
          'M4 悬浮手牌：hand-dock 融合底、安全区留白、无可见标题/张数、#hand 独立横向滚动边界',
          dock1440.dockClass &&
            dock1440.dockBg.includes('gradient') &&
            dock1440.safePad &&
            !dock1440.hasVisibleTitle &&
            dock1440.scrollBoundary === 'auto',
          JSON.stringify({
            dockClass: dock1440.dockClass,
            safePad: dock1440.safePad,
            hasVisibleTitle: dock1440.hasVisibleTitle,
            scrollBoundary: dock1440.scrollBoundary,
          }),
        );
        check(
          'M4 手牌契约：#hand[data-count] 与牌数一致、每张牌 data-state 正确且与合法性类同步',
          Number(dock1440.dataCount) === dock1440.cardCount &&
            dock1440.everyCardHasState &&
            dock1440.stateMatchesClass,
          JSON.stringify({
            dataCount: dock1440.dataCount,
            cardCount: dock1440.cardCount,
            everyCardHasState: dock1440.everyCardHasState,
            stateMatchesClass: dock1440.stateMatchesClass,
          }),
        );
        check(
          'M4 动作区：#action-bar[data-phase] 与牌桌阶段同步、按钮触控目标 ≥44px、无页面横向溢出',
          dock1440.actionBarPhase !== '' &&
            dock1440.actionBarPhase === dock1440.screenPhase &&
            (dock1440.minTouchTarget === 0 || dock1440.minTouchTarget >= 44) &&
            !dock1440.overflow,
          JSON.stringify({
            actionBarPhase: dock1440.actionBarPhase,
            screenPhase: dock1440.screenPhase,
            minTouchTarget: dock1440.minTouchTarget,
            overflow: dock1440.overflow,
          }),
        );
        await shot('v2/M4-hand-dock-1440.png');
      }

      const startedAt = Date.now();
      let lastStep = 'wait';
      while (Date.now() - startedAt < 240000) {
        const result = await evaluate('window.__verify.autoStep()');
        lastStep = result.step;
        if (result.step === 'card') gameStepStats.card += 1;
        if (result.drawLabel) gameStepStats.drawLabel = true;
        if (result.step === 'result') break;
        await sleep(30);
      }
      if (lastStep !== 'result')
        throw new Error(`第 ${gameIndex + 1} 局未在 240s 内结束（最后步骤 ${lastStep}）`);
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
      resultChartAudits.push(await evaluate('window.__verify.resultChartAudit()'));

      // 再来一局 → 再退出回大厅
      await evaluate('window.__verify.clickRestart()');
      await waitFor('window.__verify.visibleScreen() === "game"', 10000, '再来一局进入牌桌');
      await waitFor('window.__verify.handCount() >= 7', 5000, '重开后手牌 ≥7 张');
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
    // M6 复验：本地战绩写入 + 战绩弹窗显示
    const statsAfter = await evaluate(`JSON.parse(localStorage.getItem('uno:stats') || '{}')`);
    check(
      '本地战绩：打完 3 局后写入 uno:stats（对局 +3、获胜数合法）',
      Number(statsAfter.games || 0) >= Number(statsBefore.games || 0) + 3 &&
        Number(statsAfter.wins || 0) >= Number(statsBefore.wins || 0) &&
        Number(statsAfter.wins || 0) <= Number(statsAfter.games || 0),
      JSON.stringify({ before: statsBefore, after: statsAfter }),
    );
    await evaluate(
      `document.querySelector('.screen.is-active [data-open-dialog="stats"]').click(); true`,
    );
    await waitFor('window.__verify.activeDialogTitle() === "本地战绩"', 5000, '本地战绩弹窗');
    const statsDialogText = await evaluate(
      `document.querySelector('#dialog-root.is-open')?.textContent || ''`,
    );
    await evaluate(`document.querySelector('#dialog-root.is-open .dialog-close').click(); true`);
    check(
      '本地战绩弹窗：显示已记录的对局/获胜数',
      statsDialogText.includes('对局') &&
        statsDialogText.includes(String(Number(statsAfter.games || 0))),
      statsDialogText,
    );

    // ---------------- 2b. M5-05：6 / 10 人真实引擎对局布局与轮转 ----------------
    const layoutProbe = `(() => {
      const opponents = [...document.querySelectorAll('#opponents .opponent')].map((node) => {
        const rect = node.getBoundingClientRect();
        return { seat: Number(node.dataset.seat), x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) };
      });
      const overlaps = [];
      for (let i = 0; i < opponents.length; i += 1) for (let j = i + 1; j < opponents.length; j += 1) {
        const a = opponents[i]; const b = opponents[j];
        const overlapW = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const overlapH = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (overlapW > 2 && overlapH > 2) overlaps.push([a.seat, b.seat]);
      }
      const inside = opponents.every((item) => item.x >= 0 && item.y >= 0 && item.x + item.w <= window.innerWidth && item.y + item.h <= window.innerHeight);
      const handTop = document.querySelector('#hand').getBoundingClientRect().top;
      const overlapHand = opponents.filter((item) => item.y + item.h > handTop + 2).map((item) => item.seat);
      // M3：座位 chip 不得覆盖中心牌堆（契约 §4.2 规则 7——中心牌安全区）
      const pile = document.querySelector('#discard-pile').getBoundingClientRect();
      const overlapCenter = opponents
        .filter((item) => item.x < pile.right + 2 && item.x + item.w > pile.left - 2 && item.y < pile.bottom + 2 && item.y + item.h > pile.top - 2)
        .map((item) => item.seat);
      return {
        seats: opponents.length,
        overlaps,
        inside,
        overlapHand,
        overlapCenter,
        overflow: { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, scrollH: document.documentElement.scrollHeight, clientH: document.documentElement.clientHeight },
        drawPileCount: Number(document.querySelector('#draw-pile').dataset.count),
        drawPileHud: document.querySelector('#draw-count').textContent,
      };
    })()`;
    const multiplayerLayouts = [];
    for (const multiplayerCount of [6, 10]) {
      await navigate(`${BASE_URL}/?test=1`);
      await waitFor('window.__verify.visibleScreen() === "lobby"', 10000, '大厅可见');
      await evaluate(`window.__verify.selectPlayers(${multiplayerCount})`);
      await evaluate('window.__verify.clickStart()');
      await waitFor('window.__verify.visibleScreen() === "game"', 10000, '进入牌桌');
      await waitFor('window.__verify.handCount() >= 7', 5000, '人类手牌 ≥7 张');
      await sleep(400);
      const layout = await evaluate(layoutProbe);
      check(
        `${multiplayerCount} 人：真实对局 AI 座位数正确（${multiplayerCount - 1} 个）`,
        layout.seats === multiplayerCount - 1,
        `seats=${layout.seats}`,
      );
      check(
        `${multiplayerCount} 人：座位全部在视口内、互不遮挡`,
        layout.inside && layout.overlaps.length === 0,
        JSON.stringify({ inside: layout.inside, overlaps: layout.overlaps }),
      );
      check(
        `${multiplayerCount} 人：座位不压手牌区与中心牌堆、页面无横向溢出/竖向滚动`,
        layout.overlapHand.length === 0 &&
          layout.overlapCenter.length === 0 &&
          layout.overflow.scrollW <= layout.overflow.clientW &&
          layout.overflow.scrollH <= layout.overflow.clientH + 2,
        JSON.stringify({ overlapHand: layout.overlapHand, overlapCenter: layout.overlapCenter, overflow: layout.overflow }),
      );
      check(
        `${multiplayerCount} 人：抽牌堆计数与 HUD 一致`,
        layout.drawPileCount >= 0 && String(layout.drawPileCount) === layout.drawPileHud,
        `count=${layout.drawPileCount} hud=${layout.drawPileHud}`,
      );
      const rotation = await evaluate(`(async () => {
        const seats = new Set();
        const startedAt = performance.now();
        let steps = 0;
        while (performance.now() - startedAt < 5000 && steps < 40) {
          window.__verify.autoStep();
          steps += 1;
          if (window.__verify.visibleScreen() !== 'game') break;
          const current = document.querySelector('#opponents .opponent.is-current');
          if (current) seats.add(Number(current.dataset.seat));
          else if (document.querySelector('#hand .card.is-legal')) seats.add(0);
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
        }
        return { steps, seats: [...seats], elapsed: Math.round(performance.now() - startedAt), screen: window.__verify.visibleScreen() };
      })()`);
      check(
        `${multiplayerCount} 人：轮转正常（自动行动座位 ≥2 个）`,
        rotation.steps > 0 &&
          rotation.seats.length >= 2 &&
          rotation.seats.every((seat) => seat >= 0 && seat < multiplayerCount),
        JSON.stringify(rotation),
      );
      multiplayerLayouts.push({ playerCount: multiplayerCount, layout });
      if (multiplayerCount === 6) await shot('ui-m5-6p-1440.png');
      if (multiplayerCount === 10) {
        const arena10 = await evaluate('window.__verify.arenaAudit()');
        check(
          'M3 10 人：9 个座位圆周锚点齐全、relative-seat 1..9、全部在视口内',
          arena10.arena &&
            arena10.seatCount === 9 &&
            arena10.dataCount === 9 &&
            arena10.relativeOk &&
            arena10.seats.every((seat) => seat.hasX && seat.hasY && seat.hasAngle && seat.inside),
          JSON.stringify({ seatCount: arena10.seatCount, relativeOk: arena10.relativeOk, seats: arena10.seats }),
        );
        await shot('ui-m5-10p-1440.png');
        await shot('v2/M3-table-10p-1440.png');
      }
    }
    // 10 人 @1024 宽度：布局同样无溢出、无遮挡
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1024,
      height: 768,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await navigate(`${BASE_URL}/?test=1`);
    await waitFor('window.__verify.visibleScreen() === "lobby"', 10000, '1024 大厅');
    // M2：1024 宽大厅品牌可见性与开局路径
    await waitFor('window.__verify.brandAudit().versionVisible', 5000, '1024 大厅版本号可见');
    const brand1024 = await evaluate('window.__verify.brandAudit()');
    check(
      'M2 @1024 大厅：品牌、版本号与开启对局可见、无横向溢出',
      brand1024.titleVisible && brand1024.versionVisible && brand1024.startVisible && !brand1024.overflow,
      JSON.stringify(brand1024),
    );
    await shot('v2/M2-lobby-1024.png');
    await evaluate('window.__verify.selectPlayers(10)');
    await evaluate('window.__verify.clickStart()');
    await waitFor('window.__verify.visibleScreen() === "game"', 10000, '1024 十人牌桌');
    await waitFor('window.__verify.handCount() >= 7', 5000, '1024 人类手牌 ≥7 张');
    await sleep(400);
    const layout1024 = await evaluate(layoutProbe);
    check(
      '10 人 @1024：座位全部在视口内、互不遮挡、无横向溢出',
      layout1024.seats === 9 &&
        layout1024.inside &&
        layout1024.overlaps.length === 0 &&
        layout1024.overflow.scrollW <= layout1024.overflow.clientW,
      JSON.stringify({
        seats: layout1024.seats,
        inside: layout1024.inside,
        overlaps: layout1024.overlaps,
        overflow: layout1024.overflow,
      }),
    );
    await shot('ui-m5-10p-1024.png');
    await shot('v2/M3-table-10p-1024.png');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    // 2026-10-18 用户要求：取消分数计算，保留最终结算，结算页改为数据图表总结操作
    const chartAudits = resultChartAudits;
    check(
      '结算页已取消分数计算与展示（无「趣味分数 / 本局得分」文字）',
      chartAudits.length > 0 && chartAudits.every((audit) => !audit.hasScoreText),
      JSON.stringify(chartAudits.map((audit) => audit.rows.map((row) => row.text))),
    );
    check(
      '结算页图表齐全（每位玩家操作 / 全体动作构成 / 剩余手牌构成 + 总览数字）',
      chartAudits.every(
        (audit) =>
          audit.hasCharts &&
          audit.chartCount === 3 &&
          audit.playerOps.length === audit.rows.length &&
          audit.handColors.length === audit.rows.length &&
          audit.hasMix &&
          !audit.pageOverflow &&
          Object.keys(audit.summary).length >= 6,
      ),
      JSON.stringify(
        chartAudits.map((audit) => ({
          charts: audit.chartCount,
          ops: audit.playerOps.length,
          hands: audit.handColors.length,
          summary: Object.keys(audit.summary).length,
        })),
      ),
    );
    check(
      '每位玩家操作统计与总览合计一致（出牌/摸牌/叠牌/喊UNO/挑战）',
      chartAudits.every((audit) => {
        const sum = (key) =>
          audit.playerOps.reduce((total, player) => total + (player.metrics[key] || 0), 0);
        return (
          sum('plays') === audit.summary['出牌'] &&
          sum('draws') === audit.summary['摸牌'] &&
          sum('stackPlays') === audit.summary['叠牌'] &&
          sum('unoCalls') === audit.summary['喊 UNO'] &&
          sum('challenges') === audit.summary['挑战'] &&
          audit.summary['动作'] >= audit.summary['出牌']
        );
      }),
      JSON.stringify(
        chartAudits.map((audit) => ({ summary: audit.summary, players: audit.playerOps })),
      ),
    );
    check(
      '全体操作构成环形图数据自洽（各部分之和 = 五项操作合计）',
      chartAudits.every((audit) => {
        const mixSum = Object.values(audit.mix).reduce((total, value) => total + value, 0);
        const expectSum = ['出牌', '摸牌', '叠牌', '喊 UNO', '挑战'].reduce(
          (sum, label) => sum + (audit.summary[label] || 0),
          0,
        );
        return mixSum === expectSum;
      }),
      JSON.stringify(chartAudits.map((audit) => audit.mix)),
    );
    check(
      '剩余手牌构成图表与结算行剩余张数一致',
      chartAudits.every((audit) =>
        audit.rows.every((row) => {
          const colors = audit.handColors.find((item) => item.seat === row.seat)?.colors || {};
          return (
            Object.values(colors).reduce((total, value) => total + value, 0) === row.cards &&
            row.shownCount === row.cards
          );
        }),
      ),
      JSON.stringify(chartAudits.map((audit) => ({ rows: audit.rows, hands: audit.handColors }))),
    );
    check(
      '结算页赢家行标注「出完手牌 / 手牌最少获胜」',
      chartAudits.every((audit) => audit.rows.filter((row) => row.isWinnerRow).length <= 1) &&
        chartAudits.reduce(
          (sum, audit) => sum + audit.rows.filter((row) => row.isWinnerRow).length,
          0,
        ) >= 1,
      JSON.stringify(chartAudits.map((audit) => audit.rows.map((row) => row.text))),
    ); // BUG-06：出牌改为点击手牌后，自动化必须能通过手牌点击完成对局
    check(
      '出牌通过点击手牌完成（操作栏无出牌按钮）',
      gameStepStats.card > 0,
      `cardClicks=${gameStepStats.card}`,
    );
    check(
      '摸牌按钮文案为「摸牌」（BUG-01 新规则：摸到可出为止）',
      gameStepStats.drawLabel,
      `sawDrawLabel=${gameStepStats.drawLabel}`,
    );
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
    // AI 速度调到 slow，让 LLM 台词有更长的可见窗口（BUG-04 的台词生命周期仍按 TTL 断言）
    await evaluate(
      `localStorage.setItem('uno:settings', JSON.stringify({ autoCallUno: false, aiSpeed: 'slow', sound: false, animation: true, showHint: true, aiChatter: true })); true`,
    );
    await navigate(BASE_URL + '/');
    await waitFor('window.__verify.visibleScreen() === "lobby"', 10000, '大厅可见');
    await evaluate('window.__verify.clickStart()');
    await waitFor('window.__verify.visibleScreen() === "game"', 10000, '进入牌桌');
    await waitFor('window.__verify.handCount() >= 7', 5000, '手牌渲染');
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
        `({ busy: window.__verify.busy(), thinking: Boolean(document.querySelector('.opponent-line.thinking')), thinkingAnimation: (() => { const node = document.querySelector('.opponent-line.thinking'); return node ? getComputedStyle(node, '::after').animationName : ''; })(), screen: window.__verify.visibleScreen(), line: window.__verify.speechLines().filter((text) => !text.includes('思考中')).join(' | '), indicator: document.querySelector('#ai-mode-indicator')?.textContent || '' })`,
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
        thinkingAnimation = state.thinkingAnimation || '';
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
    // BUG-04：台词只短暂展示。停掉 mock LLM（后续决策返回 429、降级本地 AI，不再产生新台词），
    // 旧台词应在 TTL/换人清除逻辑下自动消失，不得跨回合残留。
    if (llmLineSeen) await evaluate('window.__llmMock.stop = true; true');
    else check('M4 台词 mock 未生效（后续台词 TTL 断言跳过）', false, 'llmLineSeen 为空');
    let lineClearMs = -1;
    {
      const started = Date.now();
      while (Date.now() - started < 8000) {
        if ((await evaluate('window.__verify.speechLines().length')) === 0) {
          lineClearMs = Date.now() - started;
          break;
        }
        await sleep(150);
      }
    }
    check(
      'AI 台词只短暂展示：TTL/换人后自动消失（不跨回合残留）',
      llmLineSeen.includes('看我的') && lineClearMs >= 0 && lineClearMs <= 7000,
      `line=${llmLineSeen} clearAfter=${lineClearMs}ms`,
    );
    await waitFor('window.__verify.busy() === false', 5000, '动画结束');
    // 等到人类回合再退出，避免 AI 回合 busy 锁吞掉确认按钮（slow AI/UNO 窗口下可能等几轮）
    // 若对局已经结束（结算页），直接从结算页回大厅。
    const section3Screen = await evaluate('window.__verify.visibleScreen()');
    if (section3Screen === 'result') {
      await evaluate('window.__verify.clickBackToLobby()');
    } else {
      await waitFor(
        '!window.__verify.busy() && window.__verify.humanReady()',
        45000,
        '人类回合可操作',
      );
      await click('#quit-game');
      await waitFor('window.__verify.activeDialogTitle() === "确认退出"', 5000, '退出确认');
      await evaluate('window.__verify.clickQuitConfirm()');
    }
    await waitFor('window.__verify.visibleScreen() === "lobby"', 10000, '回大厅');
    check(
      '回大厅后 AI 台词清空（不留对话/不跨局残留）',
      (await evaluate('window.__verify.speechLines().length')) === 0,
      JSON.stringify(await evaluate('window.__verify.speechLines()')),
    );

    // ---------------- 3b. M4：智谱失败自动降级（拦截 decide → 429） ----------------
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => { const previous = window.fetch.bind(window); window.fetch = async (input, init) => { const url = typeof input === 'string' ? input : (input && input.url) || ''; if (url.includes('/api/ai/decide')) { return new Response(JSON.stringify({ ok: false, code: 'RATE_LIMIT', message: 'busy' }), { status: 429, headers: { 'Content-Type': 'application/json' } }); } return previous(input, init); }; })();`,
    });
    // 本段只验证降级链路：快速 AI + 关闭动画，避免等待人类回合超时
    await evaluate(
      `localStorage.setItem('uno:settings', JSON.stringify({ autoCallUno: false, aiSpeed: 'fast', sound: false, animation: false, showHint: true, aiChatter: true })); true`,
    );
    await navigate(BASE_URL + '/');
    await waitFor('window.__verify.visibleScreen() === "lobby"', 10000, '大厅');
    await evaluate(
      `(() => { const button = document.querySelector('#ai-mode-options button[data-value="zhipu"]'); if (button) button.click(); return true; })()`,
    );
    await evaluate('window.__verify.clickStart()');
    await waitFor('window.__verify.visibleScreen() === "game"', 10000, '进入牌桌');
    // 降级只会在「AI 实际尝试调用 /api/ai/decide」后出现：若先轮到人类，需先操作推进对局。
    let degradeSeen = false;
    const degradeDeadline = Date.now() + 30000;
    while (Date.now() < degradeDeadline) {
      const indicator = await evaluate(
        `document.querySelector('#ai-mode-indicator')?.textContent || ''`,
      );
      if (indicator.includes('降级')) {
        degradeSeen = true;
        break;
      }
      await evaluate('window.__verify.autoStep()');
      await sleep(150);
    }
    const fallbackToast = await evaluate(
      `document.querySelector('#toast-region')?.textContent || ''`,
    );
    check(
      'M4 智谱失败自动降级：状态栏显示「本地·降级」+ 提示 toast',
      degradeSeen && fallbackToast.includes('智谱') && fallbackToast.includes('降级'),
      `degradeSeen=${degradeSeen} toast=${fallbackToast.trim()}`,
    );
    const initialFeed = await evaluate(`document.querySelector('#event-feed')?.textContent || ''`);
    // 降级后必须能继续对局：若轮到人类，先自动出一手，随后观察事件流是否继续变化（本地 AI 接管）
    let fallbackActionSeen = false;
    const fallbackDeadline = Date.now() + 25000;
    while (Date.now() < fallbackDeadline) {
      const feed = await evaluate(`document.querySelector('#event-feed')?.textContent || ''`);
      if (feed !== initialFeed) {
        fallbackActionSeen = true;
        break;
      }
      const step = await evaluate('window.__verify.autoStep()');
      if (step.step === 'result') break;
      await sleep(120);
    }
    check(
      'M4 降级后本地 AI 继续行动（对局不中断）',
      fallbackActionSeen,
      `eventFeedChanged=${fallbackActionSeen}`,
    );
    await shot('ui-m4-ai-fallback-1440.png');
    // 对局可能已经结束（结算页）：从结算页回大厅；否则等人类回合后退出
    const section3bScreen = await evaluate('window.__verify.visibleScreen()');
    if (section3bScreen === 'result') {
      await evaluate('window.__verify.clickBackToLobby()');
    } else {
      await waitFor('!window.__verify.busy() && window.__verify.humanReady()', 45000, '人类回合');
      await click('#quit-game');
      await waitFor('window.__verify.activeDialogTitle() === "确认退出"', 5000, '退出确认');
      await evaluate('window.__verify.clickQuitConfirm()');
    }
    await waitFor('window.__verify.visibleScreen() === "lobby"', 10000, '回大厅');
    check(
      '回大厅后 AI 台词清空（不留对话/不跨局残留）',
      (await evaluate('window.__verify.speechLines().length')) === 0,
      JSON.stringify(await evaluate('window.__verify.speechLines()')),
    );

    // ---------------- 4. 动画队列机制（mock 模式，避免 AI 干扰） ----------------
    // 3b 为了等待人类回合关闭了动画，这里恢复动画开启再验证事件队列
    await evaluate(
      `localStorage.setItem('uno:settings', JSON.stringify({ autoCallUno: false, aiSpeed: 'fast', sound: false, animation: true, showHint: true, aiChatter: true })); true`,
    );
    await navigate(`${BASE_URL}/?mock=1`);
    await waitFor('window.__verify.visibleScreen() === "lobby"', 10000, 'mock 大厅');
    await evaluate('window.__verify.selectMock("normal-play")');
    await waitFor('window.__verify.visibleScreen() === "game"', 5000, 'mock 牌桌');
    const mockUi = await evaluate(
      `({ heading: window.__verify.handHeading(), hint: window.__verify.hintText(), labels: window.__verify.actionLabels() })`,
    );
    check(
      'mock 牌桌：手牌区无「你的手牌 / N 张」',
      !mockUi.heading.heading && !mockUi.heading.count && mockUi.heading.text.trim() === '',
      JSON.stringify(mockUi.heading),
    );
    check(
      'mock 牌桌：操作栏只剩功能按钮（无出牌按钮）',
      !mockUi.labels.some((item) => item.text.startsWith('出 ') || item.text.startsWith('叠 ')),
      JSON.stringify(mockUi.labels),
    );
    check('mock 牌桌：正常回合无冗余提示文字', mockUi.hint === '', `hint=${mockUi.hint}`);
    const mockHands = await evaluate('window.__verify.opponentHands()');
    check(
      'M13 对手手牌：几何张数映射（4/5/6 → 4/5/5）、22×33 卡背、避开名字/张数、lastPlayed 共存',
      mockHands.length === 3 &&
        mockHands.every(
          (hand) =>
            hand.visible === Math.min(5, hand.handCount) &&
            hand.cards === hand.visible &&
            hand.display === 'block' &&
            hand.cardW === 22 &&
            hand.cardH === 33 &&
            !hand.nameOverlap &&
            !hand.metaOverlap &&
            hand.inside,
        ) &&
        mockHands[0].lastPlayed,
      JSON.stringify(mockHands),
    );
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
      '事件队列逐条播放（5 事件 = 200ms/条基础 + 动效时长）',
      queueMeasure.elapsed >= 850 && queueMeasure.elapsed <= 2600,
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
    // ---------------- 4a. M6-01：事件动效（飞牌/横幅/动效层清理） ----------------
    const fxEventsCode = `[
      { type: 'DRAW', seat: 0, count: 2, cards: [ { id: 'R7#0', kind: 'number', color: 'red', value: 7, faceCode: 'R7' }, { id: 'GS#0', kind: 'skip', color: 'green', value: null, faceCode: 'GS' } ] },
      { type: 'PLAY', seat: 1, card: { id: 'B3#0', kind: 'number', color: 'blue', value: 3, faceCode: 'B3' } },
      { type: 'SKIP', seat: 1 },
      { type: 'REVERSE' },
      { type: 'UNO_CALLED', seat: 1 },
      { type: 'PILE_RESHUFFLE' },
    ]`;
    await evaluate(`(() => {
      const token = window.__m601 = { startedAt: performance.now(), maxCards: 0, maxLayer: 0, lastEffect: '', done: false, elapsed: null };
      const events = ${fxEventsCode};
      const poll = setInterval(() => {
        token.maxCards = Math.max(token.maxCards, document.querySelectorAll('#effect-layer .fx-card').length);
        token.maxLayer = Math.max(token.maxLayer, document.querySelectorAll('#effect-layer > *').length);
        token.lastEffect = document.documentElement.dataset.lastEffect || token.lastEffect;
        if (token.done) clearInterval(poll);
      }, 40);
      window.UnoApp.playEvents(events, () => { token.done = true; token.elapsed = Math.round(performance.now() - token.startedAt); });
      return true;
    })()`);
    await sleep(180);
    await shot('ui-m6-effects-1440.png');
    await waitFor('window.__m601 && window.__m601.done === true', 8000, '动效事件队列播放完成');
    await sleep(160);
    const fxAudit = await evaluate(
      `({ maxCards: window.__m601.maxCards, maxLayer: window.__m601.maxLayer, lastEffect: window.__m601.lastEffect, elapsed: window.__m601.elapsed, layer: document.querySelectorAll('#effect-layer > *').length, busy: document.querySelector('#game-screen').getAttribute('aria-busy') })`,
    );
    check(
      '事件动效：飞牌/横幅等临时元素由动效层创建（至少 2 个同时动画）',
      fxAudit.maxLayer >= 2 && fxAudit.maxCards >= 1 && fxAudit.lastEffect === 'PILE_RESHUFFLE',
      JSON.stringify(fxAudit),
    );
    check(
      '事件动效：队列结束后动效层清理干净、输入锁解除',
      fxAudit.layer === 0 && fxAudit.busy === null,
      JSON.stringify({ layer: fxAudit.layer, busy: fxAudit.busy }),
    );
    check(
      '事件动效：6 个事件总时长合理（约 0.6~3s）',
      fxAudit.elapsed >= 600 && fxAudit.elapsed <= 3000,
      `elapsed=${fxAudit.elapsed}ms`,
    );
    // dev 工具条「重播动画」同样触发动效
    await evaluate(
      `(() => { const button = [...document.querySelectorAll('#dev-toolbar button')].find((item) => item.textContent.trim() === '重播动画'); button?.click(); return Boolean(button); })()`,
    );
    await sleep(220);
    const replayFx = await evaluate(
      `({ layer: document.querySelectorAll('#effect-layer > *').length, lastEffect: document.documentElement.dataset.lastEffect || '' })`,
    );
    check(
      'dev 工具条「重播动画」触发动效（mock 局面）',
      replayFx.layer > 0,
      JSON.stringify(replayFx),
    );
    await sleep(900);
    // ---------------- 4a2. M6 复验：结算彩带从屏幕最顶部完整飘到最底部 ----------------
    await evaluate(`(() => {
      const token = window.__m6conf = { done: false, max: 0, minTop: 9999 };
      const poll = setInterval(() => {
        const nodes = [...document.querySelectorAll('#effect-layer .fx-confetti')];
        token.max = Math.max(token.max, nodes.length);
        for (const node of nodes) token.minTop = Math.min(token.minTop, Math.round(node.getBoundingClientRect().top));
        if (token.done) clearInterval(poll);
      }, 30);
      window.UnoApp.playEvents([{ type: 'ROUND_END', winnerSeat: 0 }], () => { token.done = true; });
      return true;
    })()`);
    await sleep(320);
    const confettiDuring = await evaluate(
      `({ count: document.querySelectorAll('#effect-layer .fx-confetti').length, max: window.__m6conf.max, minTop: window.__m6conf.minTop })`,
    );
    await waitFor('window.__m6conf && window.__m6conf.done === true', 4000, '结算彩带事件队列完成');
    await sleep(120);
    const confettiAfterQueue = await evaluate(
      `document.querySelectorAll('#effect-layer .fx-confetti').length`,
    );
    check(
      '结算彩带：获胜后全屏彩带出现（≥10 个同屏）且从屏幕顶部开始飘落',
      confettiDuring.max >= 10 && confettiDuring.count >= 5 && confettiDuring.minTop <= 60,
      JSON.stringify(confettiDuring),
    );
    check(
      '结算彩带：事件队列结束后彩带继续自然飘落（不被提前清空）',
      confettiAfterQueue > 0,
      `count=${confettiAfterQueue}`,
    );
    await sleep(3200);
    const confettiEnd = await evaluate(
      `document.querySelectorAll('#effect-layer .fx-confetti').length`,
    );
    check('结算彩带：完整飘到屏幕底部后自动清理', confettiEnd === 0, `count=${confettiEnd}`);

    // reduced-motion：应跳过动画、立即完成
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    const reducedMotion = await evaluate(`(async () => {
      const events = Array.from({ length: 5 }, () => ({ type: 'DRAW', seat: 1, count: 1, cards: [] }));
      const startedAt = performance.now();
      await new Promise((resolvePromise) => window.UnoApp.playEvents(events, resolvePromise));
      return { elapsed: performance.now() - startedAt, busy: document.querySelector('#game-screen').getAttribute('aria-busy'), effects: document.querySelectorAll('#effect-layer > *').length };
    })()`);
    await cdp.send('Emulation.setEmulatedMedia', { features: [] });
    check(
      'reduced-motion 下跳过动画与事件动效（<100ms 完成）',
      reducedMotion.elapsed < 100 && reducedMotion.busy === null && reducedMotion.effects === 0,
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
      return { elapsed: performance.now() - startedAt, animation: document.documentElement.dataset.animation, effects: document.querySelectorAll('#effect-layer > *').length };
    })()`);
    check(
      '设置关闭动画后跳过动画与事件动效（<100ms）',
      animationOff.elapsed < 100 &&
        animationOff.animation === 'false' &&
        animationOff.effects === 0,
      `elapsed=${animationOff.elapsed.toFixed(0)}ms`,
    );

    // ---------------- 4b. M6-02：音效（WebAudio 合成 / 开关 / 音量 / autoplay 解锁） ----------------
    await evaluate(
      `localStorage.setItem('uno:settings', JSON.stringify({ autoCallUno: false, aiSpeed: 'fast', sound: true, soundVolume: 0.7, animation: true, animationSpeed: 'normal', showHint: true, aiChatter: true })); true`,
    );
    await navigate(`${BASE_URL}/?mock=1`);
    await waitFor('window.__verify.visibleScreen() === "lobby"', 10000, 'mock 大厅（音效验证）');
    // 真实键盘事件解锁 AudioContext（浏览器 autoplay 限制）
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    });
    await sleep(260);
    await evaluate('window.__verify.selectMock("normal-play")');
    const sfxAudit = await evaluate(`(async () => {
      const before = Number(document.documentElement.dataset.sfxCount || '0');
      const events = [
        { type: 'PLAY', seat: 1, card: { id: 'B3#0', kind: 'number', color: 'blue', value: 3, faceCode: 'B3' } },
        { type: 'DRAW', seat: 1, count: 1, cards: [] },
        { type: 'UNO_CALLED', seat: 1 },
      ];
      await new Promise((resolvePromise) => window.UnoApp.playEvents(events, resolvePromise));
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 120));
      const settings = JSON.parse(localStorage.getItem('uno:settings') || '{}');
      return { before, after: Number(document.documentElement.dataset.sfxCount || '0'), audio: document.documentElement.dataset.audio || 'none', soundVolume: settings.soundVolume };
    })()`);
    check(
      '音效：音效开启时事件触发合成音效（3 个事件 ≥3 次）',
      sfxAudit.after - sfxAudit.before >= 3,
      JSON.stringify(sfxAudit),
    );
    check(
      '音效：首次用户交互后 AudioContext 可用（autoplay 解锁）',
      sfxAudit.audio === 'running',
      `audio=${sfxAudit.audio}`,
    );
    // 关闭音效：不再播放
    await evaluate(
      `localStorage.setItem('uno:settings', JSON.stringify({ autoCallUno: false, aiSpeed: 'fast', sound: false, soundVolume: 0.7, animation: false, animationSpeed: 'normal', showHint: true, aiChatter: true })); true`,
    );
    await navigate(`${BASE_URL}/?mock=1`);
    await waitFor('window.__verify.visibleScreen() === "lobby"', 10000, 'mock 大厅（音效关闭）');
    const sfxOff = await evaluate(`(async () => {
      const before = Number(document.documentElement.dataset.sfxCount || '0');
      await new Promise((resolvePromise) => window.UnoApp.playEvents([{ type: 'PLAY', seat: 1, card: null }], resolvePromise));
      return { before, after: Number(document.documentElement.dataset.sfxCount || '0') };
    })()`);
    check('音效：设置关闭后不再播放', sfxOff.before === sfxOff.after, JSON.stringify(sfxOff));

    // ---------------- 5. mock 弹窗与 CSS 动画（回归） ----------------
    await evaluate(
      `localStorage.setItem('uno:settings', JSON.stringify({ autoCallUno: false, aiSpeed: 'fast', sound: false, animation: true, showHint: true, aiChatter: true })); true`,
    );
    await navigate(`${BASE_URL}/?mock=1`);
    await waitFor('window.__verify.visibleScreen() === "lobby"', 10000, 'mock 大厅');
    // ---------------- 4b. M5-01：挑战时手牌展示（人类挑战 AI 展示 2~3s；AI 挑战人类只提示） ----------------
    await evaluate('window.__verify.selectMock("normal-play")');
    await waitFor('window.__verify.visibleScreen() === "game"', 5000, 'mock 普通局面');
    await evaluate(`(() => {
      const token = window.__m501 = { startedAt: performance.now(), shownAt: null, hiddenAt: null, done: false, count: 0, title: '', busy: null, handCount: null };
      const overlay = document.querySelector('#challenge-reveal');
      const hand = [
        { id: 'R9#0', kind: 'number', color: 'red', value: 9, faceCode: 'R9' },
        { id: 'GS#0', kind: 'skip', color: 'green', value: null, faceCode: 'GS' },
        { id: 'W4#0', kind: 'wild4', color: null, value: null, faceCode: 'W4' },
        { id: 'B0#0', kind: 'number', color: 'blue', value: 0, faceCode: 'B0' },
        { id: 'YA2#0', kind: 'draw2', color: 'yellow', value: null, faceCode: 'YA2' },
      ];
      const poll = setInterval(() => {
        const open = overlay && !overlay.hidden;
        if (open && token.shownAt === null) {
          token.shownAt = performance.now();
          token.count = overlay.querySelectorAll('#challenge-reveal-hand .card').length;
          token.title = document.querySelector('#challenge-reveal-title')?.textContent || '';
          token.busy = document.querySelector('#game-screen').getAttribute('aria-busy');
          token.handCount = overlay.dataset.handCount;
        }
        if (!open && token.shownAt !== null && token.hiddenAt === null) { token.hiddenAt = performance.now(); clearInterval(poll); }
        if (token.done && token.shownAt !== null && token.hiddenAt !== null) clearInterval(poll);
      }, 40);
      window.UnoApp.playEvents([{ type: 'CHALLENGE_SUCCESS', challenger: 0, target: 1, hand }], () => { token.done = true; });
      return true;
    })()`);
    await waitFor(
      `(() => { const overlay = document.querySelector('#challenge-reveal'); return overlay && !overlay.hidden; })()`,
      3000,
      '挑战手牌展示出现',
    );
    await sleep(200);
    await shot('ui-m5-challenge-hand-1440.png');
    await waitFor('window.__m501 && window.__m501.done === true', 8000, '挑战手牌展示播放完成');
    await sleep(180);
    const revealAudit = await evaluate(
      `(() => { const token = window.__m501; return { ...token, visible: !document.querySelector('#challenge-reveal').hidden, elapsed: token.hiddenAt === null ? null : Math.round(token.hiddenAt - token.shownAt) }; })()`,
    );
    check(
      '挑战手牌展示：人类挑战 AI 成功时展示对方完整手牌',
      revealAudit.count === 5 &&
        revealAudit.title.includes('查看') &&
        revealAudit.handCount === '5',
      JSON.stringify({ count: revealAudit.count, title: revealAudit.title }),
    );
    check(
      '挑战手牌展示：约 2~3 秒后自动消失',
      revealAudit.visible === false &&
        revealAudit.elapsed !== null &&
        revealAudit.elapsed >= 2000 &&
        revealAudit.elapsed <= 4000,
      JSON.stringify({ elapsed: revealAudit.elapsed, visible: revealAudit.visible }),
    );
    check(
      '挑战手牌展示：展示期间输入锁定（aria-busy）',
      revealAudit.busy === 'true',
      `busy=${revealAudit.busy}`,
    );
    // AI 挑战人类成功：只提示「查看了你的手牌」，不展示牌面
    await evaluate(
      `window.UnoApp.playEvents([{ type: 'CHALLENGE_SUCCESS', challenger: 1, target: 0 }], () => {}); true`,
    );
    await sleep(350);
    const aiLookNotice = await evaluate(
      `({ toast: document.querySelector('#toast-region')?.textContent || '', overlayHidden: document.querySelector('#challenge-reveal')?.hidden })`,
    );
    check(
      '挑战：AI 挑战人类只提示「查看了你的手牌」且不展示手牌',
      aiLookNotice.overlayHidden === true && aiLookNotice.toast.includes('查看了你的手牌'),
      JSON.stringify(aiLookNotice),
    );

    // ---------------- 4c. M5-06：规则决策表可配置项接入设置页 ----------------
    await evaluate('window.__verify.selectMock("lobby")');
    await waitFor('window.__verify.visibleScreen() === "lobby"', 5000, 'mock 大厅');
    await evaluate(
      `document.querySelector('.screen.is-active [data-open-dialog="settings"]').click(); true`,
    );
    await waitFor('window.__verify.activeDialogTitle() === "设置"', 5000, '设置弹窗');
    await shot('ui-m6-settings-1440.png');
    const ruleDefaults = await evaluate(`(() => {
      const root = document.querySelector('#dialog-root.is-open');
      const read = (key) => { const node = root.querySelector('[data-setting="' + key + '"]'); if (!node) return null; return node.tagName === 'SELECT' ? node.value : Boolean(node.checked); };
      return { twoPlayerRules: read('twoPlayerRules'), unoPenalty: read('unoPenalty'), deckExhaustion: read('deckExhaustion'), startCardRule: read('startCardRule'), soundVolume: read('soundVolume'), animationSpeed: read('animationSpeed'), hasRulesHeading: (root.textContent || '').includes('规则（对之后新开的对局生效）'), hasDesktopKey: Boolean(root.querySelector('[data-ai-key-input]')) };
    })()`);
    check(
      '设置页：规则 4 项 + 音效音量/动画速度可配置且默认值正确（浏览器不显示桌面 Key）',
      ruleDefaults.hasRulesHeading &&
        ruleDefaults.twoPlayerRules === true &&
        ruleDefaults.unoPenalty === '2' &&
        ruleDefaults.deckExhaustion === 'reshuffle' &&
        ruleDefaults.startCardRule === 'classic' &&
        ruleDefaults.soundVolume === '0.7' &&
        ruleDefaults.animationSpeed === 'normal' &&
        ruleDefaults.hasDesktopKey === false,
      JSON.stringify(ruleDefaults),
    );
    await evaluate(`(() => {
      const root = document.querySelector('#dialog-root.is-open');
      const set = (key, value) => { const node = root.querySelector('[data-setting="' + key + '"]'); if (!node) return; if (node.type === 'checkbox') node.checked = value; else node.value = String(value); };
      set('twoPlayerRules', false); set('unoPenalty', 3); set('deckExhaustion', 'end-by-fewest'); set('startCardRule', 'ignore-action'); set('soundVolume', 0.35); set('animationSpeed', 'fast');
      [...root.querySelectorAll('.dialog-actions button')].find((button) => button.textContent.trim() === '保存').click();
      return true;
    })()`);
    await sleep(300);
    const savedSettings = await evaluate(
      `JSON.parse(localStorage.getItem('uno:settings') || '{}')`,
    );
    check(
      '设置页：规则项保存到本地设置（uno:settings）',
      savedSettings.twoPlayerRules === false &&
        savedSettings.unoPenalty === 3 &&
        savedSettings.deckExhaustion === 'end-by-fewest' &&
        savedSettings.startCardRule === 'ignore-action' &&
        savedSettings.soundVolume === 0.35 &&
        savedSettings.animationSpeed === 'fast',
      JSON.stringify(savedSettings),
    );
    const savedToast = await evaluate(`document.querySelector('#toast-region')?.textContent || ''`);
    check('设置页：保存后提示「设置已保存」', savedToast.includes('设置已保存'), savedToast);
    // 设置 → 引擎配置映射：?test=1 下注入了 window.__unoEngineConfig，可直接断言本局最终 GameConfig
    await navigate(`${BASE_URL}/?test=1`);
    await waitFor('window.__verify.visibleScreen() === "lobby"', 10000, '大厅可见（规则映射验证）');
    await evaluate('window.__verify.selectPlayers(2)');
    await evaluate('window.__verify.clickStart()');
    await waitFor(
      'window.__verify.visibleScreen() === "game"',
      10000,
      '进入 2 人牌桌（规则映射验证）',
    );
    await waitFor('window.__unoEngineConfig !== undefined', 5000, '引擎配置已注入（?test=1）');
    const appliedConfig = await evaluate(
      `(() => { const config = window.__unoEngineConfig || {}; return { playerCount: config.playerCount, twoPlayerRules: config.twoPlayerRules, unoPenalty: config.unoPenalty, deckExhaustion: config.deckExhaustion, startCardRule: config.startCardRule }; })()`,
    );
    check(
      '设置页：规则项映射到本局引擎配置（2 人局真实开局）',
      appliedConfig.playerCount === 2 &&
        appliedConfig.twoPlayerRules === false &&
        appliedConfig.unoPenalty === 3 &&
        appliedConfig.deckExhaustion === 'end-by-fewest' &&
        appliedConfig.startCardRule === 'ignore-action',
      JSON.stringify(appliedConfig),
    );
    await navigate(`${BASE_URL}/?mock=1`);
    await waitFor('window.__verify.visibleScreen() === "lobby"', 10000, 'mock 大厅');
    await evaluate(
      `document.querySelector('.screen.is-active [data-open-dialog="settings"]').click(); true`,
    );
    await waitFor('window.__verify.activeDialogTitle() === "设置"', 5000, '设置弹窗（刷新后）');
    const persistedRules = await evaluate(
      `(() => { const root = document.querySelector('#dialog-root.is-open'); const read = (key) => { const node = root.querySelector('[data-setting="' + key + '"]'); return node.tagName === 'SELECT' ? node.value : Boolean(node.checked); }; return { twoPlayerRules: read('twoPlayerRules'), unoPenalty: read('unoPenalty'), deckExhaustion: read('deckExhaustion'), startCardRule: read('startCardRule'), soundVolume: read('soundVolume'), animationSpeed: read('animationSpeed') }; })()`,
    );
    check(
      '设置页：规则项刷新后保持（持久化）',
      persistedRules.twoPlayerRules === false &&
        persistedRules.unoPenalty === '3' &&
        persistedRules.deckExhaustion === 'end-by-fewest' &&
        persistedRules.startCardRule === 'ignore-action' &&
        persistedRules.soundVolume === '0.35' &&
        persistedRules.animationSpeed === 'fast',
      JSON.stringify(persistedRules),
    );
    // 恢复默认设置，避免影响后续用例
    await evaluate(
      `localStorage.setItem('uno:settings', JSON.stringify({ autoCallUno: false, aiSpeed: 'fast', sound: false, animation: true, showHint: true, aiChatter: true, twoPlayerRules: true, unoPenalty: 2, deckExhaustion: 'reshuffle', startCardRule: 'classic', soundVolume: 0.7, animationSpeed: 'normal' })); true`,
    );
    await navigate(`${BASE_URL}/?mock=1`);
    await waitFor(
      'window.__verify.visibleScreen() === "lobby"',
      10000,
      'mock 大厅（已恢复默认设置）',
    );
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
    // BUG-02：UNO 按钮显著放大 + 单击一次即喊出（无二次确认弹窗）
    const unoButton = await evaluate(
      `(() => { const button = document.querySelector('.uno-button'); if (!button) return null; const rect = button.getBoundingClientRect(); return { w: Math.round(rect.width), h: Math.round(rect.height), font: parseFloat(getComputedStyle(button).fontSize), text: button.textContent.trim() }; })()`,
    );
    check(
      'UNO 按钮显著放大（高度 ≥56px、字号 ≥20px）',
      Boolean(unoButton) && unoButton.h >= 56 && unoButton.font >= 20,
      JSON.stringify(unoButton),
    );
    // M5：UNO 窗口金色倒计时环（mock 难度 = realistic → 6s；契约 §7.1/§7.4）
    const unoCountdown = await evaluate(
      `(() => {
        const bar = document.querySelector('.uno-button .uno-countdown');
        if (!bar) return null;
        const style = getComputedStyle(bar);
        return {
          duration: style.animationDuration,
          animationName: style.animationName,
          windowKey: bar.dataset.windowKey || '',
          bgImage: style.backgroundImage || '',
        };
      })()`,
    );
    check(
      'M5 UNO 金环：倒计时条升级为金色环（uno-ring 动画、conic-gradient、data-window-key）',
      Boolean(unoCountdown) &&
        unoCountdown.animationName.includes('uno-ring') &&
        unoCountdown.bgImage.includes('conic-gradient') &&
        unoCountdown.windowKey.length > 0,
      JSON.stringify(unoCountdown),
    );
    check(
      'M5 UNO 金环：环时长 = 难度映射（mock realistic → 6s）',
      Boolean(unoCountdown) && Number.parseFloat(unoCountdown.duration) === 6,
      JSON.stringify(unoCountdown),
    );
    // M5 验收：重复 render 3 次环不重启（data-window-key 不变 + 负 animation-delay 续走进度）
    await evaluate('window.__verify.selectMock("uno-window")');
    await sleep(150);
    await evaluate('window.__verify.selectMock("uno-window")');
    await sleep(150);
    await evaluate('window.__verify.selectMock("uno-window")');
    await sleep(150);
    const unoRerender = await evaluate(
      `(() => {
        const bar = document.querySelector('.uno-button .uno-countdown');
        if (!bar) return null;
        return {
          windowKey: bar.dataset.windowKey || '',
          delay: getComputedStyle(bar).animationDelay,
        };
      })()`,
    );
    check(
      'M5 UNO 金环：重复 render 3 次窗口 key 不变且进度不重置（负 animation-delay）',
      Boolean(unoRerender) &&
        unoRerender.windowKey === unoCountdown.windowKey &&
        Number.parseFloat(unoRerender.delay) < 0,
      JSON.stringify({ before: unoCountdown?.windowKey, after: unoRerender }),
    );
    // M5 验收负向：手牌 2 张 / 0 张时即使 canCallUno=true 也无 UNO 按钮（契约 §7.6）
    await evaluate('window.__verify.selectMock("uno-window-two-cards")');
    await sleep(150);
    const unoTwoCards = await evaluate(
      `({ uno: Boolean(document.querySelector('#action-bar .uno-button')) })`,
    );
    check('M5 UNO 条件：手牌 2 张时不显示 UNO 按钮', !unoTwoCards.uno, JSON.stringify(unoTwoCards));
    await evaluate('window.__verify.selectMock("uno-window-empty")');
    await sleep(150);
    const unoEmpty = await evaluate(
      `({ uno: Boolean(document.querySelector('#action-bar .uno-button')) })`,
    );
    check('M5 UNO 条件：手牌 0 张时不显示 UNO 按钮', !unoEmpty.uno, JSON.stringify(unoEmpty));
    // M5 静态降级：动画关闭时金环静止（is-static + 秒数文本），按钮可见（契约 §7.6）
    // 注意：render.js 每次 render 都会用 settings 覆盖 data-animation，必须改 localStorage 而非 dataset
    await evaluate(
      `localStorage.setItem('uno:settings', JSON.stringify({ autoCallUno: false, aiSpeed: 'fast', sound: false, animation: false, showHint: true, aiChatter: true })); true`,
    );
    await evaluate('window.__verify.selectMock("uno-window")');
    await sleep(150);
    const unoStatic = await evaluate(
      `(() => {
        const button = document.querySelector('.uno-button');
        const bar = button?.querySelector('.uno-countdown');
        if (!button || !bar) return null;
        const style = getComputedStyle(bar);
        return {
          visible: !button.hidden && button.getBoundingClientRect().height > 0,
          isStatic: bar.classList.contains('is-static'),
          animationName: style.animationName,
          seconds: button.querySelector('.uno-seconds')?.textContent || '',
          windowKey: bar.dataset.windowKey || '',
        };
      })()`,
    );
    check(
      'M5 UNO 静态降级：动画关闭时金环静止、按钮可见、文本秒数可读',
      Boolean(unoStatic) &&
        unoStatic.visible &&
        unoStatic.isStatic &&
        unoStatic.animationName === 'none' &&
        /^\d+s$/.test(unoStatic.seconds),
      JSON.stringify(unoStatic),
    );
    await evaluate(
      `localStorage.setItem('uno:settings', JSON.stringify({ autoCallUno: false, aiSpeed: 'fast', sound: false, animation: true, showHint: true, aiChatter: true })); true`,
    );
    await shot('v2/M5-uno-ring-static.png');
    // M5 到期行为（契约 §7.5）：环结束 → data-window-state=expired、按钮隐藏、#hint-bar 提示，不提交动作
    await evaluate('window.__verify.selectMock("uno-window")');
    await sleep(150);
    const unoExpired = await evaluate(
      `(() => {
        const bar = document.querySelector('.uno-button .uno-countdown');
        if (!bar) return null;
        bar.dispatchEvent(new Event('animationend'));
        const button = document.querySelector('.uno-button');
        return {
          state: button?.dataset.windowState || '',
          hidden: Boolean(button?.hidden),
          hint: document.querySelector('#hint-bar')?.textContent || '',
        };
      })()`,
    );
    check(
      'M5 UNO 到期：环结束隐藏按钮 + 「UNO 窗口已结束」提示，不提交动作',
      Boolean(unoExpired) &&
        unoExpired.state === 'expired' &&
        unoExpired.hidden &&
        unoExpired.hint.includes('UNO 窗口已结束'),
      JSON.stringify(unoExpired),
    );
    await shot('v2/M5-uno-ring-expired.png');
    await evaluate(`document.querySelector('.uno-button').click(); true`);
    await sleep(250);
    const unoClick = await evaluate(
      `({ dialogOpen: Boolean(document.querySelector('#dialog-root.is-open')), toast: document.querySelector('#toast-region')?.textContent || '' })`,
    );
    check(
      'UNO 单击一次即喊出（不再二次确认弹窗）',
      !unoClick.dialogOpen && unoClick.toast.includes('UNO'),
      JSON.stringify(unoClick),
    );
    const unoAnimation = await evaluate('window.__verify.animations()');
    check(
      'UNO 按钮脉冲动画 uno-pulse 生效',
      unoAnimation.uno.includes('uno-pulse'),
      `animationName=${unoAnimation.uno}`,
    );
    await shot('ui-m32-mock-uno-1440.png');
    // M5-03：UNO 窗口边界——只有自己需要喊 UNO 时，操作栏不应出现「抓他！」按钮
    const unoWindowBar = await evaluate('window.__verify.actionLabels()');
    check(
      'UNO 窗口边界：需要自己喊 UNO 时无「抓他！」按钮',
      !unoWindowBar.some((item) => item.text === '抓他！'),
      JSON.stringify(unoWindowBar),
    );
    // M5-03：抓 UNO 按钮 → 确认弹窗 → 提交（AI 忘喊 UNO 时人类可抓）
    await evaluate('window.__verify.selectMock("catch-uno")');
    await waitFor('window.__verify.visibleScreen() === "game"', 5000, 'mock 抓 UNO 局面');
    const catchBar = await evaluate('window.__verify.actionLabels()');
    check(
      '抓 UNO：操作栏出现「抓他！」按钮',
      catchBar.some((item) => item.text === '抓他！' && !item.disabled),
      JSON.stringify(catchBar),
    );
    await evaluate(
      `(() => { const button = [...document.querySelectorAll('#action-bar button')].find((item) => item.textContent.trim() === '抓他！'); button?.click(); return Boolean(button); })()`,
    );
    await waitFor('window.__verify.activeDialogTitle() === "抓 UNO"', 5000, '抓 UNO 确认弹窗');
    const catchDialogButtons = await evaluate('window.__verify.dialogs()');
    check(
      '抓 UNO：弹窗要求确认（含「抓他！」按钮）',
      catchDialogButtons.includes('抓他！'),
      JSON.stringify(catchDialogButtons),
    );
    await shot('ui-m5-catch-uno-1440.png');
    await evaluate(
      `(() => { const button = [...document.querySelectorAll('#dialog-root.is-open button')].find((item) => item.textContent.trim() === '抓他！'); button?.click(); return Boolean(button); })()`,
    );
    await sleep(250);
    const catchSubmit = await evaluate(
      `({ dialogOpen: Boolean(document.querySelector('#dialog-root.is-open')), toast: document.querySelector('#toast-region')?.textContent || '' })`,
    );
    check(
      '抓 UNO：确认后提交动作并关闭弹窗',
      !catchSubmit.dialogOpen && catchSubmit.toast.includes('抓他'),
      JSON.stringify(catchSubmit),
    );
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

    // M5-04：牌堆只剩 0/1 张时 HUD 计数与洗回提示（mock 静态局面，真实引擎边界由单测覆盖）
    await evaluate('window.__verify.selectMock("deck-edge-zero")');
    await waitFor('window.__verify.visibleScreen() === "game"', 5000, 'mock 牌堆边界局面（0 张）');
    const deckEdgeZero = await evaluate(
      `({ text: document.querySelector('#draw-count')?.textContent || '', dataCount: document.querySelector('#draw-pile')?.dataset.count || '', feed: document.querySelector('#event-feed')?.textContent || '' })`,
    );
    check(
      '牌堆边界：抽牌堆剩 0 张时计数正常显示',
      deckEdgeZero.text === '0' && deckEdgeZero.dataCount === '0',
      JSON.stringify(deckEdgeZero),
    );
    check(
      '牌堆边界：洗回事件在事件流显示「牌堆重新洗牌」',
      deckEdgeZero.feed.includes('牌堆重新洗牌') && deckEdgeZero.feed.includes('摸了 2 张'),
      deckEdgeZero.feed,
    );
    await shot('ui-m5-deck-edge-1440.png');
    await evaluate('window.__verify.selectMock("deck-edge-one")');
    await sleep(200);
    const deckEdgeOne = await evaluate(
      `({ text: document.querySelector('#draw-count')?.textContent || '', dataCount: document.querySelector('#draw-pile')?.dataset.count || '' })`,
    );
    check(
      '牌堆边界：抽牌堆剩 1 张时计数正常显示',
      deckEdgeOne.text === '1' && deckEdgeOne.dataCount === '1',
      JSON.stringify(deckEdgeOne),
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
    // 1024 牌桌（mock）布局 + 放大的当前颜色不溢出/不遮挡
    await evaluate('window.__verify.selectMock("normal-play")');
    await waitFor('window.__verify.visibleScreen() === "game"', 5000, '1024 牌桌');
    const game1024 = await evaluate(
      `({ overflow: window.__verify.overflow(), color: window.__verify.colorMetrics(), labels: window.__verify.actionLabels() })`,
    );
    check(
      '1024 宽牌桌无横向溢出、放大的当前颜色不遮挡/不溢出',
      game1024.overflow.scroll <= game1024.overflow.client &&
        Boolean(game1024.color) &&
        !game1024.color.pageOverflow &&
        !game1024.color.topBarOverflow &&
        game1024.color.labelRect.right <= game1024.color.viewportW &&
        game1024.color.dotW >= 20,
      JSON.stringify(game1024.color),
    );
    check(
      '1024 牌桌操作栏无出牌按钮',
      !game1024.labels.some((item) => item.text.startsWith('出 ') || item.text.startsWith('叠 ')),
      JSON.stringify(game1024.labels),
    );
    const mockHands1024 = await evaluate('window.__verify.opponentHands()');
    check(
      'M13 @1024：卡背保持 22×33 且不压名字/张数',
      mockHands1024.length === 3 &&
        mockHands1024.every(
          (hand) =>
            hand.visible === Math.min(5, hand.handCount) &&
            hand.cards === hand.visible &&
            hand.cardW === 22 &&
            hand.cardH === 33 &&
            !hand.nameOverlap &&
            !hand.metaOverlap &&
            hand.inside,
        ),
      JSON.stringify(mockHands1024),
    );
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });

    // ---------------- 5b. M6-05：小屏响应式（760 宽）与减少动态效果回归 ----------------
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 760,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await navigate(`${BASE_URL}/?mock=1`);
    await waitFor('window.__verify.visibleScreen() === "lobby"', 10000, '760 大厅');
    // M2：760 宽大厅品牌可见性、Tab 顺序与开局路径
    await waitFor('window.__verify.brandAudit().versionVisible', 5000, '760 大厅版本号可见');
    const brand760 = await evaluate('window.__verify.brandAudit()');
    check(
      'M2 @760 大厅：品牌、版本号与开启对局可见、Tab 顺序正确、无横向溢出',
      brand760.titleVisible && brand760.versionVisible && brand760.startVisible && brand760.tabOrder && !brand760.overflow,
      JSON.stringify(brand760),
    );
    await shot('v2/M2-lobby-760.png');
    const mobileLobby = await evaluate('window.__verify.overflow()');
    check(
      '760 宽大厅无横向溢出',
      mobileLobby.scroll <= mobileLobby.client,
      JSON.stringify(mobileLobby),
    );
    await evaluate('window.__verify.selectMock("normal-play")');
    await waitFor('window.__verify.visibleScreen() === "game"', 5000, '760 牌桌');
    const mobileGame = await evaluate(
      `({ overflow: window.__verify.overflow(), hand: (() => { const node = document.querySelector('#hand'); return { scroll: node.scrollWidth, client: node.clientWidth, cards: node.querySelectorAll('.card').length }; })(), actionBar: window.__verify.actionLabels().length })`,
    );
    check(
      '760 宽牌桌无横向溢出、手牌区可横向滚动兜底、操作栏可用',
      mobileGame.overflow.scroll <= mobileGame.overflow.client &&
        mobileGame.hand.cards >= 5 &&
        mobileGame.hand.scroll >= mobileGame.hand.client &&
        mobileGame.actionBar >= 1,
      JSON.stringify(mobileGame),
    );
    const mobileHands = await evaluate('window.__verify.opponentHands()');
    check(
      'M13 @760：卡背缩为 18×27、张数映射不变、避开名字/张数',
      mobileHands.length === 3 &&
        mobileHands.every(
          (hand) =>
            hand.visible === Math.min(5, hand.handCount) &&
            hand.cards === hand.visible &&
            hand.display === 'block' &&
            hand.cardW === 18 &&
            hand.cardH === 27 &&
            !hand.nameOverlap &&
            !hand.metaOverlap &&
            hand.inside,
        ),
      JSON.stringify(mobileHands),
    );
    await shot('ui-m6-mobile-760.png');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 420,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(250);
    const compactHands = await evaluate('window.__verify.opponentHands()');
    check(
      'M13 @420：极窄屏隐藏对手卡背，保留「N 张」文字且无横向溢出',
      compactHands.length === 3 &&
        compactHands.every((hand) => hand.display === 'none') &&
        (await evaluate('window.__verify.overflow()')).scroll <=
          (await evaluate('window.__verify.overflow()')).client,
      JSON.stringify(compactHands),
    );
    // M3 @420：座位隐藏头像（卡背由 M13 断言覆盖），姓名与精确牌数保留
    const compact420 = await evaluate(
      `(() => {
        const seats = [...document.querySelectorAll('#opponents .opponent')];
        return {
          avatarHidden: seats.every((node) => {
            const avatar = node.querySelector('.avatar');
            return !avatar || getComputedStyle(avatar).display === 'none';
          }),
          names: seats.every((node) => (node.querySelector('.opponent-name')?.textContent || '').length > 0),
          counts: seats.every((node) => (node.querySelector('.opponent-meta')?.textContent || '').includes('张')),
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
      })()`,
    );
    check(
      'M3 @420：座位隐藏头像、保留姓名与精确牌数、无横向溢出',
      compact420.avatarHidden && compact420.names && compact420.counts && !compact420.overflow,
      JSON.stringify(compact420),
    );
    // M4 @420：极窄屏手牌——dock 保留、卡宽 76、区高 ≥168、无页面横向溢出（折叠/滚动都在 #hand 内）
    const dock420 = await evaluate(
      `(() => {
        const dock = window.__verify.handDock();
        const card = document.querySelector('#hand .card');
        return { ...dock, cardW: card ? card.offsetWidth : 0, handMinH: parseFloat(getComputedStyle(document.querySelector('#hand')).minHeight) };
      })()`,
    );
    check(
      'M4 @420：hand-dock 保留、手牌 76px、区高 ≥168px、data-count 一致、页面无横向溢出',
      dock420.dockClass &&
        !dock420.hasVisibleTitle &&
        dock420.cardW === 76 &&
        dock420.handMinH >= 168 &&
        Number(dock420.dataCount) === dock420.cardCount &&
        dock420.everyCardHasState &&
        !dock420.overflow,
      JSON.stringify({
        dockClass: dock420.dockClass,
        cardW: dock420.cardW,
        handMinH: dock420.handMinH,
        dataCount: dock420.dataCount,
        cardCount: dock420.cardCount,
        overflow: dock420.overflow,
      }),
    );
    // M2：420 宽大厅品牌可见性、Tab 顺序与开局路径（契约 B01/B02 的 W6 断点）
    await navigate(`${BASE_URL}/?mock=1`);
    await waitFor('window.__verify.visibleScreen() === "lobby"', 10000, '420 大厅');
    await waitFor('window.__verify.brandAudit().versionVisible', 5000, '420 大厅版本号可见');
    const brand420 = await evaluate('window.__verify.brandAudit()');
    check(
      'M2 @420 大厅：品牌、版本号与开启对局可见、Tab 顺序正确、无横向溢出',
      brand420.titleVisible && brand420.versionVisible && brand420.startVisible && brand420.tabOrder && !brand420.overflow,
      JSON.stringify(brand420),
    );
    await shot('v2/M2-lobby-420.png');
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
      '# 浏览器验收报告（自动生成；M3-3/M4 回归 + M5 规则边界）',
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
      '- review-assets/ui-m5-deck-edge-1440.png',
      '- review-assets/ui-m5-catch-uno-1440.png',
      '- review-assets/ui-m5-challenge-hand-1440.png',
      '- review-assets/ui-m5-6p-1440.png',
      '- review-assets/ui-m5-10p-1440.png',
      '- review-assets/ui-m5-10p-1024.png',
      '- review-assets/ui-m6-effects-1440.png',
      '- review-assets/ui-m6-settings-1440.png',
      '- review-assets/ui-m6-mobile-760.png',
      '- review-assets/v2/M2-lobby-1440.png',
      '- review-assets/v2/M2-lobby-1024.png',
      '- review-assets/v2/M2-lobby-760.png',
      '- review-assets/v2/M2-lobby-420.png',
      '- review-assets/v2/M3-table-4p-1440.png',
      '- review-assets/v2/M4-hand-dock-1440.png',
      '- review-assets/v2/M3-table-10p-1440.png',
      '- review-assets/v2/M3-table-10p-1024.png',
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
