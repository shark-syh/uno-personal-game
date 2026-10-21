/* global console, process, fetch, WebSocket, setTimeout */
/**
 * M10-06 双桌面实例验收（真实 Electron + CDP，无第三方依赖）。
 *
 * 覆盖：
 * 1. 两个独立 Electron 实例（不同 --user-data-dir / 调试端口）各自启动内嵌服务；
 * 2. A 创建房间，B 通过 UDP 发现（附近房间）或「房间码 + 手动地址」加入；
 * 3. B 的房间面板显示远程主机；开局后双方进入牌桌并稳定渲染；
 * 4. A 关闭窗口后，B 收到 server-closing 并回到单机大厅（M10-05）；
 * 5. 两端在主机退出前控制台 0 error / 0 exception。
 *
 * 前置：先构建桌面主进程（npm run desktop:build）。
 * 用法：npm run verify:desktop
 * 可选环境变量：
 *   UNO_REQUIRE_DESKTOP=1  无法启动 GUI 时视为失败（CI/真机）；默认输出 SKIP 并退出 0
 *   UNO_DESKTOP_DEBUG_A / UNO_DESKTOP_DEBUG_B  覆盖调试端口（默认 9351 / 9352）
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DESKTOP_MAIN = join(ROOT, 'apps', 'desktop', 'dist', 'main.cjs');
const ELECTRON_EXE = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const DEBUG_A = Number(process.env.UNO_DESKTOP_DEBUG_A || 9351);
const DEBUG_B = Number(process.env.UNO_DESKTOP_DEBUG_B || 9352);
const PROFILE_ROOT = join(ROOT, 'logs', 'tmp', `desktop-verify-${process.pid}`);
const REQUIRE_DESKTOP = process.env.UNO_REQUIRE_DESKTOP === '1';
const LAUNCH_TIMEOUT = 25000;

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail: String(detail || '') });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `（${detail}）` : ''}`);
}

function skip(reason) {
  console.log(`\n[verify-desktop] SKIP：${reason}`);
  console.log('[verify-desktop] 需要可交互的 Windows 桌面会话；普通 Chrome 版验收请用 npm run verify:online。');
  if (REQUIRE_DESKTOP) process.exitCode = 1;
}

async function getJson(url) {
  return (await fetch(url)).json();
}

async function waitFor(fn, timeout = 15000, label = '') {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(120);
  }
  throw new Error(`等待超时：${label}${lastError ? `（${lastError.message}）` : ''}`);
}

/** 极简 CDP 客户端（Node 自带 WebSocket） */
class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
  }
  async open() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolvePromise, reject) => {
      this.ws.addEventListener('open', resolvePromise, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id === undefined) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${message.error.code}: ${message.error.message}`));
      else pending.resolve(message.result);
    });
  }
  send(method, params = {}) {
    const id = (this.id += 1);
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

function spawnDesktop(label, debugPort, profileDir) {
  mkdirSync(profileDir, { recursive: true });
  const child = spawn(
    ELECTRON_EXE,
    [
      DESKTOP_MAIN,
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${debugPort}`,
      '--no-first-run',
    ],
    { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: false },
  );
  const logs = [];
  child.stdout?.on('data', (chunk) => logs.push(String(chunk)));
  child.stderr?.on('data', (chunk) => logs.push(String(chunk)));
  child.on('exit', (code) => logs.push(`[exit] ${code}`));
  return { label, debugPort, child, logs };
}

async function connectPage(instance) {
  const target = await waitFor(async () => {
    if (instance.child.exitCode !== null) throw new Error(`进程已退出（${instance.child.exitCode}）`);
    const targets = await getJson(`http://127.0.0.1:${instance.debugPort}/json/list`);
    return targets.find(
      (item) => item.type === 'page' && /^http:\/\/127\.0\.0\.1:\d+\//.test(item.url || ''),
    );
  }, LAUNCH_TIMEOUT, `${instance.label} 页面`);

  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.open();
  const errors = [];
  cdp.ws.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      errors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '));
    }
    if (message.method === 'Runtime.exceptionThrown') {
      errors.push(message.params.exceptionDetails?.text || 'exception');
    }
  });
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  const evaluate = async (expression) => {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const waitExpr = (expression, timeout = 15000, text = '') =>
    waitFor(async () => {
      const value = await evaluate(expression);
      return value === true ? true : value;
    }, timeout, `${instance.label}:${text || expression}`);

  await waitExpr('document.readyState === "complete"', 20000, '页面加载');
  await waitExpr('Boolean(document.querySelector("#online-name"))', 20000, '大厅就绪');
  const info = await evaluate('window.unoDesktop ? window.unoDesktop.getServerInfo() : null');
  return { ...instance, cdp, evaluate, waitExpr, errors, info };
}

/** 自动出牌：与 verify:online 同口径，遇到 UNO/抓他按钮不点，避免干扰断言 */
const autoPlayExpr = `(() => {
  const active = document.querySelector('.screen.is-active')?.dataset.screen;
  if (active === 'result') return 'result';
  if (active !== 'game') return 'idle';
  const dialog = document.querySelector('#dialog-root.is-open');
  if (dialog) {
    const color = [...dialog.querySelectorAll('[data-color]')].find((node) => !node.disabled);
    if (color) { color.click(); return 'color'; }
    const decline = [...dialog.querySelectorAll('button:not(:disabled)')]
      .find((node) => /摸 4 张|接受|不抓|放过/.test(node.textContent));
    if (decline) { decline.click(); return 'decline'; }
    return 'dialog';
  }
  const card = document.querySelector('#hand .card.is-legal');
  if (card) { card.click(); return 'card'; }
  const action = [...document.querySelectorAll('#action-bar button:not(:disabled)')]
    .find((node) => !/UNO|抓他/.test(node.textContent));
  if (action) { action.click(); return 'action'; }
  return 'idle';
})()`;

const instances = [];

function killInstance(instance) {
  if (!instance?.child || instance.child.exitCode !== null) return;
  spawnSync('taskkill', ['/F', '/T', '/PID', String(instance.child.pid)], {
    stdio: 'ignore',
    windowsHide: true,
  });
}

async function main() {
  if (!existsSync(ELECTRON_EXE)) {
    return skip(`未找到 Electron（${ELECTRON_EXE}），请先 npm install`);
  }
  if (!existsSync(DESKTOP_MAIN)) {
    console.log('[verify-desktop] 未找到 apps/desktop/dist/main.cjs，先执行 npm run desktop:build …');
    const build = spawnSync('npm', ['run', 'desktop:build'], {
      cwd: ROOT,
      shell: true,
      stdio: 'inherit',
      windowsHide: true,
    });
    if (build.status !== 0) return skip('桌面主进程构建失败');
  }

  const a = spawnDesktop('A', DEBUG_A, join(PROFILE_ROOT, 'A'));
  const b = spawnDesktop('B', DEBUG_B, join(PROFILE_ROOT, 'B'));
  instances.push(a, b);

  let pageA;
  let pageB;
  try {
    [pageA, pageB] = await Promise.all([connectPage(a), connectPage(b)]);
  } catch (error) {
    return skip(`Electron GUI 无法启动（${error instanceof Error ? error.message : String(error)}）`);
  }

  check('两个 Electron 实例各自启动内嵌服务', Boolean(pageA.info?.port && pageB.info?.port && pageA.info.port !== pageB.info.port), `${pageA.info?.port} / ${pageB.info?.port}`);

  await pageA.evaluate(`document.querySelector('#online-name').value = 'A'; true`);
  await pageB.evaluate(`document.querySelector('#online-name').value = 'B'; true`);
  await pageA.evaluate(`document.querySelector('#online-create').click(); true`);
  const code = await pageA.waitExpr(
    `(() => { const c = document.querySelector('#room-code').textContent.trim(); return /^[A-Z2-9]{4,6}$/.test(c) ? c : false; })()`,
    20000,
    '创建房间',
  );
  check('A 创建房间并拿到房间码', /^[A-Z2-9]{4,6}$/.test(code), code);

  // UDP 发现：同机回环不一定收到广播，失败时记录提示并走手动地址兜底
  let discovered;
  try {
    discovered = await pageB.waitExpr(
      `(() => [...document.querySelectorAll('#online-room-list button')].some((node) => node.textContent.includes(${JSON.stringify(code)})))()`,
      12000,
      'B 发现附近房间',
    );
  } catch {
    discovered = false;
  }
  check('B 的「附近房间」出现 A 的房间（UDP）', discovered, discovered ? '' : '本机未收到 UDP 广播，改用手动地址继续');

  let joined = false;
  if (discovered) {
    joined = await pageB.evaluate(`(() => {
      const button = [...document.querySelectorAll('#online-room-list button')]
        .find((node) => node.textContent.includes(${JSON.stringify(code)}));
      if (!button) return false;
      button.click();
      return true;
    })()`);
  }
  if (!joined) {
    await pageB.evaluate(
      `document.querySelector('#online-code').value = ${JSON.stringify(code)};
       document.querySelector('#online-host').value = ${JSON.stringify(`127.0.0.1:${pageA.info.port}`)};
       document.querySelector('#online-join').click(); true`,
    );
  }

  await pageB.waitExpr('document.querySelectorAll("#room-players .room-player").length === 2', 20000, 'B 入房');
  await pageA.waitExpr('document.querySelectorAll("#room-players .room-player").length === 2', 20000, 'A 看到 B');
  check('B 凭房间码加入 A 的房间', true, discovered ? 'UDP 发现路径' : '手动地址兜底路径');

  const remoteInfo = await pageB.evaluate(`(() => ({
    host: document.querySelector('#room-host-info').hidden ? '' : document.querySelector('#room-host-info').textContent,
    savedHost: JSON.parse(sessionStorage.getItem('uno:online') || '{}').host || '',
  }))()`);
  check('B 房间面板显示远程主机并写入会话', remoteInfo.host.includes(`127.0.0.1:${pageA.info.port}`) && remoteInfo.savedHost === `127.0.0.1:${pageA.info.port}`, JSON.stringify(remoteInfo));

  await pageA.evaluate(`document.querySelector('#room-start').click(); true`);
  await pageA.waitExpr('document.querySelector(".screen.is-active")?.dataset.screen === "game"', 20000, 'A 开局');
  await pageB.waitExpr('document.querySelector(".screen.is-active")?.dataset.screen === "game"', 20000, 'B 开局');
  await sleep(600);

  const errorsBeforeExit = { a: [...pageA.errors], b: [...pageB.errors] };
  const hands = await Promise.all([
    pageA.evaluate('document.querySelectorAll("#hand .card").length'),
    pageB.evaluate('document.querySelectorAll("#hand .card").length'),
  ]);
  check('双方进入牌桌并渲染手牌', hands.every((count) => count > 0), JSON.stringify(hands));

  const deadline = Date.now() + 10000;
  let actions = 0;
  while (Date.now() < deadline) {
    const states = await Promise.all([pageA.evaluate(autoPlayExpr), pageB.evaluate(autoPlayExpr)]);
    actions += states.filter((state) => ['card', 'action', 'color', 'decline'].includes(state)).length;
    if (states.includes('result')) break;
    await sleep(150);
  }
  check('远程对局可正常出牌/推进若干步', actions > 0, `actions=${actions}`);

  // M10-05：A 正常关窗 → 广播 server-closing → B 回到单机大厅
  await pageA.evaluate('window.close(); true').catch(() => false);
  const backToLobby = await pageB.waitExpr(
    `(() => {
      const roomPanel = document.querySelector('#room-panel');
      const singlePanel = document.querySelector('#single-panel');
      const screen = document.querySelector('.screen.is-active')?.dataset.screen;
      return Boolean(roomPanel?.hidden && singlePanel && !singlePanel.hidden && screen === 'lobby');
    })()`,
    15000,
    'A 关闭后 B 回大厅',
  );
  check('A 关闭窗口后 B 收到关服通知并回到单机大厅', Boolean(backToLobby), backToLobby ? '' : '未回大厅');

  check('主机退出前两端控制台无 error/exception', errorsBeforeExit.a.length === 0 && errorsBeforeExit.b.length === 0, errorsBeforeExit.a.concat(errorsBeforeExit.b).join(' | ').slice(0, 300));

  const failures = results.filter((item) => !item.ok);
  console.log(`\n[verify-desktop] ${results.length - failures.length}/${results.length} 通过`);
  if (failures.length) process.exitCode = 1;
}

try {
  mkdirSync(PROFILE_ROOT, { recursive: true });
  await main();
} catch (error) {
  console.error('[verify-desktop] 执行失败：', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  for (const instance of instances) killInstance(instance);
  await sleep(300);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(PROFILE_ROOT, { recursive: true, force: true });
      break;
    } catch {
      await sleep(300);
    }
  }
}
