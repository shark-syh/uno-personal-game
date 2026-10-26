/* global console, process, fetch, WebSocket, setTimeout */
/**
 * M9-04 联机多客户端验收（无头 Chrome + CDP，无第三方依赖）。
 *
 * 覆盖：
 * 1. 单机隐藏表情入口；双客户端创建/加入房间；
 * 2. 联机牌桌座位框按视角座位渲染（不显示自己、座位号/名字/牌数正确、布局在视口内）；
 * 3. 大厅与对局中的表情广播、发送者提示、气泡挂在发送者座位框下方；
 * 4. 表情本地 5 条 + 2 秒冷却与恢复；服务端限频由 ws-online/rooms 单测覆盖；
 * 5. 自动对局直到 UNO 窗口出现，断言喊 UNO / 抓他按钮按座位分流（M9-01）；
 * 6. 两端控制台 0 error / 0 exception。
 *
 * 前置：本地服务已在 http://localhost:3000 运行（npm run dev）。
 * 用法：npm run verify:online
 * 可选环境变量：UNO_BASE_URL、UNO_DEBUG_PORT、CHROME_PATH。
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = process.env.UNO_BASE_URL || 'http://localhost:3000';
const DEBUG_PORT = Number(process.env.UNO_DEBUG_PORT || 9334);
const PROFILE = join(ROOT, 'logs', 'tmp', `chrome-online-${process.pid}`);

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

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail: String(detail || '') });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `（${detail}）` : ''}`);
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

async function makePage(browser, label) {
  const { targetId } = await browser.send('Target.createTarget', { url: `${BASE_URL}/` });
  const targets = await getJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const target = targets.find((item) => item.id === targetId);
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
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });

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
    }, timeout, `${label}:${text || expression}`);

  await waitExpr('document.readyState === "complete"', 15000, '页面加载');
  await waitExpr('Boolean(document.querySelector("#online-name"))', 15000, '大厅就绪');
  await evaluate(`document.querySelector('#online-name').value = ${JSON.stringify(label)}; true`);
  return { cdp, evaluate, waitExpr, errors, label };
}

const clickEmoji = (emoji) => `(() => {
  const button = [...document.querySelectorAll('#emote-picker .emote-option')]
    .find((node) => node.textContent === ${JSON.stringify(emoji)});
  if (!button) return false;
  button.click();
  return true;
})()`;

/** 当前页面在 UNO 窗口中的角色：owner=该喊 UNO，catcher=该抓人 */
const windowRoleExpr = `(() => {
  const bar = document.querySelector('#action-bar');
  if (!bar) return null;
  if (bar.querySelector('.uno-button')) return 'owner';
  const catchButton = [...bar.querySelectorAll('button')]
    .find((node) => node.textContent.includes('抓他'));
  return catchButton ? 'catcher' : null;
})()`;

/** 自动出牌：触发窗口时提前 return，避免把窗口关掉 */
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

const rematchExpr = `(() => {
  const button = [...document.querySelectorAll('#result-content button')]
    .find((node) => node.textContent.includes('再来一局'));
  if (!button) return false;
  button.click();
  return true;
})()`;

let chrome;
try {
  mkdirSync(PROFILE, { recursive: true });
  chrome = spawn(
    findChrome(),
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${PROFILE}`,
      '--window-size=1440,900',
      '--mute-audio',
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true },
  );

  const version = await waitFor(async () => {
    try {
      return await getJson(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    } catch {
      return null;
    }
  }, 20000, '启动 Chrome');
  const browser = new Cdp(version.webSocketDebuggerUrl);
  await browser.open();

  const a = await makePage(browser, 'A');
  const b = await makePage(browser, 'B');

  const initial = await a.evaluate(`(() => ({
    room: document.querySelector('#room-emote-toggle').hidden,
    game: document.querySelector('#game-emote-toggle').hidden,
    picker: document.querySelector('#emote-picker').hidden,
  }))()`);
  check('单机大厅默认隐藏表情入口', initial.room && initial.game && initial.picker, JSON.stringify(initial));

  await a.evaluate(`document.querySelector('#online-create').click(); true`);
  const code = await a.waitExpr(
    `(() => { const c = document.querySelector('#room-code').textContent.trim(); return /^[A-Z2-9]{4,6}$/.test(c) ? c : false; })()`,
    15000,
    '创建房间',
  );
  check('房主创建房间并拿到 4~6 位房间码', /^[A-Z2-9]{4,6}$/.test(code), code);

  await b.evaluate(
    `document.querySelector('#online-code').value = ${JSON.stringify(code)}; document.querySelector('#online-join').click(); true`,
  );
  await b.waitExpr('document.querySelectorAll("#room-players .room-player").length === 2', 15000, 'B 入房');
  await a.waitExpr('document.querySelectorAll("#room-players .room-player").length === 2', 15000, 'A 看到 B');
  check('第二客户端凭房间码加入并同步座位列表', true, code);

  const entries = await a.evaluate(`(() => ({
    room: !document.querySelector('#room-emote-toggle').hidden,
    game: !document.querySelector('#game-emote-toggle').hidden,
  }))()`);
  check('进入联机房间后表情入口可见', entries.room && entries.game, JSON.stringify(entries));

  await a.evaluate(`document.querySelector('#room-emote-toggle').click(); true`);
  const picker = await a.evaluate(`(() => ({
    open: !document.querySelector('#emote-picker').hidden,
    count: document.querySelectorAll('#emote-picker .emote-option').length,
  }))()`);
  check('表情选择面板包含 12 个预置 emoji', picker.open && picker.count === 12, JSON.stringify(picker));

  await a.evaluate(clickEmoji('😂'));
  const lobbyBubble = await b.waitExpr(
    `(() => {
      const box = document.querySelector('#room-players .room-player[data-seat="0"]');
      const bubble = box?.querySelector('.emote-bubble');
      return bubble ? bubble.textContent : false;
    })()`,
    5000,
    '大厅气泡',
  );
  check('大厅表情气泡挂在发送者房间座位行', lobbyBubble === '😂', String(lobbyBubble));
  const selfToast = await a.evaluate(`document.querySelector('#toast-region').textContent.includes('你：😂')`);
  check('发送者收到「你：😂」提示', selfToast);

  for (const emoji of ['😭', '😡', '😎', '🤡']) {
    if (await a.evaluate(`document.querySelector('#emote-picker').hidden`)) {
      await a.evaluate(`document.querySelector('#room-emote-toggle').click(); true`);
    }
    await a.evaluate(clickEmoji(emoji));
    await sleep(80);
  }
  const cooling = await a.evaluate(`(() => {
    const toggle = document.querySelector('#room-emote-toggle');
    return { disabled: toggle.disabled, text: toggle.textContent };
  })()`);
  check('连发 5 条后进入 2 秒冷却', cooling.disabled && cooling.text.includes('冷却'), JSON.stringify(cooling));
  await a.waitExpr('!document.querySelector("#room-emote-toggle").disabled', 6000, '冷却结束');
  const resumed = await a.evaluate(`(() => {
    const toggle = document.querySelector('#room-emote-toggle');
    return { disabled: toggle.disabled, text: toggle.textContent };
  })()`);
  check('冷却结束后恢复可发送', !resumed.disabled && resumed.text === '表情', JSON.stringify(resumed));

  await a.evaluate(`document.querySelector('#room-start').click(); true`);
  await a.waitExpr('document.querySelector(".screen.is-active")?.dataset.screen === "game"', 15000, 'A 开局');
  await b.waitExpr('document.querySelector(".screen.is-active")?.dataset.screen === "game"', 15000, 'B 开局');
  await sleep(600);

  for (const page of [a, b]) {
    const ownName = page.label;
    const layout = await page.evaluate(`(() => {
      const boxes = [...document.querySelectorAll('#opponents .opponent')];
      const hand = document.querySelector('#hand');
      return {
        count: boxes.length,
        dataCount: document.querySelector('#opponents')?.dataset.count,
        seats: boxes.map((node) => Number(node.dataset.seat)),
        names: boxes.map((node) => node.querySelector('.opponent-name')?.textContent || ''),
        meta: boxes.map((node) => node.querySelector('.opponent-meta')?.textContent || ''),
        hands: boxes.map((node) => {
          const stack = node.querySelector('.opponent-hand');
          const cards = [...node.querySelectorAll('.opponent-hand-card')];
          const badge = stack?.querySelector('.opponent-hand-overflow') || null;
          const childNodes = stack ? [...stack.childNodes] : [];
          const allowedChild = (child) =>
            child.nodeType === 1 &&
            child.tagName === 'SPAN' &&
            (child.classList.contains('opponent-hand-card') || child.classList.contains('opponent-hand-overflow'));
          const rect = (element) => {
            const box = element.getBoundingClientRect();
            return [box.left, box.top, box.right, box.bottom];
          };
          let union = null;
          for (const card of cards) {
            const box = rect(card);
            union = union
              ? [Math.min(union[0], box[0]), Math.min(union[1], box[1]), Math.max(union[2], box[2]), Math.max(union[3], box[3])]
              : box;
          }
          const overlaps = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
          return {
            handCount: Number(node.dataset.handCount),
            visible: Number(stack?.dataset.visible || 0),
            cards: cards.length,
            display: stack ? getComputedStyle(stack).display : 'missing',
            cardW: cards[0]?.offsetWidth || 0,
            cardH: cards[0]?.offsetHeight || 0,
            nameOverlap: union ? overlaps(union, rect(node.querySelector('.opponent-name'))) : false,
            metaOverlap: union ? overlaps(union, rect(node.querySelector('.opponent-meta'))) : false,
            // M2 契约 §2.3：卡背分档锚点——data-overflow / .is-full / .opponent-hand-overflow
            overflowAttr: stack?.dataset.overflow ?? 'missing',
            isFull: Boolean(stack?.classList.contains('is-full')),
            badgeCount: stack ? stack.querySelectorAll('.opponent-hand-overflow').length : 0,
            badgeText: badge ? badge.textContent : 'missing',
            badgeAria: badge ? badge.getAttribute('aria-hidden') : 'missing',
            // M2 契约 §2.1：卡背层是纯装饰，不得泄露任何牌面信息
            faceLeaks: stack ? stack.querySelectorAll('img, .card, [data-face-code]').length : 0,
            childTotal: childNodes.length,
            childIssues: childNodes.filter((child) => !allowedChild(child)).length,
          };
        }),
        inside: boxes.every((node) => {
          const rect = node.getBoundingClientRect();
          return rect.left >= 0 && rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight;
        }),
        handTop: hand ? Math.round(hand.getBoundingClientRect().top) : 0,
        boxBottoms: boxes.map((node) => Math.round(node.getBoundingClientRect().bottom)),
      };
    })()`);
    check(`${ownName} 牌桌只看到 1 个对手座位框`, layout.count === 1 && layout.dataCount === '1', JSON.stringify(layout.seats));
    check(`${ownName} 座位框不显示自己且名字/牌数正确`, !layout.names.includes(ownName) && layout.meta.every((text) => text.includes('张')), layout.names.join(','));
    check(`${ownName} 座位框在视口内且不压手牌区`, layout.inside && layout.boxBottoms.every((bottom) => bottom < layout.handTop), JSON.stringify(layout.boxBottoms));
    // M3：联机视角下的圆桌契约——椭圆桌面、座位圆周锚点、data-* 状态同步、视角座位换位正确
    const arena = await page.evaluate(`(() => {
      const screen = document.querySelector('#game-screen');
      const seats = [...document.querySelectorAll('#opponents .opponent')].map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          seat: Number(node.dataset.seat),
          relative: Number(node.dataset.relativeSeat || 0),
          anchor: [node.style.getPropertyValue('--seat-x'), node.style.getPropertyValue('--seat-y')],
          current: node.dataset.current === 'true',
          rect: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.right), Math.round(rect.bottom)],
        };
      });
      return {
        arena: Boolean(document.querySelector('#table-area.arena .arena-rail')),
        phase: screen?.dataset.phase || '',
        currentSeat: screen?.dataset.currentSeat ?? '',
        viewerSeat: screen?.dataset.viewerSeat ?? '',
        seatCount: Number(document.querySelector('#opponents')?.dataset.seatCount || 0),
        seats,
        stamp: (document.querySelector('#turn-stamp')?.textContent || '').trim(),
        pile: (() => {
          const rect = document.querySelector('#discard-pile').getBoundingClientRect();
          return [Math.round(rect.left), Math.round(rect.top), Math.round(rect.right), Math.round(rect.bottom)];
        })(),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    })()`);
    const overlapsCenter = arena.seats.filter((seat) => {
      const [l, t, r, b] = seat.rect;
      const [pl, pt, pr, pb] = arena.pile;
      return l < pr + 2 && r > pl - 2 && t < pb + 2 && b > pt - 2;
    });
    check(
      `${ownName} M3 圆桌：椭圆桌面就绪、座位圆周锚点齐全且不压中心牌堆`,
      arena.arena &&
        arena.seatCount === 1 &&
        arena.seats.every((seat) => seat.relative === 1 && seat.anchor.every(Boolean)) &&
        overlapsCenter.length === 0 &&
        !arena.overflow,
      JSON.stringify({ arena: arena.arena, seatCount: arena.seatCount, seats: arena.seats, pile: arena.pile }),
    );
    check(
      `${ownName} M3 状态同步：data-phase/current-seat/viewer-seat 就绪、#turn-stamp 含行动者`,
      arena.phase.length > 0 &&
        arena.currentSeat !== '' &&
        arena.viewerSeat !== '' &&
        arena.stamp.length > 0,
      JSON.stringify({ phase: arena.phase, currentSeat: arena.currentSeat, viewerSeat: arena.viewerSeat, stamp: arena.stamp }),
    );
    check(
      `${ownName} 对手卡背按手牌数显示且不压名字/张数`,
      layout.hands.length === 1 &&
        layout.hands.every(
          (hand) =>
            hand.visible === Math.min(5, hand.handCount) &&
            hand.cards === hand.visible &&
            hand.display === 'block' &&
            hand.cardW === 22 &&
            hand.cardH === 33 &&
            !hand.nameOverlap &&
            !hand.metaOverlap,
        ),
      JSON.stringify(layout.hands),
    );

    // M2 契约 §2.1/§2.3：卡背 N 张分档 + 溢出徽标（期望值全部按动态 handCount 计算，不写死 +2）
    const m2OverflowOk =
      layout.hands.length > 0 &&
      layout.hands.every((hand) => {
        if (hand.handCount === 0) return hand.visible === 0 && hand.cards === 0 && hand.overflowAttr === 'missing';
        const expected = String(Math.max(0, hand.handCount - 5));
        const expectsBadge = hand.handCount > 5;
        return (
          hand.overflowAttr === expected &&
          hand.visible === Math.min(5, hand.handCount) &&
          hand.badgeCount === (expectsBadge ? 1 : 0) &&
          (expectsBadge
            ? hand.badgeText === `+${Math.max(0, hand.handCount - 5)}` && hand.badgeAria === 'true'
            : hand.badgeText === 'missing' && hand.badgeAria === 'missing')
        );
      });
    check(
      `${ownName} M2 联机：卡背 data-overflow 与 handCount 一致、+N 徽标 aria-hidden`,
      m2OverflowOk,
      JSON.stringify(
        layout.hands.map(({ handCount, visible, overflowAttr, badgeText, badgeAria }) => ({
          handCount, visible, overflowAttr, badgeText, badgeAria,
        })),
      ),
    );

    const m2LeakOk =
      layout.hands.length > 0 &&
      layout.hands.every((hand) => hand.faceLeaks === 0 && hand.childIssues === 0);
    check(
      `${ownName} M2 联机：卡背层不泄露牌面`,
      m2LeakOk,
      JSON.stringify(
        layout.hands.map(({ handCount, faceLeaks, childTotal, childIssues }) => ({
          handCount, faceLeaks, childTotal, childIssues,
        })),
      ),
    );

    // ≥10 张才出现 .is-full（联机初始 7 张通常走「不存在」分支，断言双向一致）
    const m2FullOk =
      layout.hands.length > 0 && layout.hands.every((hand) => hand.isFull === (hand.handCount >= 10));
    check(
      `${ownName} M2 联机：≥10 张 is-full 与 handCount 一致（条件）`,
      m2FullOk,
      JSON.stringify(layout.hands.map(({ handCount, isFull }) => ({ handCount, isFull }))),
    );
  }

  await b.evaluate(`document.querySelector('#game-emote-toggle').click(); true`);
  await b.evaluate(clickEmoji('🔥'));
  const gameBubble = await a.waitExpr(
    `(() => {
      const box = document.querySelector('#opponents .opponent[data-seat="1"]');
      const bubble = box?.querySelector('.emote-bubble');
      return bubble ? bubble.textContent : false;
    })()`,
    5000,
    '对局气泡',
  );
  check('对局中 B 发 🔥，A 在 B 的座位框看到气泡', gameBubble === '🔥', String(gameBubble));
  await sleep(320);
  const bubbleGeom = await a.evaluate(`(() => {
    const bubble = document.querySelector('#opponents .emote-bubble');
    const box = bubble?.closest('.opponent');
    if (!bubble || !box) return null;
    const br = bubble.getBoundingClientRect();
    const xr = box.getBoundingClientRect();
    return {
      fontSize: parseFloat(getComputedStyle(bubble).fontSize),
      width: Math.round(br.width),
      below: br.top >= xr.bottom - 2,
    };
  })()`);
  check('气泡尺寸放大并向下弹出到座位框下方', bubbleGeom && bubbleGeom.fontSize >= 30 && bubbleGeom.width >= 44 && bubbleGeom.below, JSON.stringify(bubbleGeom));

  // 自动对局直到 UNO 窗口出现（最多 3 局 / 90 秒），验证喊/抓按钮按座位分流
  const deadline = Date.now() + 90000;
  let games = 1;
  let roles = [null, null];
  while (Date.now() < deadline) {
    roles = await Promise.all([a.evaluate(windowRoleExpr), b.evaluate(windowRoleExpr)]);
    if (roles.includes('owner') && roles.includes('catcher')) break;
    const screens = await Promise.all([
      a.evaluate(`document.querySelector('.screen.is-active')?.dataset.screen`),
      b.evaluate(`document.querySelector('.screen.is-active')?.dataset.screen`),
    ]);
    if (screens.every((screen) => screen === 'result')) {
      games += 1;
      if (games > 3) break;
      await a.evaluate(rematchExpr);
      await a.waitExpr('document.querySelector(".screen.is-active")?.dataset.screen === "game"', 15000, '再来一局 A');
      await b.waitExpr('document.querySelector(".screen.is-active")?.dataset.screen === "game"', 15000, '再来一局 B');
      await sleep(500);
      continue;
    }
    await Promise.all([a.evaluate(autoPlayExpr), b.evaluate(autoPlayExpr)]);
    await sleep(120);
  }

  const owner = roles[0] === 'owner' ? a : roles[1] === 'owner' ? b : null;
  const catcher = owner === a ? b : owner === b ? a : null;
  check('自动对局触发 UNO 窗口（喊/抓分流可观测）', Boolean(owner && catcher), `games=${games} roles=${JSON.stringify(roles)}`);
  if (owner && catcher) {
    const ownerBar = await owner.evaluate(`(() => {
      const bar = document.querySelector('#action-bar');
      return {
        hasUno: Boolean(bar.querySelector('.uno-button')),
        hasCatch: [...bar.querySelectorAll('button')].some((node) => node.textContent.includes('抓他')),
      };
    })()`);
    const catcherBar = await catcher.evaluate(`(() => {
      const bar = document.querySelector('#action-bar');
      return {
        hasUno: Boolean(bar.querySelector('.uno-button')),
        hasCatch: [...bar.querySelectorAll('button')].some((node) => node.textContent.includes('抓他')),
      };
    })()`);
    check('UNO 窗口主人只看到「UNO!」、看不到「抓他」', ownerBar.hasUno && !ownerBar.hasCatch, JSON.stringify(ownerBar));
    check('其他座位只看到「抓他」、看不到「UNO!」', catcherBar.hasCatch && !catcherBar.hasUno, JSON.stringify(catcherBar));

    // M5：联机 UNO 金色倒计时环——主人侧渲染 conic 金环，时长 = 房间难度映射（10/8/6/4s 之一）
    const ownerRing = await owner.evaluate(`(() => {
      const button = document.querySelector('#action-bar .uno-button');
      const ring = button?.querySelector('.uno-countdown.uno-ring');
      return {
        hasRing: Boolean(ring),
        windowKey: ring?.dataset.windowKey || '',
        varMs: document.documentElement.style.getPropertyValue('--uno-window-ms').trim(),
        duration: ring ? getComputedStyle(ring).animationDuration : '',
      };
    })()`);
    check(
      'M5 联机 UNO 金环：主人侧渲染倒计时环（uno-ring + data-window-key）',
      ownerRing.hasRing && ownerRing.windowKey.length > 0,
      JSON.stringify(ownerRing),
    );
    check(
      'M5 联机 UNO 金环：环时长与 --uno-window-ms 同源且为难度映射之一（10/8/6/4s）',
      ['10000ms', '8000ms', '6000ms', '4000ms'].includes(ownerRing.varMs) &&
        Number.parseFloat(ownerRing.duration) * 1000 === Number.parseInt(ownerRing.varMs, 10),
      JSON.stringify(ownerRing),
    );
  }

  // M10-05：对局中房主离开 → 服务端把房主移交给下一位在线玩家
  await a.evaluate(`document.querySelector('#room-leave').click(); true`);
  const promoted = await b.waitExpr(
    `(() => {
      const row = document.querySelector('#room-players .room-player[data-seat="1"]');
      const badges = row?.querySelector('.room-badges')?.textContent || '';
      return badges.includes('房主') ? badges : false;
    })()`,
    8000,
    'B 接任房主',
  );
  check('对局中房主离开：房主移交给下一位在线玩家', String(promoted).includes('房主'), String(promoted));
  const promoteToast = await b.evaluate(`document.querySelector('#toast-region').textContent`);
  check('新房主收到「你成为新房主」提示', /你成为新房主/.test(promoteToast), promoteToast.slice(0, 80));

  for (const page of [a, b]) {
    check(`${page.label} 控制台无 error/exception`, page.errors.length === 0, page.errors.join(' | ').slice(0, 300));
  }

  const failures = results.filter((item) => !item.ok);
  console.log(`\n[verify-online] ${results.length - failures.length}/${results.length} 通过`);
  if (failures.length) process.exitCode = 1;
} finally {
  if (chrome) {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(chrome.pid)], { stdio: 'ignore', windowsHide: true });
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(PROFILE, { recursive: true, force: true });
      break;
    } catch {
      await sleep(300);
    }
  }
}
