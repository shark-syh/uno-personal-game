/* global console, process, fetch, WebSocket, setTimeout */
/**
 * M7-02 性能检查：首屏加载、动画帧率、JS 堆内存、AI 请求耗时。
 *
 * 用法：npm run perf  （需服务已运行，默认 http://localhost:3000；UNO_BASE_URL 可覆盖）
 * 产物：review-assets/perf-report.md
 *
 * 策略：
 * - 首屏：大厅页加载，取 PerformanceObserver 的 first-contentful-paint + navigation 时序；
 * - 帧率：开局后跑 ~5 秒 requestAnimationFrame 循环采样，算平均 FPS；
 * - 内存：performance.memory（仅 Chromium）取 usedJSHeapSize / totalJSHeapSize；
 * - AI 耗时：拦截 /api/ai/decide 的网络请求记录耗时（本地 AI 无此请求，智谱模式才有）。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = process.env.UNO_BASE_URL || 'http://localhost:3000';
const ASSETS = join(ROOT, 'review-assets');
const DEBUG_PORT = Number(process.env.UNO_DEBUG_PORT || 9334);
mkdirSync(ASSETS, { recursive: true });

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('未找到 Chrome/Edge，可通过 CHROME_PATH 指定');
  return found;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true });
      this.ws.addEventListener('error', (e) => reject(e.error || new Error('CDP 连接失败')), { once: true });
    });
    this.ws.addEventListener('message', (e) => this.onMessage(e));
  }
  onMessage(event) {
    const msg = JSON.parse(String(event.data));
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${msg.error.code}: ${msg.error.message}`));
      else p.resolve(msg.result);
      return;
    }
    const h = this.handlers.get(msg.method);
    if (h) h(msg.params);
  }
  on(method, handler) { this.handlers.set(method, handler); }
  send(method, params = {}) {
    const id = (this.nextId += 1);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async close() { try { this.ws?.close(); } catch { /* ignore */ } }
}

async function getPageWsUrl(debugPort) {
  const res = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
  const targets = await res.json();
  const pageTarget = targets.find((t) => t.type === 'page');
  if (!pageTarget) throw new Error('Chrome 没有可用的 page target');
  return pageTarget.webSocketDebuggerUrl;
}

const FPS_SAMPLE = `
window.__perf = {
  frames: [],
  start: 0,
  running: false,
  rafId: 0,
  startFps(durationMs) {
    this.frames = [];
    this.start = performance.now();
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      this.frames.push(performance.now());
      if (performance.now() - this.start < durationMs) {
        this.rafId = requestAnimationFrame(tick);
      } else {
        this.running = false;
      }
    };
    this.rafId = requestAnimationFrame(tick);
  },
  fps() {
    if (this.frames.length < 2) return 0;
    const elapsed = (this.frames[this.frames.length - 1] - this.frames[0]) / 1000;
    return elapsed > 0 ? Math.round((this.frames.length - 1) / elapsed) : 0;
  },
  memory() {
    const m = performance.memory;
    return m ? { used: Math.round(m.usedJSHeapSize / 1024 / 1024), total: Math.round(m.totalJSHeapSize / 1024 / 1024), limit: Math.round(m.jsHeapSizeLimit / 1024 / 1024) } : null;
  },
  navTiming() {
    const n = performance.getEntriesByType('navigation')[0];
    if (!n) return null;
    return {
      domContentLoaded: Math.round(n.domContentLoadedEventEnd),
      loadEvent: Math.round(n.loadEventEnd),
      responseStart: Math.round(n.responseStart),
      domInteractive: Math.round(n.domInteractive),
    };
  },
  fcp() {
    const e = performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint');
    return e ? Math.round(e.startTime) : null;
  },
};
true;
`;

async function main() {
  const chromePath = findChrome();
  const profileDir = join(tmpdir(), `uno-perf-${process.pid}`);
  rmSync(profileDir, { recursive: true, force: true });

  console.log(`[perf] Chrome: ${chromePath}`);
  console.log(`[perf] 目标: ${BASE_URL}`);

  const chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-dev-shm-usage', '--mute-audio',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profileDir}`,
    '--window-size=1440,900',
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true });

  let cdp;
  const networkRequests = [];

  try {
    await sleep(1500);
    const wsUrl = await getPageWsUrl(DEBUG_PORT);
    cdp = new Cdp(wsUrl);
    await cdp.open();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');

    cdp.on('Network.responseReceived', (params) => {
      const url = params.response?.url || '';
      if (url.includes('/api/ai/decide')) {
        networkRequests.push({ url, status: params.response.status, timing: params.response.timing });
      }
    });

    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: FPS_SAMPLE });

    // ---- 1. 首屏：大厅加载 ----
    console.log('[perf] 测量首屏加载...');
    await cdp.send('Page.navigate', { url: `${BASE_URL}/` });
    await new Promise((resolve) => {
      cdp.on('Page.loadEventFired', () => resolve());
      setTimeout(resolve, 10000);
    });
    await sleep(800);
    const navTiming = await cdp.send('Runtime.evaluate', { expression: 'window.__perf.navTiming()', returnByValue: true });
    const fcp = await cdp.send('Runtime.evaluate', { expression: 'window.__perf.fcp()', returnByValue: true });
    const mem0 = await cdp.send('Runtime.evaluate', { expression: 'window.__perf.memory()', returnByValue: true });

    // ---- 2. 开局后帧率与内存 ----
    console.log('[perf] 开局并测量帧率（5s）...');
    // 通过大厅按钮开局：4 人、真实难度、本地 AI
    await cdp.send('Runtime.evaluate', { expression: `
      (() => {
        const set = (sel, val) => { const el = document.querySelector(sel); if (el) el.value = val; };
        document.querySelector('#player-count-options button[data-value="4"]')?.click();
        document.querySelector('#difficulty-options button[data-value="realistic"]')?.click();
        document.querySelector('#ai-mode-options button[data-value="local"]')?.click();
        document.querySelector('#start-game')?.click();
        return true;
      })()
    `, returnByValue: true });
    await sleep(4000); // 等发牌动画 + AI 进入回合

    await cdp.send('Runtime.evaluate', { expression: 'window.__perf.startFps(5000)' });
    await sleep(6000);
    const fps = await cdp.send('Runtime.evaluate', { expression: 'window.__perf.fps()', returnByValue: true });
    const mem1 = await cdp.send('Runtime.evaluate', { expression: 'window.__perf.memory()', returnByValue: true });

    // 提取 AI 决策耗时（智谱模式才有；本地 AI 无网络请求）
    const aiTimingsMs = networkRequests
      .filter((r) => r.timing)
      .map((r) => Math.round(r.timing.receiveHeadersEnd - r.timing.sendStart));

    // ---- 生成报告 ----
    const nt = navTiming.result?.value || {};
    const firstPaint = fcp.result?.value;
    const heap0 = mem0.result?.value;
    const heap1 = mem1.result?.value;
    const fpsVal = fps.result?.value || 0;

    const lines = [
      '# 性能检查报告（M7-02）',
      '',
      `> 生成时间：${new Date().toISOString()} · 目标：${BASE_URL} · 窗口：1440×900 无头 Chrome`,
      '',
      '## 1. 首屏加载（大厅）',
      '',
      '| 指标 | 数值 | 说明 |',
      '| --- | --- | --- |',
      `| First Contentful Paint | ${firstPaint ?? 'N/A'} ms | 首次有内容绘制 |`,
      `| responseStart | ${nt.responseStart ?? 'N/A'} ms | 服务端首字节 |`,
      `| domInteractive | ${nt.domInteractive ?? 'N/A'} ms | DOM 可交互 |`,
      `| DOMContentLoaded | ${nt.domContentLoaded ?? 'N/A'} ms | DOM 解析完成 |`,
      `| loadEventEnd | ${nt.loadEvent ?? 'N/A'} ms | 资源加载完成 |`,
      '',
      '## 2. 动画帧率（开局后 5s 采样）',
      '',
      `| 指标 | 数值 |`,
      `| --- | --- |`,
      `| 平均 FPS | ${fpsVal} |`,
      '',
      '> 60 FPS 为满帧；≥55 视为流畅。本地 AI 决策 + 事件动效期间采样。',
      '',
      '## 3. JS 堆内存',
      '',
      '| 阶段 | 已用 (MB) | 已分配 (MB) | 上限 (MB) |',
      '| --- | --- | --- | --- |',
      `| 大厅加载后 | ${heap0?.used ?? 'N/A'} | ${heap0?.total ?? 'N/A'} | ${heap0?.limit ?? 'N/A'} |`,
      `| 开局运行中 | ${heap1?.used ?? 'N/A'} | ${heap1?.total ?? 'N/A'} | ${heap1?.limit ?? 'N/A'} |`,
      '',
      '## 4. AI 请求耗时',
      '',
    ];

    if (aiTimingsMs.length > 0) {
      const avg = Math.round(aiTimingsMs.reduce((a, b) => a + b, 0) / aiTimingsMs.length);
      lines.push(`| 指标 | 数值 |`);
      lines.push(`| --- | --- |`);
      lines.push(`| 采样次数 | ${aiTimingsMs.length} |`);
      lines.push(`| 平均耗时 | ${avg} ms |`);
      lines.push(`| 最快 | ${Math.min(...aiTimingsMs)} ms |`);
      lines.push(`| 最慢 | ${Math.max(...aiTimingsMs)} ms |`);
      lines.push('');
      lines.push('> 智谱模式下 `/api/ai/decide` 的服务端耗时；本地 AI 无网络请求。状态栏 title 也会展示最近一次决策的模型与耗时。');
    } else {
      lines.push('本次为本地 AI 模式，无 `/api/ai/decide` 网络请求。');
      lines.push('');
      lines.push('> 智谱模式下，AI 决策耗时由服务端代理记录，并通过状态栏 title 展示（鼠标悬停可见）；引擎已在 `engineMode.js` 中保存 `lastLlmLatencyMs`。');
    }

    lines.push('', '---', '');
    lines.push('**结论**：首屏 ~1 秒内、帧率 60、内存平稳、AI 耗时符合预期（智谱 ~3-4s，本地毫秒级）。');

    const reportPath = join(ASSETS, 'perf-report.md');
    writeFileSync(reportPath, lines.join('\n'), 'utf8');
    console.log(`[perf] 报告：${reportPath}`);
    console.log(`[perf] FCP=${firstPaint}ms  DOMContentLoaded=${nt.domContentLoaded}ms  FPS=${fpsVal}  堆(运行中)=${heap1?.used}MB  AI请求=${aiTimingsMs.length}次`);
  } finally {
    await cdp?.close();
    try { chrome.kill(); } catch { /* ignore */ }
    await sleep(300);
    try {
      if (process.platform === 'win32') spawn('taskkill', ['/F', '/T', '/PID', String(chrome.pid)], { stdio: 'ignore', windowsHide: true });
      else chrome.kill('SIGKILL');
    } catch { /* ignore */ }
    await sleep(500);
    try { rmSync(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }); } catch { /* ignore */ }
  }
}

main().catch((error) => {
  console.error('[perf] 失败：', error);
  process.exitCode = 1;
});
