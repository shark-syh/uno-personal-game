/**
 * M4 左下角三档模式切换器（DOM 锚点 `#mode-switch`，只增不改 window.UnoApp 五个 API）。
 *
 * 用户 2026-11-14 两次拍板（覆盖 Flip 方案 §2 的视觉与显示口径）：
 * - 只在**大厅**显示，进入对局 / 结算屏立即隐藏，不再压在手牌区上；
 * - **无底板悬浮** + **滑动指示器**：surface 不铺面板背景，选中态由绝对定位的
 *   荧光 squircle 荧块（.mode-switch__indicator）垫在档位下方平滑滑动；
 * - 整体放大（档位 ≥64×52px），一切圆角用连续曲率 squircle 遮罩，禁止普通 border-radius。
 * Flip（进阶）方案暂缓：第三档禁用并标注，不产生任何开局动作。
 * 状态仅保存在当前页面会话，刷新后回到基础模式；开局参数仍透传给单机与联机。
 */
import { GAME_MODES, getMode, isPlayableMode, setMode } from '../state/modePreference.js';

let initialized = false;
let mercyThemePromise = null;
let modeTransitionTimer = 0;
/** 最近一次 render 的 view：用于判断当前屏是否该显示切换器 */
let lastView = null;

/** 把滑动指示器对齐到当前选中档位（offsetLeft / offsetWidth 写成 CSS 变量）。
 *  短字断点 / 字体加载 / 窗口缩放都会改变档位宽度，需重测。 */
function positionIndicator() {
  const root = document.querySelector('#mode-switch');
  if (!root || root.hidden) return;
  const group = root.querySelector('.mode-switch__group');
  const active = root.querySelector('.mode-switch__option[aria-pressed="true"]');
  if (!group || !active) return;
  group.style.setProperty('--indicator-x', `${active.offsetLeft}px`);
  group.style.setProperty('--indicator-w', `${active.offsetWidth}px`);
}

function showTip(message) {
  const region = document.querySelector('#toast-region');
  if (!region) return;
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  region.append(node);
  window.setTimeout(() => node.remove(), 2600);
}

function loadMercyTheme() {
  if (mercyThemePromise) return mercyThemePromise;
  mercyThemePromise = new Promise((resolve, reject) => {
    if (document.querySelector('#mercy-theme')) { resolve(); return; }
    const link = document.createElement('link');
    link.id = 'mercy-theme';
    link.rel = 'stylesheet';
    link.href = 'styles/mercy-mode.css';
    link.onload = resolve;
    link.onerror = () => {
      link.remove();
      mercyThemePromise = null;
      reject(new Error('友尽模式主题加载失败'));
    };
    document.head.append(link);
  });
  return mercyThemePromise;
}

function syncLobbyCopy(mode) {
  const lobby = document.querySelector('#lobby-screen');
  const display = lobby?.querySelector('.lobby-display');
  const lead = document.querySelector('#lobby-lead');
  const index = lobby?.querySelectorAll('.index-item small') ?? [];
  if (mode === 'mercy') {
    if (display) display.innerHTML = '<span>NO</span><em>ONE</em><span>LEAVES.</span>';
    if (lead) lead.textContent = '牌堆不会放过任何人。手牌达到 25 张，立即淘汰。你可以离场，牌不会。';
    ['淘汰线：25 张', '叠链不断', '只剩一个赢家'].forEach((text, i) => { if (index[i]) index[i].textContent = text; });
  } else {
    if (display) display.innerHTML = '<span>PLAY</span><em>WITH</em><span>INTENT.</span>';
    if (lead) lead.textContent = '把牌桌变成一块可读的控制面：当前回合、对手压力、牌堆状态和你的可执行动作同时进入视野。';
    ['看清牌面', '读懂对手', '打出这一手'].forEach((text, i) => { if (index[i]) index[i].textContent = text; });
  }
}

function transitionMode(mode) {
  const lobby = document.querySelector('#lobby-screen');
  if (!lobby) return;
  const previousMode = lobby.dataset.mode || 'classic';
  if (previousMode === mode) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.clearTimeout(modeTransitionTimer);
  lobby.classList.remove('is-mode-switching');
  if (!reduceMotion) lobby.classList.add('is-mode-switching');
  lobby.dataset.mode = mode;
  document.querySelectorAll('.screen').forEach((screen) => { screen.dataset.mode = mode; });
  syncLobbyCopy(mode);
  if (!reduceMotion) {
    modeTransitionTimer = window.setTimeout(() => lobby.classList.remove('is-mode-switching'), 90);
  }
}

/** 按当前渲染的 view 同步显隐 / 选中态 / 「下局生效」提示 */
export function syncModeSwitch(view) {
  if (view) lastView = view;
  const root = document.querySelector('#mode-switch');
  if (!root || !initialized) return;

  // 用户反馈：进入对局后还显示模式切换 → 只在开局前的大厅可见
  const screen = lastView?.screen ?? 'lobby';
  root.hidden = screen === 'game' || screen === 'result';
  root.dataset.screen = screen;

  const selected = getMode();
  root.dataset.mode = selected;
  document.querySelectorAll('.screen').forEach((screen) => { screen.dataset.mode = selected; });
  root.querySelectorAll('.mode-switch__option').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.mode === selected));
  });

  const hint = root.querySelector('.mode-switch__hint');
  const currentMode = screen === 'game' || screen === 'result' ? lastView?.mode : null;
  const pending = Boolean(currentMode && currentMode !== selected);
  root.dataset.pending = String(pending);
  root.dataset.current = currentMode ?? selected;
  if (hint) {
    hint.hidden = !pending;
    if (pending) {
      const labelOf = (id) => GAME_MODES.find((item) => item.id === id)?.label ?? id;
      hint.textContent = `当前 ${labelOf(currentMode)} · 下一局 ${labelOf(selected)}`;
    }
  }

  // 选中态更新后让荧光指示器滑到新档位（隐藏时跳过，显示时会随 render 再测）
  positionIndicator();
}

/** 初始化切换器：幂等，由 render() 首次调用 */
export function initModeSwitch() {
  const root = document.querySelector('#mode-switch');
  if (!root || initialized) return;
  initialized = true;

  // 外层负责定位、投影与荧光（无底板：surface 不铺背景，投影 / 发光全部在父级 filter）
  const surface = document.createElement('div');
  surface.className = 'mode-switch__surface';

  const label = document.createElement('div');
  label.className = 'mode-switch__label';
  label.setAttribute('aria-hidden', 'true');
  const marker = document.createElement('i');
  marker.className = 'mode-switch__marker';
  const labelText = document.createElement('span');
  labelText.textContent = 'MODE / 玩法模式';
  label.append(marker, labelText);

  const group = document.createElement('div');
  group.className = 'mode-switch__group';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', '玩法模式');

  // 滑动指示器（2026-11-14 拍板）：荧光 squircle 荧块垫在档位下方，
  // 切换时靠 transform 滑动，而非各档独立填充背景
  const indicator = document.createElement('div');
  indicator.className = 'mode-switch__indicator';
  indicator.setAttribute('aria-hidden', 'true');
  group.append(indicator);

  for (const item of GAME_MODES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mode-switch__option';
    button.dataset.mode = item.id;
    button.dataset.short = item.short;
    button.textContent = item.label;
    button.setAttribute('aria-label', `${item.label}模式`);
    if (!isPlayableMode(item.id)) {
      button.disabled = true;
      button.title = '进阶模式（Flip）方案暂缓，尚未实现';
      button.setAttribute('aria-disabled', 'true');
    }
    if (item.id === 'mercy') {
      const warmTheme = () => loadMercyTheme().catch(() => {});
      button.addEventListener('pointerenter', warmTheme, { once: true });
      button.addEventListener('focus', warmTheme, { once: true });
    }
    button.addEventListener('click', async () => {
      if (item.id === getMode()) return;
      button.disabled = true;
      try {
        if (item.id === 'mercy') await loadMercyTheme();
        transitionMode(item.id);
        if (!setMode(item.id)) return;
        syncModeSwitch();
        showTip(`已选「${item.label}」模式，下一局生效`);
      } catch {
        showTip('友尽模式视觉资源暂不可用');
      } finally {
        button.disabled = !isPlayableMode(item.id);
      }
    });
    group.append(button);
  }

  const hint = document.createElement('span');
  hint.className = 'mode-switch__hint';
  hint.setAttribute('role', 'status');
  hint.hidden = true;

  surface.append(label, group, hint);
  root.append(surface);
  syncLobbyCopy(getMode());
  window.addEventListener('uno:mode-changed', () => syncModeSwitch());
  if (getMode() === 'mercy') loadMercyTheme().catch(() => {});
  // 断点切短字 / 窗口缩放 / 字体加载完成都会改变档位几何，需重对齐指示器
  window.addEventListener('resize', positionIndicator);
  if (document.fonts?.ready) document.fonts.ready.then(() => positionIndicator());
  syncModeSwitch();
}
